import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { funnel as funnelDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { router, authedProcedure } from "../server";

export const funnelRouter = router({
  listStages: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    return funnelDomain.listStages(ctx.db, ctx.user.workspaceId);
  }),

  updateStage: authedProcedure
    .input(
      z.object({
        stageId: z.string().uuid(),
        label: z.string().min(1).max(100).optional(),
        ordinal: z.number().int().min(0).max(10000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "salesrole:update")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Need workspace_admin to edit funnel" });
      }
      return funnelDomain.updateStage(ctx.db, {
        stageId: input.stageId,
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
        patch: { label: input.label, ordinal: input.ordinal },
      });
    }),
});
