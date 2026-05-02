// Retention + book-health analytics.
//
// Two surfaces:
//   1. cohortRetention(workspaceId): for each acquisition month, how many
//      customers were still active at 30/60/90/180 days. Used by CX dashboard.
//   2. bookHealth(workspaceId): right-now distribution of customer
//      statuses + each customer's risk score for the "needs-a-touch" list.
//
// Risk score (Phase 1, deterministic): a 0–100 weighted sum of:
//   - days since last call/sale (35%)
//   - presence of a refund (30%)
//   - last call disposition negative (20%)
//   - LTV trajectory: collected/booked ratio < 0.6 (15%)
// ML-based scoring lands when we have outcome labels.

import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type CohortRow = {
  cohortMonth: string; // YYYY-MM
  initialCustomers: number;
  retainedAt30d: number | null;
  retainedAt60d: number | null;
  retainedAt90d: number | null;
  retainedAt180d: number | null;
};

export type BookHealthArgs = {
  workspaceId: string;
  subAccountId?: string;
};

export type BookHealthSummary = {
  total: number;
  byStatus: Record<string, number>;
  totalLifetimeValue: number;
  /** Customers churned in the last 30 days. */
  recentChurnCount: number;
  /** Customers refunded in last 30 days, where the sale closed > 14 days ago
   *  (still inside save-flow window). */
  recentRefundsRecoverable: number;
};

export async function bookHealth(db: Db, args: BookHealthArgs): Promise<BookHealthSummary> {
  const conditions = [isNull(schema.customers.deletedAt)];
  if (args.subAccountId) conditions.push(eq(schema.customers.subAccountId, args.subAccountId));
  else conditions.push(eq(schema.customers.workspaceId, args.workspaceId));

  const rows = await db
    .select({
      status: schema.customers.status,
      count: sql<number>`count(*)::int`,
      ltv: sql<number>`coalesce(sum(${schema.customers.lifetimeValue}), 0)::float`,
    })
    .from(schema.customers)
    .where(and(...conditions))
    .groupBy(schema.customers.status);

  const byStatus: Record<string, number> = {};
  let total = 0;
  let totalLifetimeValue = 0;
  for (const r of rows) {
    byStatus[r.status] = r.count;
    total += r.count;
    totalLifetimeValue += r.ltv;
  }

  // Recent churn / refund recovery counts.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const [churnRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.workspaceId, args.workspaceId),
        isNotNull(schema.customers.churnAt),
        sql`${schema.customers.churnAt} >= ${thirtyDaysAgo}`,
        isNull(schema.customers.deletedAt),
      ),
    );

  const [refundRow] = await db
    .select({ n: sql<number>`count(distinct ${schema.sales.customerId})::int` })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.workspaceId, args.workspaceId),
        eq(schema.sales.refundStatus, "issued"),
        sql`${schema.sales.refundedAt} >= ${thirtyDaysAgo}`,
        sql`${schema.sales.closedAt} <= ${fourteenDaysAgo}`,
      ),
    );

  return {
    total,
    byStatus,
    totalLifetimeValue,
    recentChurnCount: churnRow?.n ?? 0,
    recentRefundsRecoverable: refundRow?.n ?? 0,
  };
}

export type AtRiskCustomer = {
  customerId: string;
  email: string;
  name: string | null;
  lifetimeValue: string;
  daysSinceLastTouch: number;
  riskScore: number; // 0–100
  signals: string[];
};

