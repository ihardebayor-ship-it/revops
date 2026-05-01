import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { schema } from "@revops/db/client";
import { inngest } from "@revops/jobs";
import { router, authedProcedure } from "../server";

export const commissionsRouter = router({
  // Per-recipient list. Defaults to the calling user; admins can pass a userId.
  listMine: authedProcedure
    .input(
      z.object({
        status: z
          .enum(["pending", "available", "paid", "clawed_back", "voided"])
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const conditions = [
        eq(schema.commissionEntries.workspaceId, ctx.user.workspaceId),
        eq(schema.commissionEntries.recipientUserId, ctx.user.userId),
      ];
      if (input.status) conditions.push(eq(schema.commissionEntries.status, input.status));
      return ctx.db
        .select({
          id: schema.commissionEntries.id,
          saleId: schema.commissionEntries.saleId,
          installmentId: schema.commissionEntries.installmentId,
          amount: schema.commissionEntries.amount,
          currency: schema.commissionEntries.currency,
          status: schema.commissionEntries.status,
          pendingUntil: schema.commissionEntries.pendingUntil,
          availableAt: schema.commissionEntries.availableAt,
          paidAt: schema.commissionEntries.paidAt,
          createdAt: schema.commissionEntries.createdAt,
        })
        .from(schema.commissionEntries)
        .where(and(...conditions))
        .orderBy(desc(schema.commissionEntries.availableAt))
        .limit(input.limit);
    }),

  // Per-sale entries — used by the sale detail page.
  listForSale: authedProcedure
    .input(z.object({ saleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return ctx.db
        .select({
          id: schema.commissionEntries.id,
          installmentId: schema.commissionEntries.installmentId,
          recipientUserId: schema.commissionEntries.recipientUserId,
          salesRoleId: schema.commissionEntries.salesRoleId,
          ruleId: schema.commissionEntries.ruleId,
          amount: schema.commissionEntries.amount,
          currency: schema.commissionEntries.currency,
          status: schema.commissionEntries.status,
          pendingUntil: schema.commissionEntries.pendingUntil,
          availableAt: schema.commissionEntries.availableAt,
          paidAt: schema.commissionEntries.paidAt,
          clawedBackAt: schema.commissionEntries.clawedBackAt,
          canceledAt: schema.commissionEntries.canceledAt,
          canceledReason: schema.commissionEntries.canceledReason,
          computedFrom: schema.commissionEntries.computedFrom,
        })
        .from(schema.commissionEntries)
        .where(
          and(
            eq(schema.commissionEntries.saleId, input.saleId),
            eq(schema.commissionEntries.workspaceId, ctx.user.workspaceId),
          ),
        )
        .orderBy(schema.commissionEntries.installmentId);
    }),

  // Aggregate dashboard summary for the calling user.
  summary: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    const rows = await ctx.db
      .select({
        status: schema.commissionEntries.status,
        total: sum(schema.commissionEntries.amount),
        count: sql<number>`count(*)::int`,
      })
      .from(schema.commissionEntries)
      .where(
        and(
          eq(schema.commissionEntries.workspaceId, ctx.user.workspaceId),
          eq(schema.commissionEntries.recipientUserId, ctx.user.userId),
        ),
      )
      .groupBy(schema.commissionEntries.status);
    const out: Record<string, { total: string; count: number }> = {};
    for (const r of rows) {
      out[r.status] = { total: r.total ?? "0", count: r.count };
    }
    return out;
  }),

  // Admin-triggered re-run for a single sale.
  recomputeOne: authedProcedure
    .input(z.object({ saleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (ctx.user.accessRole !== "workspace_admin" && !ctx.user.isSuperadmin) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await inngest.send({
        name: "commission.recompute.requested",
        data: { saleId: input.saleId, reason: "admin.manual" },
      });
      return { queued: true };
    }),
});
