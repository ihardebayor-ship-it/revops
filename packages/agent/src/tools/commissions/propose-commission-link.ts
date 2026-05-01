// Non-mutating proposal tool. The agent calls this when it has high
// confidence a sale should be linked to a call but wants a human to
// approve. Writes a tasks(kind='agent_suggestion') row that the rep
// sees in their inbox; the rep can either accept (UI fires the
// linkSaleToCall mutation) or dismiss it.
//
// Risk is low — we never mutate the sale or the call directly. The
// task carries the proposed action in its payload.

import { z } from "zod";
import { tasks as tasksDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const proposeCommissionLink = defineTool({
  name: "proposeCommissionLink",
  category: "commissions",
  description:
    "Propose linking a sale to a call. Creates an agent_suggestion task for human approval; does NOT mutate the sale. Idempotent on (saleId, callId).",
  input: z.object({
    saleId: z.string().uuid(),
    callId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
    assignedUserId: z.string().nullable().optional(),
  }),
  output: z.object({ taskId: z.string(), deduped: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "task:create"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) =>
    `proposeCommissionLink:${input.saleId}:${input.callId}`,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    const uniqueKey = `agent_suggestion:link_sale:${input.saleId}:${input.callId}`;
    const result = await tasksDomain.upsertTaskByUniqueKey(ctx.db, {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      kind: "agent_suggestion",
      title: `Link this sale to call (${Math.round(input.confidence * 100)}% confident)`,
      description: input.rationale,
      assignedUserId: input.assignedUserId ?? null,
      salesRoleId: null,
      relatedEntityType: "sale",
      relatedEntityId: input.saleId,
      payload: {
        proposed: { tool: "linkSaleToCall", input: { saleId: input.saleId, callId: input.callId } },
        confidence: input.confidence,
      },
      dueAt: null,
      uniqueKey,
    });
    if (!result.id) throw new Error("upsert returned no id");
    return { taskId: result.id, deduped: !result.inserted };
  },
});
