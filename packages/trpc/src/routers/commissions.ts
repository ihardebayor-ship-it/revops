import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { schema } from "@revops/db/client";
import { inngest } from "@revops/jobs";
import { router, authedProcedure, authedProcedureWith } from "../server";

export const commissionsRouter = router({
  // Per-recipient list. Defaults to the calling user; admins can pass a userId.
  listMine: authedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "available", "paid", "clawed_back", "voided"]).optional(),
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

  // Tenant-scoped ops health for the commission ledger. Workspace admins see
  // the workspace; sub-account users see only their selected sub-account.
  health: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });

    const entryConditions = [eq(schema.commissionEntries.workspaceId, ctx.user.workspaceId)];
    const saleConditions = [eq(schema.sales.workspaceId, ctx.user.workspaceId)];
    if (ctx.user.subAccountId) {
      entryConditions.push(eq(schema.commissionEntries.subAccountId, ctx.user.subAccountId));
      saleConditions.push(eq(schema.sales.subAccountId, ctx.user.subAccountId));
    }

    const [statusRows, [diagnostics], recentRuns] = await Promise.all([
      ctx.db
        .select({
          status: schema.commissionEntries.status,
          total: sum(schema.commissionEntries.amount),
          count: sql<number>`count(*)::int`,
        })
        .from(schema.commissionEntries)
        .where(and(...entryConditions))
        .groupBy(schema.commissionEntries.status),
      ctx.db
        .select({
          stalePending: sql<number>`count(*) filter (where ${schema.commissionEntries.status} = 'pending' and ${schema.commissionEntries.pendingUntil} <= now())::int`,
          missingExplanation: sql<number>`count(*) filter (where ${schema.commissionEntries.status} <> 'voided' and (${schema.commissionEntries.computedFrom}->'explanation') is null)::int`,
          active: sql<number>`count(*) filter (where ${schema.commissionEntries.status} <> 'voided')::int`,
        })
        .from(schema.commissionEntries)
        .where(and(...entryConditions)),
      ctx.db
        .select({
          id: schema.commissionRecomputeRuns.id,
          saleId: schema.commissionRecomputeRuns.saleId,
          runAt: schema.commissionRecomputeRuns.runAt,
          entryCount: schema.commissionRecomputeRuns.entryCount,
          voidedCount: schema.commissionRecomputeRuns.voidedCount,
          durationMs: schema.commissionRecomputeRuns.durationMs,
          error: schema.commissionRecomputeRuns.error,
          triggeredBy: schema.commissionRecomputeRuns.triggeredBy,
        })
        .from(schema.commissionRecomputeRuns)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.commissionRecomputeRuns.saleId))
        .where(
          and(
            eq(schema.commissionRecomputeRuns.workspaceId, ctx.user.workspaceId),
            ...saleConditions,
          ),
        )
        .orderBy(desc(schema.commissionRecomputeRuns.runAt))
        .limit(5),
    ]);

    const statuses: Record<string, { total: string; count: number }> = {
      pending: { total: "0", count: 0 },
      available: { total: "0", count: 0 },
      paid: { total: "0", count: 0 },
      clawed_back: { total: "0", count: 0 },
      voided: { total: "0", count: 0 },
    };
    for (const row of statusRows) {
      statuses[row.status] = { total: row.total ?? "0", count: row.count };
    }

    return {
      statuses,
      active: diagnostics?.active ?? 0,
      stalePending: diagnostics?.stalePending ?? 0,
      missingExplanation: diagnostics?.missingExplanation ?? 0,
      recentRuns,
      latestRecomputeAt: recentRuns[0]?.runAt ?? null,
    };
  }),

  // Admin-triggered re-run for a single sale.
  recomputeOne: authedProcedureWith("commission:rule:update")
    .input(z.object({ saleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const saleConditions = [
        eq(schema.sales.id, input.saleId),
        eq(schema.sales.workspaceId, ctx.user.workspaceId),
      ];
      if (ctx.user.subAccountId)
        saleConditions.push(eq(schema.sales.subAccountId, ctx.user.subAccountId));

      const [sale] = await ctx.db
        .select({ id: schema.sales.id })
        .from(schema.sales)
        .where(and(...saleConditions))
        .limit(1);
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });

      await inngest.send({
        name: "commission.recompute.requested",
        data: { saleId: input.saleId, reason: "admin.manual" },
      });
      return { queued: true };
    }),
});
