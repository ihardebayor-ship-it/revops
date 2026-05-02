import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { team as teamDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { router, authedProcedure } from "../server";

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

  invite: authedProcedure
    .input(
      z.object({
        email: z.string().email(),
        accessRole: ACCESS_ROLES.default("contributor"),
        salesRoleIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "member:invite")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Need workspace_admin to invite members",
        });
      }
      return teamDomain.inviteMember(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        invitedBy: ctx.user.userId,
        email: input.email,
        accessRole: input.accessRole,
        salesRoleIds: input.salesRoleIds,
      });
    }),

  revokeInvite: authedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "member:invite")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return teamDomain.revokeInvitation(ctx.db, {
        invitationId: input.invitationId,
        workspaceId: ctx.user.workspaceId,
      });
    }),

  removeMember: authedProcedure
    .input(z.object({ membershipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "member:remove")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return teamDomain.removeMember(ctx.db, {
        membershipId: input.membershipId,
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
      });
    }),

  updateMember: authedProcedure
    .input(
      z.object({
        membershipId: z.string().uuid(),
        accessRole: ACCESS_ROLES.optional(),
        salesRoleIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "member:update_role")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
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
