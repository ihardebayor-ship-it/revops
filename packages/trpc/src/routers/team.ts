import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { team as teamDomain } from "@revops/domain";
import { router, authedProcedure, authedProcedureWith } from "../server";

const ACCESS_ROLES = z.enum([
  "workspace_admin",
  "sub_account_admin",
  "manager",
  "contributor",
  "viewer",
]);

export const teamRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    return teamDomain.listTeam(ctx.db, { workspaceId: ctx.user.workspaceId });
  }),

  invite: authedProcedureWith("member:invite")
    .input(
      z.object({
        email: z.string().email(),
        accessRole: ACCESS_ROLES.default("contributor"),
        salesRoleIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return teamDomain.inviteMember(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        invitedBy: ctx.user.userId,
        email: input.email,
        accessRole: input.accessRole,
        salesRoleIds: input.salesRoleIds,
      });
    }),

  revokeInvite: authedProcedureWith("member:invite")
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return teamDomain.revokeInvitation(ctx.db, {
        invitationId: input.invitationId,
        workspaceId: ctx.user.workspaceId,
      });
    }),

  removeMember: authedProcedureWith("member:remove")
    .input(z.object({ membershipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return teamDomain.removeMember(ctx.db, {
        membershipId: input.membershipId,
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
      });
    }),

  updateMember: authedProcedureWith("member:update_role")
    .input(
      z.object({
        membershipId: z.string().uuid(),
        accessRole: ACCESS_ROLES.optional(),
        salesRoleIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return teamDomain.updateMember(ctx.db, {
        membershipId: input.membershipId,
        workspaceId: ctx.user.workspaceId,
        patch: {
          accessRole: input.accessRole,
          salesRoleIds: input.salesRoleIds,
        },
      });
    }),
});
