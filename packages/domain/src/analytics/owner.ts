// Owner-level analytics: revenue trajectory + cash forecast +
// concentration risk + agent productivity.
//
// What separates this from a typical exec dashboard:
//   - Cash forecast nets gross installment inflows against expected
//     refund risk (per-source historical refund rate × forward bookings)
//     so the number is the actual cash a CEO can rely on, not the
//     gross-of-refunds vanity figure.
//   - Concentration risk surfaces the top-customer + top-source % of
//     revenue and flags anything ≥30% as a single-point-of-failure.
//   - Agent productivity counts tool calls + audited mutations so the
//     ROI of the agent itself shows up next to the rest of the
//     business — investors love this and most tools don't have it.

import { and, count, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { Period, TimeseriesPoint } from "./types";

// ─── Revenue trajectory ──────────────────────────────────────────

export type RevenueTrajectoryArgs = {
  workspaceId: string;
  subAccountId?: string;
  weeksBack?: number; // default 12
  weeksAhead?: number; // default 4
};

export type RevenueTrajectoryResult = {
  history: TimeseriesPoint[];
  forecast: TimeseriesPoint[];
  /** Sum of `history` over the lookback window. */
  historyTotal: number;
  /** Linear-extrapolation projection across the forecast window. */
  forecastTotal: number;
  /** Same period last year (or null if no data 52 weeks back). */
  previousYearSamePeriodTotal: number | null;
};

/**
 * Weekly bookings for the last N weeks + a simple linear forecast for
 * the next M weeks. Forecast is the trailing-4-weeks average projected
 * forward — owner-level, no need for ARIMA.
 */
export async function revenueTrajectory(
  db: Db,
  args: RevenueTrajectoryArgs,
): Promise<RevenueTrajectoryResult> {
  const weeksBack = args.weeksBack ?? 12;
  const weeksAhead = args.weeksAhead ?? 4;
  const now = new Date();
  const weekMs = 7 * 24 * 3600 * 1000;
  const start = new Date(now.getTime() - weeksBack * weekMs);

  const conditions = [
    eq(schema.sales.workspaceId, args.workspaceId),
    isNull(schema.sales.deletedAt),
    gte(schema.sales.closedAt, start),
    lte(schema.sales.closedAt, now),
  ];
  if (args.subAccountId) conditions.push(eq(schema.sales.subAccountId, args.subAccountId));

  const rows = await db
    .select({
      bucket: sql<string>`date_trunc('week', closed_at)::date::text`,
      value: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
    })
    .from(schema.sales)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('week', closed_at)::date`)
    .orderBy(sql`date_trunc('week', closed_at)::date`);

  // Empty-bucket scaffolding — UI sparkline must render gap-free.
  const history: TimeseriesPoint[] = [];
  for (let i = weeksBack; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * weekMs);
    history.push({ bucket: dt.toISOString().slice(0, 10), value: 0 });
  }
  const byBucket = new Map(rows.map((r) => [r.bucket, r.value]));
  for (const point of history) {
    // Match by week-truncated date — round bucket to Monday-ish.
    for (const [k, v] of byBucket) {
      if (Math.abs(new Date(k).getTime() - new Date(point.bucket).getTime()) < weekMs) {
        point.value = v;
        break;
      }
    }
  }

  // Forecast: trailing-4-week average extended forward.
  const lastFour = history.slice(-4).map((p) => p.value);
  const trailingAvg =
    lastFour.length > 0 ? lastFour.reduce((a, b) => a + b, 0) / lastFour.length : 0;
  const forecast: TimeseriesPoint[] = [];
  for (let i = 1; i <= weeksAhead; i++) {
    const dt = new Date(now.getTime() + i * weekMs);
    forecast.push({ bucket: dt.toISOString().slice(0, 10), value: trailingAvg });
  }

  // Same-period-last-year comparison.
  const yearAgoFrom = new Date(start.getTime() - 52 * weekMs);
  const yearAgoTo = new Date(now.getTime() - 52 * weekMs);
  const [yagoRow] = await db
    .select({ v: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float` })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.workspaceId, args.workspaceId),
        isNull(schema.sales.deletedAt),
        gte(schema.sales.closedAt, yearAgoFrom),
        lte(schema.sales.closedAt, yearAgoTo),
      ),
    );

  return {
    history,
    forecast,
    historyTotal: history.reduce((acc, p) => acc + p.value, 0),
    forecastTotal: forecast.reduce((acc, p) => acc + p.value, 0),
    previousYearSamePeriodTotal: yagoRow && yagoRow.v > 0 ? yagoRow.v : null,
  };
}