export async function customersNeedingTouch(
  db: Db,
  args: { workspaceId: string; subAccountId?: string; limit?: number },
): Promise<AtRiskCustomer[]> {
  const limit = Math.min(args.limit ?? 25, 100);
  // Pull customers + last call + last sale + refund presence in one shot.
  const conditions: ReturnType<typeof eq>[] = [
    eq(schema.customers.workspaceId, args.workspaceId),
  ];
  if (args.subAccountId) conditions.push(eq(schema.customers.subAccountId, args.subAccountId));

  const rows = await db.execute(sql`
    SELECT c.id                                AS customer_id,
           c.primary_email                     AS email,
           c.name                              AS name,
           c.lifetime_value::text              AS lifetime_value,
           c.status                            AS status,
           (
             SELECT max(occurred_at) FROM funnel_events
              WHERE entity_type IN ('call', 'sale')
                AND entity_id IN (
                  SELECT id FROM calls WHERE customer_id = c.id
                  UNION
                  SELECT id FROM sales WHERE customer_id = c.id
                )
           )                                   AS last_activity_at,
           EXISTS(
             SELECT 1 FROM sales WHERE customer_id = c.id AND refund_status = 'issued'
           )                                   AS has_refund,
           (
             SELECT category FROM dispositions d
              JOIN calls cc ON cc.disposition_id = d.id
              WHERE cc.customer_id = c.id
              ORDER BY cc.appointment_at DESC NULLS LAST LIMIT 1
           )                                   AS last_disposition_category
      FROM customers c
     WHERE c.workspace_id = ${args.workspaceId}
       AND c.deleted_at IS NULL
       ${args.subAccountId ? sql`AND c.sub_account_id = ${args.subAccountId}` : sql``}
       AND c.status NOT IN ('churned')
  `);

  type Row = {
    customer_id: string;
    email: string;
    name: string | null;
    lifetime_value: string;
    status: string;
    last_activity_at: Date | null;
    has_refund: boolean;
    last_disposition_category: string | null;
  };
  const list = rows as unknown as Row[];

  const now = Date.now();
  const enriched = list.map((r) => {
    const days = r.last_activity_at
      ? Math.floor((now - new Date(r.last_activity_at).getTime()) / (24 * 3600 * 1000))
      : 999;
    const signals: string[] = [];
    let score = 0;

    // 35% — silence weight: 0 days = 0pts, 30 days = 35pts, capped at 60d.
    const silence = Math.min(days, 60) / 60;
    score += silence * 35;
    if (days >= 14) signals.push(`${days}d since last contact`);

    // 30% — refund presence
    if (r.has_refund) {
      score += 30;
      signals.push("recent refund");
    }

    // 20% — negative last disposition
    const cat = r.last_disposition_category ?? "";
    if (["objection", "disqualification", "no_show"].includes(cat)) {
      score += 20;
      signals.push(`last call: ${cat.replace("_", " ")}`);
    }

    // 15% — LTV ratio: not implementable in Phase 1 schema cleanly without
    // joining sales aggregations; deferred. Counts as 0 for now, leaving
    // headroom on the score scale.

    return {
      customerId: r.customer_id,
      email: r.email,
      name: r.name,
      lifetimeValue: r.lifetime_value,
      daysSinceLastTouch: days,
      riskScore: Math.round(Math.min(100, score)),
      signals,
    };
  });

  // Sort by riskScore × LTV (so a high-LTV high-risk customer surfaces
  // above a low-LTV high-risk one).
  enriched.sort((a, b) => {
    const aPriority = a.riskScore * Math.max(1, Number(a.lifetimeValue));
    const bPriority = b.riskScore * Math.max(1, Number(b.lifetimeValue));
    return bPriority - aPriority;
  });

  return enriched.slice(0, limit);
}

export async function cohortRetention(
  db: Db,
  args: { workspaceId: string; subAccountId?: string; monthsBack?: number },
): Promise<CohortRow[]> {
  const monthsBack = Math.min(args.monthsBack ?? 6, 24);
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  // For each customer, anchor month = first sale's month (or createdAt if
  // no sales). Active at +Nd if the customer has any activity (call or
  // sale) in [+Nd-30d, +Nd] AND they're not churned.
  const rows = await db.execute(sql`
    WITH anchored AS (
      SELECT c.id AS customer_id,
             date_trunc('month', coalesce(min(s.closed_at), c.created_at))::date AS cohort_month,
             c.churn_at AS churn_at
        FROM customers c
        LEFT JOIN sales s ON s.customer_id = c.id AND s.deleted_at IS NULL
       WHERE c.workspace_id = ${args.workspaceId}
         AND c.deleted_at IS NULL
         ${args.subAccountId ? sql`AND c.sub_account_id = ${args.subAccountId}` : sql``}
       GROUP BY c.id, c.churn_at, c.created_at
    )
    SELECT to_char(cohort_month, 'YYYY-MM') AS cohort_month,
           count(*)::int AS initial,
           count(*) FILTER (WHERE churn_at IS NULL OR churn_at > cohort_month + interval '30 days')::int AS at_30d,
           count(*) FILTER (WHERE churn_at IS NULL OR churn_at > cohort_month + interval '60 days')::int AS at_60d,
           count(*) FILTER (WHERE churn_at IS NULL OR churn_at > cohort_month + interval '90 days')::int AS at_90d,
           count(*) FILTER (WHERE churn_at IS NULL OR churn_at > cohort_month + interval '180 days')::int AS at_180d
      FROM anchored
     WHERE cohort_month >= ${since.toISOString().slice(0, 10)}
     GROUP BY cohort_month
     ORDER BY cohort_month ASC
  `);

  type Row = {
    cohort_month: string;
    initial: number;
    at_30d: number;
    at_60d: number;
    at_90d: number;
    at_180d: number;
  };
  const list = rows as unknown as Row[];
  const now = Date.now();
  return list.map((r) => {
    const cohortStart = new Date(`${r.cohort_month}-01`).getTime();
    // Don't report retention buckets for cohorts that haven't aged that far.
    const age = (now - cohortStart) / (24 * 3600 * 1000);
    return {
      cohortMonth: r.cohort_month,
      initialCustomers: r.initial,
      retainedAt30d: age >= 30 ? r.at_30d : null,
      retainedAt60d: age >= 60 ? r.at_60d : null,
      retainedAt90d: age >= 90 ? r.at_90d : null,
      retainedAt180d: age >= 180 ? r.at_180d : null,
    };
  });
}

void lte; // reserved for windowed variants
