import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { goals as goalsDomain } from "@revops/domain";
import { router, authedProcedure, authedProcedureWith } from "../server";

const GOAL_KIND = z.enum(["ote", "quota", "ramp", "target"]);
const PERIOD_KIND = z.enum([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "ramp_window",
  "custom",
]);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format");

export const goalsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
      throw new TRPCError({ code: "BAD_REQUEST" });
    }
    return goalsDomain.listGoals(ctx.db, {
      workspaceId: ctx.user.workspaceId,
      subAccountId: ctx.user.subAccountId,
    });
  }),

  // Hero data: per-period team grid for the manager's settings/goals page.
  teamGrid: authedProcedure
    .input(z.object({ periodKind: PERIOD_KIND.default("monthly") }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return goalsDomain.getTeamGoalsGrid(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        periodKind: input.periodKind,
      });
    }),

  // Live calibration data for the editor — last-3-period actuals + last quota.
  quotaContext: authedProcedure
    .input(
      z.object({
        userId: z.string(),
        periodKind: PERIOD_KIND.default("monthly"),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return goalsDomain.getQuotaContext(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        userId: input.userId,
        periodKind: input.periodKind,
      });
    }),

  create: authedProcedureWith("salesrole:update")
    .input(
      z.object({
        kind: GOAL_KIND,
        metric: z.string().min(1).max(50).default("booked_amount"),
        targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
        currency: z.string().length(3).optional(),
        periodKind: PERIOD_KIND.default("monthly"),
        periodStart: ymd,
        periodEnd: ymd,
        userId: z.string().nullable().optional(),
        salesRoleId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return goalsDomain.createGoal(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        actorUserId: ctx.user.userId,
        kind: input.kind,
        metric: input.metric,
        targetValue: input.targetValue,
        currency: input.currency,
        periodKind: input.periodKind,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        userId: input.userId ?? null,
        salesRoleId: input.salesRoleId ?? null,
      });
    }),

  update: authedProcedureWith("salesrole:update")
    .input(
      z.object({
        goalId: z.string().uuid(),
        kind: GOAL_KIND.optional(),
        metric: z.string().min(1).max(50).optional(),
        targetValue: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        currency: z.string().length(3).nullable().optional(),
        periodKind: PERIOD_KIND.optional(),
        periodStart: ymd.optional(),
        periodEnd: ymd.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return goalsDomain.updateGoal(ctx.db, {
        goalId: input.goalId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        patch: {
          kind: input.kind,
          metric: input.metric,
          targetValue: input.targetValue,
          currency: input.currency ?? undefined,
          periodKind: input.periodKind,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      });
    }),

  softDelete: authedProcedureWith("salesrole:update")
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return goalsDomain.softDeleteGoal(ctx.db, {
        goalId: input.goalId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
      });
    }),
});
