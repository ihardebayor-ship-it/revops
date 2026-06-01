import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { reconciliation as reconDomain } from "@revops/domain";
import { router, authedProcedure, authedProcedureWith } from "../server";

export const reconciliationRouter = router({
  suggestLinksForSale: authedProcedure
    .input(
      z.object({ saleId: z.string().uuid(), limit: z.number().int().min(1).max(20).default(5) }),
    )
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

  rejectSuggestedLink: authedProcedureWith("sale:link")
    .input(z.object({ saleId: z.string().uuid(), callId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }

      try {
        return await reconDomain.rejectSuggestedLink(ctx.db, {
          saleId: input.saleId,
          callId: input.callId,
          workspaceId: ctx.user.workspaceId,
          subAccountId: ctx.user.subAccountId,
          actorUserId: ctx.user.userId,
        });
      } catch (err) {
        if (err instanceof Error && err.message === "Sale or call not found") {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw err;
      }
    }),
});
