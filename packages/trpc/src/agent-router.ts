// Auto-generated tRPC router for the agent's tool registry. One procedure
// per tool, derived from the same Zod schemas the Anthropic tool surface
// uses. Risk-and-idempotency-driven verb selection: read-only idempotent
// tools become queries; everything else is a mutation.
//
// This is the bridge ADR-0003 §2 calls for: humans (UI → tRPC) and the
// agent (Inngest workflow → tool.execute) hit the same surface, so adding
// a feature in one place gives it to the other for free.

import { TRPCError, type AnyTRPCProcedure } from "@trpc/server";
import { ALL_TOOLS, type Tool, type ToolContext } from "@revops/agent";
import { requireWorkspace } from "@revops/auth/policy";
import { router, authedProcedure } from "./server";

function makeHandler(tool: Tool) {
  return async ({
    ctx,
    input,
  }: {
    ctx: { db: ToolContext["db"]; user: ToolContext["user"] };
    input: unknown;
  }) => {
    requireWorkspace(ctx.user);
    const toolCtx: ToolContext = {
      db: ctx.db,
      user: ctx.user,
      workspaceId: ctx.user.workspaceId,
      subAccountId: ctx.user.subAccountId,
      actorKind: "user",
    };
    if (!(await tool.authorize({ ctx: toolCtx, input }))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Authorization denied for tool: ${tool.name}`,
      });
    }
    return tool.execute({ ctx: toolCtx, input });
  };
}

export function buildAgentRouter() {
  const procs: Record<string, AnyTRPCProcedure> = {};
  for (const tool of ALL_TOOLS) {
    const isReadOnly = tool.risk === "low" && tool.idempotent;
    const base = authedProcedure.input(tool.input).output(tool.output);
    procs[tool.name] = (
      isReadOnly ? base.query(makeHandler(tool)) : base.mutation(makeHandler(tool))
    ) as unknown as AnyTRPCProcedure;
  }
  return router(procs);
}
