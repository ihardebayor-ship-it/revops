import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { reconciliation as reconDomain } from "@revops/domain";
import { router, authedProcedure } from "../server";

export const reconciliationRouter = router({
  suggestLinksForSale: authedProcedure
    .input(z.object({ saleId: z.string().uuid(), limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return reconDomain.suggestLinksForSale(ctx.db, {
        saleId: input.saleId,
        workspaceId: ctx.user.workspaceId,
        limit: input.limit,
      });
    }),

  unlinkedSalesQueue: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId) throw new TRPCError({ code: "BAD_REQUEST" });
      return reconDomain.unlinkedSalesQueue(ctx.db, {
        subAccountId: ctx.user.subAccountId,
        limit: input.limit,
      });
    }),
});
