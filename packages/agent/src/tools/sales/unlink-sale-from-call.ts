import { z } from "zod";
import { sales as salesDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const unlinkSaleFromCall = defineTool({
  name: "unlinkSaleFromCall",
  category: "sales",
  description:
    "Remove the call link from a sale. Idempotent — running it on an already-unlinked sale is a no-op.",
  input: z.object({ saleId: z.string().uuid() }),
  output: z.object({ saleId: z.string() }),
  authorize: ({ ctx }) => can(ctx.user, "sale:link"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `unlinkSaleFromCall:${input.saleId}`,
  run: async ({ ctx, input }) => {
    await salesDomain.unlinkFromCall(ctx.db, {
      saleId: input.saleId,
      workspaceId: ctx.workspaceId,
    });
    return { saleId: input.saleId };
  },
});
