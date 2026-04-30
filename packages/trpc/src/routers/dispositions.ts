import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { dispositions as dispositionsDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { router, authedProcedure } from "../server";

export const dispositionsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    return dispositionsDomain.listDispositions(ctx.db, ctx.user.workspaceId);
  }),

  update: authedProcedure
    .input(
      z.object({
        dispositionId: z.string().uuid(),
        label: z.string().min(1).max(100).optional(),
        sortOrder: z.number().int().min(0).max(10000).optional(),
        isActive: z.number().int().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "salesrole:update")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Need workspace_admin to edit dispositions",
        });
      }
      return dispositionsDomain.updateDisposition(ctx.db, {
        dispositionId: input.dispositionId,
        workspaceId: ctx.user.workspaceId,
        patch: {
          label: input.label,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        },
      });
    }),
});
