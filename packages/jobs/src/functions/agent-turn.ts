// agent.turn — durable Inngest workflow per ADR-0003 §1.
//
// Phase 0 MVP: non-streaming, single tool round-trip, no memory writes,
// no Pusher streaming, no prompt caching tuning. Demoable by sending
// `inngest send agent.turn.requested {...}` and observing the agent_messages
// + audit_log rows that result. Phase 1 fills in the loop, streaming, memory.
import { NonRetriableError } from "inngest";
import { and, desc, eq } from "drizzle-orm";
import {
  ALL_TOOLS,
  COST_CAPS,
  buildSystemPrompt,
  callClaude,
  chooseModel,
  getToolByName,
  type ToolContext,
} from "@revops/agent";
import { type AuthContext } from "@revops/auth/policy";
import { bypassRls, schema, withTenant } from "@revops/db/client";
import { inngest } from "../client";

export const agentTurn = inngest.createFunction(
  {
    id: "agent-turn",
    concurrency: { key: "event.data.threadId", limit: 1 },
    retries: 2,
  },
  { event: "agent.turn.requested" },
  async ({ event, step }) => {
    const { threadId, userId, workspaceId, turnId, message } = event.data as {
      threadId: string;
      userId: string;
      workspaceId: string;
      turnId: string;
      message: string;
    };

    // ─── 1. Load context ─────────────────────────────────────────
    const ctxData = await step.run("load-context", async () =>
      bypassRls(async (db) => {
        const member = await db
          .select({
            accessRole: schema.memberships.accessRole,
            subAccountId: schema.memberships.subAccountId,
          })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, userId),
              eq(schema.memberships.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (member.length === 0) {
          throw new NonRetriableError("user is not a member of workspace");
        }

        const settings = await db
          .select({
            agentPerTurnCostCapUsd: schema.workspaceSettings.agentPerTurnCostCapUsd,
          })
          .from(schema.workspaceSettings)
          .where(eq(schema.workspaceSettings.workspaceId, workspaceId))
          .limit(1);

        const ws = await db
          .select({ name: schema.workspaces.name, topologyPreset: schema.workspaces.topologyPreset })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, workspaceId))
          .limit(1);

        const recent = await db
          .select({
            role: schema.agentMessages.role,
            content: schema.agentMessages.content,
            createdAt: schema.agentMessages.createdAt,
          })
          .from(schema.agentMessages)
          .where(eq(schema.agentMessages.threadId, threadId))
          .orderBy(desc(schema.agentMessages.createdAt))
          .limit(20);

        const platformRows = await db
          .select({
            agentPersona: schema.platformSettings.agentPersona,
            brandName: schema.platformSettings.brandName,
          })
          .from(schema.platformSettings)
          .limit(1);
        const platform = platformRows[0];

        return {
          member: member[0]!,
          perTurnCap: Number(
            settings[0]?.agentPerTurnCostCapUsd ?? COST_CAPS.perTurnUsdMvp,
          ),
          workspace: ws[0] ?? { name: "Workspace", topologyPreset: "solo" as const },
          recent: recent.reverse(),
          brand: platform ?? {
            agentPersona: { name: "RevOps", voice: "professional, concise", forbiddenPhrases: [] },
            brandName: "RevOps Pro",
          },
        };
      }),
    );

    const authCtx: AuthContext = {
      userId,
      workspaceId,
      subAccountId: ctxData.member.subAccountId ?? null,
      accessRole: ctxData.member.accessRole,
      salesRoleSlugs: [],
      isSuperadmin: false,
    };

    // Persist the user turn first so a later failure doesn't lose the input.
    await step.run("persist-user-turn", () =>
      withTenant(authCtx, async (db) => {
        await db.insert(schema.agentMessages).values({
          threadId,
          turnId,
          role: "user",
          content: { text: message },
        });
        await db
          .update(schema.agentThreads)
          .set({ lastMessageAt: new Date() })
          .where(eq(schema.agentThreads.id, threadId));
      }),
    );

    // ─── 2. Plan ──────────────────────────────────────────────────
    const tools = ALL_TOOLS.map((t) => t.toAnthropicSchema());
    const model = chooseModel({ taskKind: "default" });

    const system = buildSystemPrompt({
      brand: {
        name: ctxData.brand.brandName,
        agentPersona: {
          name: ctxData.brand.agentPersona.name,
          voice: ctxData.brand.agentPersona.voice,
        },
      },
      workspace: {
        name: ctxData.workspace.name,
        topology: ctxData.workspace.topologyPreset,
        salesRoleVocabulary: [], // Phase 1 populates from sales_roles
      },
      workspaceFacts: [],
      threadSummary: null,
      retrievedFacts: [],
      availableTools: ALL_TOOLS,
    });

    const planMessages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      ...ctxData.recent.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: typeof (m.content as { text?: string }).text === "string"
          ? (m.content as { text: string }).text
          : JSON.stringify(m.content),
      })),
      { role: "user" as const, content: message },
    ];

    const plan = await step.run("plan", () =>
      callClaude({ model, system, tools, messages: planMessages, maxTokens: 1500 }),
    );

    let costUsd = plan.costUsd;
    let assistantText = plan.text;

    // ─── 3. Single tool round-trip (Phase 0 cap) ─────────────────
    if (plan.stopReason === "tool_use" && plan.toolCalls.length > 0) {
      const toolCall = plan.toolCalls[0]!;
      const tool = getToolByName(toolCall.name);
      if (!tool) {
        assistantText = `I tried to call a tool I don't have access to: ${toolCall.name}.`;
      } else {
        const toolResult = await step.run("execute-tool", async () =>
          withTenant(authCtx, async (db) => {
            const toolCtx: ToolContext = {
              db,
              user: authCtx,
              workspaceId,
              subAccountId: authCtx.subAccountId,
              actorKind: "agent_on_behalf_of_user",
              agentTraceId: turnId,
            };
            if (!(await tool.authorize({ ctx: toolCtx, input: toolCall.input }))) {
              return { __error: "authz_denied" as const };
            }
            try {
              return await tool.execute({ ctx: toolCtx, input: toolCall.input });
            } catch (err) {
              return { __error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );

        if (costUsd >= ctxData.perTurnCap) {
          assistantText =
            "I hit my per-turn cost cap before I could finish processing the tool result. Want me to continue?";
        } else {
          const continuation = await step.run("continue", () =>
            callClaude({
              model,
              system,
              tools,
              maxTokens: 1500,
              messages: [
                ...planMessages,
                {
                  role: "assistant" as const,
                  content: [
                    ...(plan.text ? [{ type: "text", text: plan.text }] : []),
                    {
                      type: "tool_use",
                      id: toolCall.id,
                      name: toolCall.name,
                      input: toolCall.input,
                    },
                  ],
                },
                {
                  role: "user" as const,
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: toolCall.id,
                      content: JSON.stringify(toolResult),
                    },
                  ],
                },
              ],
            }),
          );
          costUsd += continuation.costUsd;
          assistantText = continuation.text || assistantText;
        }
      }
    }

    // ─── 4. Commit ───────────────────────────────────────────────
    await step.run("commit-turn", () =>
      withTenant(authCtx, async (db) => {
        await db.insert(schema.agentMessages).values({
          threadId,
          turnId,
          role: "assistant",
          content: { text: assistantText },
          model,
          costUsd: String(costUsd),
        });
        await db
          .update(schema.agentThreads)
          .set({
            lastMessageAt: new Date(),
            totalCostUsd: String(costUsd),
          })
          .where(eq(schema.agentThreads.id, threadId));
      }),
    );

    return { ok: true, threadId, turnId, costUsd, assistantText };
  },
);
