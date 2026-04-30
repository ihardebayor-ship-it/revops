// defineTool — the single contract for every tool the agent can call.
// Produces three artifacts from one declaration:
//   1. The Anthropic tool-use schema (via zodToJsonSchema)
//   2. The tRPC procedure (so the UI can call the same surface)
//   3. The typed function the Inngest workflow invokes
// Every tool execution writes one audit_log row, in a try/finally so
// failures are recorded too. See ADR-0003 §2 + §9.

import { z, type ZodSchema, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type AuthContext } from "@revops/auth/policy";
import { type Db, schema } from "@revops/db/client";

export type ToolRisk = "low" | "medium" | "high";

export type ActorKind = "user" | "agent_on_behalf_of_user" | "system" | "webhook";

export type ToolContext = {
  db: Db;
  user: AuthContext;
  workspaceId: string;
  subAccountId: string | null;
  actorKind: ActorKind;
  // Inngest agent runtime sets this so audit rows can be joined to the
  // turn that spawned the tool call. Null for tRPC/direct invocations.
  agentTraceId?: string | null;
};

export type ToolDefinition<TInput extends ZodTypeAny, TOutput extends ZodTypeAny> = {
  name: string;
  category: string;
  description: string;
  input: TInput;
  output: TOutput;
  authorize: (args: { ctx: ToolContext; input: z.infer<TInput> }) => boolean | Promise<boolean>;
  risk: ToolRisk;
  reversible: boolean;
  idempotent?: boolean;
  idempotencyKey?: (args: { input: z.infer<TInput> }) => string;
  run: (args: { ctx: ToolContext; input: z.infer<TInput> }) => Promise<z.infer<TOutput>>;
};

export type Tool = {
  name: string;
  category: string;
  description: string;
  input: ZodSchema;
  output: ZodSchema;
  risk: ToolRisk;
  reversible: boolean;
  idempotent: boolean;
  toAnthropicSchema: () => {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  authorize: (args: { ctx: ToolContext; input: unknown }) => Promise<boolean>;
  execute: (args: { ctx: ToolContext; input: unknown }) => Promise<unknown>;
};

// Best-effort resource-id extraction from tool input. Looks for a UUID in
// the most common positions (`id`, `<entity>Id` like `saleId`, `callId`).
// The audit_log entry is informational; missing resource_id isn't fatal.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractResourceId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const candidates = ["id", "resourceId", "saleId", "callId", "customerId", "taskId", "ruleId", "threadId", "userId"];
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === "string" && UUID_RE.test(value)) return value;
  }
  // Fall back to the first string value that looks like a UUID.
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && UUID_RE.test(value)) return value;
  }
  return null;
}

export function defineTool<TInput extends ZodTypeAny, TOutput extends ZodTypeAny>(
  def: ToolDefinition<TInput, TOutput>,
): Tool {
  if (!def.name.match(/^[a-z][A-Za-z0-9]*$/)) {
    throw new Error(`Tool name must be camelCase: ${def.name}`);
  }
  return {
    name: def.name,
    category: def.category,
    description: def.description,
    input: def.input,
    output: def.output,
    risk: def.risk,
    reversible: def.reversible,
    idempotent: def.idempotent ?? false,
    toAnthropicSchema: () => ({
      name: def.name,
      description: def.description,
      input_schema: zodToJsonSchema(def.input, {
        $refStrategy: "none",
        target: "openApi3",
      }) as Record<string, unknown>,
    }),
    authorize: async ({ ctx, input }) => {
      const parsed = def.input.parse(input);
      return Promise.resolve(def.authorize({ ctx, input: parsed }));
    },
    execute: async ({ ctx, input }) => {
      const parsed = def.input.parse(input);
      const start = Date.now();
      let result: unknown;
      let errored: Error | null = null;
      try {
        result = await def.run({ ctx, input: parsed });
        return def.output.parse(result);
      } catch (e) {
        errored = e instanceof Error ? e : new Error(String(e));
        throw errored;
      } finally {
        // Single audit_log row, success or failure. Inserted last so a
        // failed run still records the attempt.
        try {
          await ctx.db.insert(schema.auditLog).values({
            workspaceId: ctx.workspaceId,
            subAccountId: ctx.subAccountId,
            actorKind: ctx.actorKind,
            actorUserId: ctx.user.userId,
            action: `tool:${def.name}`,
            resourceType: def.category,
            resourceId: extractResourceId(parsed),
            after: errored ? null : (result as Record<string, unknown> | null),
            metadata: {
              risk: def.risk,
              durationMs: Date.now() - start,
              ...(errored ? { error: errored.message } : {}),
            },
            agentTraceId: ctx.agentTraceId ?? null,
          });
        } catch (auditErr) {
          // Audit write failure must not mask the original outcome. Log
          // and swallow; observability layer will surface the gap.
          console.error("audit_log insert failed for tool", def.name, auditErr);
        }
      }
    },
  };
}
