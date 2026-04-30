import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { roles as rolesDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { router, authedProcedure } from "../server";

export const rolesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    return rolesDomain.listRoles(ctx.db, ctx.user.workspaceId);
  }),

  update: authedProcedure
    .input(
      z.object({
        roleId: z.string().uuid(),
        label: z.string().min(1).max(100).optional(),
        defaultCommissionShare: z
          .string()
          .regex(/^\d+(\.\d{1,4})?$/, "Must be a decimal between 0 and 1")
          .optional(),
        defaultSlaSeconds: z.number().int().min(0).nullable().optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "salesrole:update")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Need workspace_admin to edit roles" });
      }
      return rolesDomain.updateRole(ctx.db, {
        roleId: input.roleId,
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
        patch: {
          label: input.label,
          defaultCommissionShare: input.defaultCommissionShare,
          defaultSlaSeconds: input.defaultSlaSeconds,
          color: input.color,
        },
      });
    }),
});
