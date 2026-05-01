// agent.turn — durable Inngest workflow per ADR-0003 §1.
//
// Phase 1 M5.5:
//   - Multi-tool loop: keeps calling the model until stopReason !== "tool_use"
//     or we hit MAX_ITERS or the per-turn cost cap.
//   - Memory hydration: before the planning call, vector-search agent_facts
//     for facts most similar to the user's message and inject them into the
//     system prompt.
//   - Pusher: emits agent.tool.proposed for each tool the model picks, and
//     agent.turn.complete when the assistant message is committed. Token
//     deltas are NOT streamed yet — that requires a non-Inngest path and
//     ships in Phase 2 (the channel + event names already exist for it).
//
// Streaming caveat: Inngest steps serialize their results, so true
// per-character streaming inside this workflow is impossible without
// either bypassing the step boundary or moving the planning call out of
// Inngest. We accept the per-tool granularity for Phase 1; the UI gets
// progress events at every interesting boundary.

import { NonRetriableError } from "inngest";
import { and, desc, eq, sql } from "drizzle-orm";
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
import { embedTexts } from "@revops/integrations/shared";
import { emit } from "@revops/realtime/server";
import { channelNames, events as realtimeEvents } from "@revops/realtime/channels";
import { inngest } from "../client";

const MAX_ITERS = 6;
const RETRIEVED_FACTS_LIMIT = 8;

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

    // ─── 2. Memory hydration ─────────────────────────────────────
    // Embed the user's message once; reuse for retrieval + (later) fact
    // persistence. If OPENAI_API_KEY is missing we silently skip
    // retrieval — the agent still works, just without RAG.
    const retrieved = await step.run("hydrate-memory", async () => {
      if (!process.env.OPENAI_API_KEY) return [] as string[];
      try {
        const { vectors } = await embedTexts([message]);
        const v = vectors[0];
        if (!v) return [] as string[];
        const literal = `[${v.join(",")}]`;
        return await bypassRls(async (db) => {
          const rows = await db
            .select({ content: schema.agentFacts.content })
            .from(schema.agentFacts)
            .where(
              sql`${schema.agentFacts.workspaceId} = ${workspaceId}
                AND ${schema.agentFacts.contradictedAt} IS NULL`,
            )
            .orderBy(sql`${schema.agentFacts.embedding} <=> ${literal}::vector`)
            .limit(RETRIEVED_FACTS_LIMIT);
          return rows.map((r) => r.content);
        });
      } catch (err) {
        console.warn("[agent.turn] memory hydration failed:", err instanceof Error ? err.message : err);
        return [] as string[];
      }
    });

    // ─── 3. Plan + multi-tool loop ───────────────────────────────
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
        salesRoleVocabulary: [],
      },
      workspaceFacts: [],
      threadSummary: null,
      retrievedFacts: retrieved,
      availableTools: ALL_TOOLS,
    });

    type ChatMessage = { role: "user" | "assistant"; content: unknown };
    const planMessages: ChatMessage[] = [
      ...ctxData.recent.map<ChatMessage>((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content:
          typeof (m.content as { text?: string }).text === "string"
            ? (m.content as { text: string }).text
            : JSON.stringify(m.content),
      })),
      { role: "user", content: message },
    ];

    let costUsd = 0;
    let assistantText = "";
    let lastStopReason = "";
    const channel = channelNames.agentThread(threadId);

    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const turn = await step.run(`plan-${iter}`, () =>
        callClaude({
          model,
          system,
          tools,
          messages: planMessages,
          maxTokens: 1500,
        }),
      );
      costUsd += turn.costUsd;
      lastStopReason = turn.stopReason;
      if (turn.text) assistantText = turn.text;

      if (turn.stopReason !== "tool_use" || turn.toolCalls.length === 0) break;

      // Append the assistant turn (text + tool_use blocks) to the rolling context.
      planMessages.push({
        role: "assistant",
        content: [
          ...(turn.text ? [{ type: "text", text: turn.text }] : []),
          ...turn.toolCalls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });

      // Execute every tool the model called this turn, in order. Each
      // tool runs inside withTenant so RLS is enforced as the calling user.
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const tc of turn.toolCalls) {
        await emit(channel, realtimeEvents.agentToolProposed, {
          turnId,
          toolUseId: tc.id,
          name: tc.name,
          input: tc.input,
        });

        const tool = getToolByName(tc.name);
        let resultPayload: unknown;
        if (!tool) {
          resultPayload = { __error: `unknown_tool:${tc.name}` };
        } else {
          resultPayload = await step.run(`execute-${iter}-${tc.id}`, () =>
            withTenant(authCtx, async (db) => {
              const toolCtx: ToolContext = {
                db,
                user: authCtx,
                workspaceId,
                subAccountId: authCtx.subAccountId,
                actorKind: "agent_on_behalf_of_user",
                agentTraceId: turnId,
              };
              if (!(await tool.authorize({ ctx: toolCtx, input: tc.input }))) {
                return { __error: "authz_denied" as const };
              }
              try {
                return await tool.execute({ ctx: toolCtx, input: tc.input });
              } catch (err) {
                return { __error: err instanceof Error ? err.message : String(err) };
              }
            }),
          );
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: JSON.stringify(resultPayload),
        });
      }

      planMessages.push({ role: "user", content: toolResults });

      if (costUsd >= ctxData.perTurnCap) {
        assistantText =
          assistantText ||
          "I hit my per-turn cost cap before I could finish. Want me to continue?";
        lastStopReason = "cost_capped";
        break;
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

    await emit(channel, realtimeEvents.agentTurnComplete, {
      turnId,
      costUsd,
      stopReason: lastStopReason,
      text: assistantText,
    });

    return { ok: true, threadId, turnId, costUsd, assistantText, stopReason: lastStopReason };
  },
);
