import { z } from "zod";
import { sales as salesDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const linkSaleToCall = defineTool({
  name: "linkSaleToCall",
  category: "sales",
  description:
    "Link an existing sale to a call. Idempotent on (saleId, callId). Updates both sides and emits a funnel event with via='manual_link'.",
  input: z.object({
    saleId: z.string().uuid(),
    callId: z.string().uuid(),
  }),
  output: z.object({
    saleId: z.string(),
    callId: z.string(),
  }),
  authorize: ({ ctx }) => can(ctx.user, "sale:link"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `linkSaleToCall:${input.saleId}:${input.callId}`,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    await salesDomain.linkToCall(ctx.db, {
      saleId: input.saleId,
      callId: input.callId,
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      actorUserId: ctx.user.userId,
    });
    return { saleId: input.saleId, callId: input.callId };
  },
});
