import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sales as salesDomain } from "@revops/domain";
import { inngest } from "@revops/jobs";
import { router, authedProcedure } from "../server";

const recipientSchema = z.object({
  userId: z.string(),
  salesRoleId: z.string().uuid(),
  sharePct: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

const paymentScheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("one_time"),
    collectedAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
  }),
  z.object({
    kind: z.literal("plan"),
    installmentFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly"]),
    totalInstallments: z.number().int().min(2).max(120),
    installmentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    firstInstallmentDate: z.string(),
  }),
]);

export const salesRouter = router({
  list: authedProcedure
    .input(
      z.object({
        onlyUnlinked: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId) throw new TRPCError({ code: "BAD_REQUEST" });
      return salesDomain.listSales(ctx.db, {
        subAccountId: ctx.user.subAccountId,
        onlyUnlinked: input.onlyUnlinked,
        limit: input.limit,
      });
    }),

  byId: authedProcedure
    .input(z.object({ saleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const sale = await salesDomain.getSale(ctx.db, {
        saleId: input.saleId,
        workspaceId: ctx.user.workspaceId,
      });
      if (!sale) return null;
      const [recipients, installments] = await Promise.all([
        salesDomain.getSaleRecipients(ctx.db, { saleId: input.saleId }),
        salesDomain.getSaleInstallments(ctx.db, { saleId: input.saleId }),
      ]);
      return { sale, recipients, installments };
    }),

  create: authedProcedure
    .input(
      z.object({
        customerEmail: z.string().email(),
        customerName: z.string().max(200).optional(),
        customerPhone: z.string().max(50).optional(),
        productName: z.string().max(200).optional(),
        bookedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        currency: z.string().length(3).default("USD"),
        closedAt: z.string().datetime().optional(),
        paymentSchedule: paymentScheduleSchema.optional(),
        recipients: z.array(recipientSchema).optional(),
        linkedCallId: z.string().uuid().nullable().optional(),
        paymentProcessor: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace required" });
      }
      const ps = input.paymentSchedule;
      const paymentSchedule = ps
        ? ps.kind === "plan"
          ? { ...ps, firstInstallmentDate: new Date(ps.firstInstallmentDate) }
          : ps
        : undefined;
      const result = await salesDomain.createSale(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        customerEmail: input.customerEmail,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        productName: input.productName ?? null,
        bookedAmount: input.bookedAmount,
        currency: input.currency,
        closedAt: input.closedAt ? new Date(input.closedAt) : undefined,
        paymentSchedule,
        recipients: input.recipients,
        linkedCallId: input.linkedCallId ?? null,
        paymentProcessor: input.paymentProcessor ?? null,
        createdBy: ctx.user.userId,
      });
      await inngest.send({
        name: "commission.recompute.requested",
        data: { saleId: result.saleId, reason: "sale.created" },
      });
      return result;
    }),

  linkToCall: authedProcedure
    .input(z.object({ saleId: z.string().uuid(), callId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      const result = await salesDomain.linkToCall(ctx.db, {
        saleId: input.saleId,
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        actorUserId: ctx.user.userId,
      });
      await inngest.send({
        name: "commission.recompute.requested",
        data: { saleId: input.saleId, reason: "sale.linked_to_call" },
      });
      return result;
    }),

  unlinkFromCall: authedProcedure
    .input(z.object({ saleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return salesDomain.unlinkFromCall(ctx.db, {
        saleId: input.saleId,
        workspaceId: ctx.user.workspaceId,
      });
    }),

  softDelete: authedProcedure
    .input(z.object({ saleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const result = await salesDomain.softDeleteSale(ctx.db, {
        saleId: input.saleId,
        workspaceId: ctx.user.workspaceId,
      });
      await inngest.send({
        name: "commission.recompute.requested",
        data: { saleId: input.saleId, reason: "sale.deleted" },
      });
      return result;
    }),
});