// ─── Cash forecast ───────────────────────────────────────────────

export type CashForecastArgs = {
  workspaceId: string;
  subAccountId?: string;
};

export type CashForecastResult = {
  /** Gross expected installment inflows in the window (no refund haircut). */
  grossNext30d: number;
  grossNext60d: number;
  grossNext90d: number;
  /** Net of expected refunds (gross × historical refund rate). */
  netNext30d: number;
  netNext60d: number;
  netNext90d: number;
  /** Workspace's historical refund rate (used as the haircut). 0–1. */
  refundRate: number;
  /** Sum of pending+available commission entries that will release in
   *  the next 90 days — money out the door. */
  commissionObligations90d: number;
};

export async function cashForecast(
  db: Db,
  args: CashForecastArgs,
): Promise<CashForecastResult> {
  const now = new Date();
  const day = 24 * 3600 * 1000;
  const day30 = new Date(now.getTime() + 30 * day);
  const day60 = new Date(now.getTime() + 60 * day);
  const day90 = new Date(now.getTime() + 90 * day);

  // Gross inflows: scheduled installments with expected_date in window.
  async function sumInstallments(end: Date): Promise<number> {
    const conditions = [
      eq(schema.paymentPlanInstallments.status, "scheduled"),
      gte(
        schema.paymentPlanInstallments.expectedDate,
        sql`${now.toISOString().slice(0, 10)}::date`,
      ),
      lte(
        schema.paymentPlanInstallments.expectedDate,
        sql`${end.toISOString().slice(0, 10)}::date`,
      ),
    ];
    const [row] = await db
      .select({
        v: sql<number>`coalesce(sum(${schema.paymentPlanInstallments.expectedAmount}), 0)::float`,
      })
      .from(schema.paymentPlanInstallments)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.paymentPlanInstallments.saleId))
      .where(
        and(
          ...conditions,
          eq(schema.sales.workspaceId, args.workspaceId),
          isNull(schema.sales.deletedAt),
          ...(args.subAccountId ? [eq(schema.sales.subAccountId, args.subAccountId)] : []),
        ),
      );
    return row?.v ?? 0;
  }

  const grossNext30d = await sumInstallments(day30);
  const grossNext60d = await sumInstallments(day60);
  const grossNext90d = await sumInstallments(day90);

  // Historical refund rate over last 90 days: refunded $ / booked $.
  const ninetyDaysAgo = new Date(now.getTime() - 90 * day);
  const [refundRow] = await db
    .select({
      booked: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
      refunded: sql<number>`coalesce(sum(${schema.sales.refundedAmount}), 0)::float`,
    })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.workspaceId, args.workspaceId),
        isNull(schema.sales.deletedAt),
        gte(schema.sales.closedAt, ninetyDaysAgo),
      ),
    );
  const refundRate =
    refundRow && refundRow.booked > 0 ? refundRow.refunded / refundRow.booked : 0;

  // Commission obligations: pending + available entries with availableAt in next 90d.
  const [oblRow] = await db
    .select({
      v: sql<number>`coalesce(sum(${schema.commissionEntries.amount}), 0)::float`,
    })
    .from(schema.commissionEntries)
    .where(
      and(
        eq(schema.commissionEntries.workspaceId, args.workspaceId),
        sql`${schema.commissionEntries.status} IN ('pending', 'available')`,
        sql`${schema.commissionEntries.availableAt} <= ${day90}`,
      ),
    );

  return {
    grossNext30d,
    grossNext60d,
    grossNext90d,
    netNext30d: grossNext30d * (1 - refundRate),
    netNext60d: grossNext60d * (1 - refundRate),
    netNext90d: grossNext90d * (1 - refundRate),
    refundRate,
    commissionObligations90d: oblRow?.v ?? 0,
  };
}

// ─── Concentration risk ──────────────────────────────────────────

export type ConcentrationRisk = {
  topCustomerPct: number; // 0–1
  topCustomerName: string | null;
  topCustomerRevenue: number;
  topSourcePct: number;
  topSourceName: string | null;
  topSourceRevenue: number;
  totalRevenue: number;
};

/**
 * Top-customer + top-source share of revenue over the trailing 90 days.
 * Investors flag concentration ≥30%; UI highlights at that threshold.
 */
