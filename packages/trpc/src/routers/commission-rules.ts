import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { commissionRules as rulesDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { router, authedProcedure } from "../server";

const matchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }),
  z.object({ kind: z.literal("name"), value: z.string().min(1).max(200) }),
]);

const decimalShare = z
  .string()
  .regex(/^(0|0?\.\d{1,4}|1(\.0{1,4})?)$/, "Must be a decimal between 0 and 1");
const decimalAmount = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a decimal amount");

export const commissionRulesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    return rulesDomain.listCommissionRules(ctx.db, ctx.user.workspaceId);
  }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        salesRoleId: z.string().uuid().nullable(),
        sharePct: decimalShare.nullable(),
        flatAmount: decimalAmount.nullable(),
        currency: z.string().length(3).default("USD"),
        productMatch: matchSchema.optional(),
        sourceMatch: matchSchema.optional(),
        holdDays: z.number().int().min(0).max(365).default(30),
        paidOn: z.enum(["collected", "booked"]).default("collected"),
        effectiveFrom: z.string().datetime().nullable().optional(),
        effectiveTo: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "commission:rule:update")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Need workspace_admin to edit commission rules",
        });
      }
      return rulesDomain.createCommissionRule(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
        name: input.name,
        type: "flat_rate",
        salesRoleId: input.salesRoleId,
        sharePct: input.sharePct,
        flatAmount: input.flatAmount,
        currency: input.currency,
        productMatch: input.productMatch,
        sourceMatch: input.sourceMatch,
        holdDays: input.holdDays,
        paidOn: input.paidOn,
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      });
    }),

  update: authedProcedure
    .input(
      z.object({
        ruleId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        salesRoleId: z.string().uuid().nullable().optional(),
        sharePct: decimalShare.nullable().optional(),
        flatAmount: decimalAmount.nullable().optional(),
        currency: z.string().length(3).optional(),
        productMatch: matchSchema.optional(),
        sourceMatch: matchSchema.optional(),
        holdDays: z.number().int().min(0).max(365).optional(),
        paidOn: z.enum(["collected", "booked"]).optional(),
        isActive: z.number().int().min(0).max(1).optional(),
        effectiveFrom: z.string().datetime().nullable().optional(),
        effectiveTo: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "commission:rule:update")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Need workspace_admin to edit commission rules",
        });
      }
      return rulesDomain.updateCommissionRule(ctx.db, {
        ruleId: input.ruleId,
        workspaceId: ctx.user.workspaceId,
        actorUserId: ctx.user.userId,
        patch: {
          name: input.name,
          salesRoleId: input.salesRoleId,
          sharePct: input.sharePct,
          flatAmount: input.flatAmount,
          currency: input.currency,
          productMatch: input.productMatch,
          sourceMatch: input.sourceMatch,
          holdDays: input.holdDays,
          paidOn: input.paidOn,
          isActive: input.isActive,
          effectiveFrom:
            input.effectiveFrom === undefined
              ? undefined
              : input.effectiveFrom === null
                ? null
                : new Date(input.effectiveFrom),
          effectiveTo:
            input.effectiveTo === undefined
              ? undefined
              : input.effectiveTo === null
                ? null
                : new Date(input.effectiveTo),
        },
      });
    }),

  softDelete: authedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (!can(ctx.user, "commission:rule:update")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return rulesDomain.softDeleteCommissionRule(ctx.db, {
        ruleId: input.ruleId,
        workspaceId: ctx.user.workspaceId,
      });
    }),
});