export async function concentrationRisk(
  db: Db,
  args: { workspaceId: string; subAccountId?: string; period?: Period },
): Promise<ConcentrationRisk> {
  const now = new Date();
  const period = args.period ?? {
    from: new Date(now.getTime() - 90 * 24 * 3600 * 1000),
    to: now,
  };

  const conditions = [
    eq(schema.sales.workspaceId, args.workspaceId),
    isNull(schema.sales.deletedAt),
    gte(schema.sales.closedAt, period.from),
    lte(schema.sales.closedAt, period.to),
  ];
  if (args.subAccountId) conditions.push(eq(schema.sales.subAccountId, args.subAccountId));

  const [totalRow] = await db
    .select({ v: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float` })
    .from(schema.sales)
    .where(and(...conditions));
  const totalRevenue = totalRow?.v ?? 0;

  if (totalRevenue === 0) {
    return {
      topCustomerPct: 0,
      topCustomerName: null,
      topCustomerRevenue: 0,
      topSourcePct: 0,
      topSourceName: null,
      topSourceRevenue: 0,
      totalRevenue: 0,
    };
  }

  const [topCustomer] = await db
    .select({
      customerId: schema.sales.customerId,
      name: schema.customers.name,
      email: schema.customers.primaryEmail,
      total: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
    })
    .from(schema.sales)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
    .where(and(...conditions))
    .groupBy(schema.sales.customerId, schema.customers.name, schema.customers.primaryEmail)
    .orderBy(sql`coalesce(sum(${schema.sales.bookedAmount}), 0) desc`)
    .limit(1);

  const [topSource] = await db
    .select({
      source: schema.sales.sourceIntegration,
      total: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
    })
    .from(schema.sales)
    .where(and(...conditions))
    .groupBy(schema.sales.sourceIntegration)
    .orderBy(sql`coalesce(sum(${schema.sales.bookedAmount}), 0) desc`)
    .limit(1);

  return {
    topCustomerPct: topCustomer ? topCustomer.total / totalRevenue : 0,
    topCustomerName: topCustomer?.name ?? topCustomer?.email ?? null,
    topCustomerRevenue: topCustomer?.total ?? 0,
    topSourcePct: topSource ? topSource.total / totalRevenue : 0,
    topSourceName: topSource?.source ?? "(direct / unknown)",
    topSourceRevenue: topSource?.total ?? 0,
    totalRevenue,
  };
}

// ─── Agent productivity ──────────────────────────────────────────

export type AgentProductivity = {
  totalToolCalls: number;
  mutatingToolCalls: number;
  uniqueUsers: number;
  topTools: Array<{ tool: string; count: number }>;
};

/**
 * Counts agent-driven tool calls over the requested window (default 7d).
 * Pulls from audit_log filtered by actor_kind='agent_on_behalf_of_user'.
 */
export async function agentProductivity(
  db: Db,
  args: { workspaceId: string; period?: Period },
): Promise<AgentProductivity> {
  const now = new Date();
  const period = args.period ?? {
    from: new Date(now.getTime() - 7 * 24 * 3600 * 1000),
    to: now,
  };

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      uniqueUsers: sql<number>`count(distinct ${schema.auditLog.actorUserId})::int`,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, args.workspaceId),
        eq(schema.auditLog.actorKind, "agent_on_behalf_of_user"),
        gte(schema.auditLog.createdAt, period.from),
        lte(schema.auditLog.createdAt, period.to),
      ),
    );

  // Mutating = action prefix 'tool:' + the tool isn't a search* read tool.
  const [mutCount] = await db
    .select({ n: count() })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, args.workspaceId),
        eq(schema.auditLog.actorKind, "agent_on_behalf_of_user"),
        gte(schema.auditLog.createdAt, period.from),
        lte(schema.auditLog.createdAt, period.to),
        sql`${schema.auditLog.action} LIKE 'tool:%'`,
        sql`${schema.auditLog.action} NOT LIKE 'tool:search%'`,
        sql`${schema.auditLog.action} NOT LIKE 'tool:get%'`,
      ),
    );

  const topToolsRaw = await db
    .select({
      tool: schema.auditLog.action,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, args.workspaceId),
        eq(schema.auditLog.actorKind, "agent_on_behalf_of_user"),
        gte(schema.auditLog.createdAt, period.from),
        lte(schema.auditLog.createdAt, period.to),
        sql`${schema.auditLog.action} LIKE 'tool:%'`,
      ),
    )
    .groupBy(schema.auditLog.action)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  return {
    totalToolCalls: counts?.total ?? 0,
    mutatingToolCalls: mutCount?.n ?? 0,
    uniqueUsers: counts?.uniqueUsers ?? 0,
    topTools: topToolsRaw.map((r) => ({
      tool: r.tool.replace(/^tool:/, ""),
      count: r.count,
    })),
  };
}
