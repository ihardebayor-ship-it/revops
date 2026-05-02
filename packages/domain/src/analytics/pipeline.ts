// Pipeline health: weighted forward value + coverage ratio + aging.
//
// "Pipeline" = scheduled-but-not-yet-completed calls × historical
// conversion rates × workspace's average deal size. This is the standard
// sales-ops definition adapted to our schema (we don't have explicit
// opportunity-stage probabilities; we infer them from funnel rates).

import { and, count, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

const NOW_BUCKET_BREAKPOINTS_DAYS = [7, 14, 30] as const;

export type PipelineArgs = {
  workspaceId: string;
  subAccountId?: string;
  userId?: string; // closer for the user-scoped variant
  /** Quota gap to compute coverage ratio; null = no quota set, ratio is null. */
  quotaGap?: number;
  /** Default 90 days. Look-back for "historical avg deal size" + "win rate". */
  historyWindowDays?: number;
};

export type PipelineHealth = {
  totalCallCount: number;
  weightedPipelineValue: number; // expected $ from these calls if they convert at historical rate
  avgDealSize: number;
  historicalCloseRate: number; // 0–1: calls → sales over the history window
  coverageRatio: number | null; // weightedPipelineValue / quotaGap
  agingBuckets: {
    next7d: number;
    next7to14d: number;
    next14to30d: number;
    over30d: number;
  };
  staleCallCount: number; // appointment in the past + not completed/dispositioned
};

export async function pipelineHealth(db: Db, args: PipelineArgs): Promise<PipelineHealth> {
  const historyWindowDays = args.historyWindowDays ?? 90;
  const now = new Date();
  const horizonStart = new Date(now.getTime() - historyWindowDays * 24 * 3600 * 1000);

  // Historical close rate: (sales linked to a call closed in window) / (calls completed in window).
  const callConditions = [
    eq(schema.calls.workspaceId, args.workspaceId),
    isNull(schema.calls.deletedAt),
    isNotNull(schema.calls.completedAt),
    gte(schema.calls.completedAt, horizonStart),
  ];
  if (args.subAccountId) callConditions.push(eq(schema.calls.subAccountId, args.subAccountId));
  if (args.userId) callConditions.push(eq(schema.calls.closerUserId, args.userId));

  const [callsCompletedRow] = await db
    .select({ n: count() })
    .from(schema.calls)
    .where(and(...callConditions));
  const callsCompleted = callsCompletedRow?.n ?? 0;

  const saleConditions = [
    eq(schema.sales.workspaceId, args.workspaceId),
    isNull(schema.sales.deletedAt),
    isNotNull(schema.sales.linkedCallId),
    gte(schema.sales.closedAt, horizonStart),
  ];
  if (args.subAccountId) saleConditions.push(eq(schema.sales.subAccountId, args.subAccountId));

  // For user-scoped pipeline, "won" means sale where this user is a recipient.
  let salesWonValue = 0;
  let salesWonCount = 0;
  if (args.userId) {
    const [row] = await db
      .select({
        count: sql<number>`count(distinct s.id)::int`,
        total: sql<number>`coalesce(sum(s.booked_amount), 0)::float`,
      })
      .from(sql`sales s JOIN commission_recipients cr ON cr.sale_id = s.id`)
      .where(
        sql`s.workspace_id = ${args.workspaceId}
          AND s.deleted_at IS NULL
          AND s.linked_call_id IS NOT NULL
          AND cr.user_id = ${args.userId}
          AND cr.deleted_at IS NULL
          AND s.closed_at >= ${horizonStart}
          ${args.subAccountId ? sql`AND s.sub_account_id = ${args.subAccountId}` : sql``}`,
      );
    salesWonCount = row?.count ?? 0;
    salesWonValue = row?.total ?? 0;
  } else {
    const [row] = await db
      .select({
        count: count(),
        total: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
      })
      .from(schema.sales)
      .where(and(...saleConditions));
    salesWonCount = row?.count ?? 0;
    salesWonValue = row?.total ?? 0;
  }

  const historicalCloseRate = callsCompleted === 0 ? 0 : salesWonCount / callsCompleted;
  const avgDealSize = salesWonCount === 0 ? 0 : salesWonValue / salesWonCount;

  // Forward pipeline: scheduled appointments in the future.
  const futureConditions = [
    eq(schema.calls.workspaceId, args.workspaceId),
    isNull(schema.calls.deletedAt),
    isNotNull(schema.calls.appointmentAt),
    gte(schema.calls.appointmentAt, now),
  ];
  if (args.subAccountId) futureConditions.push(eq(schema.calls.subAccountId, args.subAccountId));
  if (args.userId) futureConditions.push(eq(schema.calls.closerUserId, args.userId));

  const [futureRow] = await db
    .select({ n: count() })
    .from(schema.calls)
    .where(and(...futureConditions));
  const totalCallCount = futureRow?.n ?? 0;

  const weightedPipelineValue = totalCallCount * avgDealSize * historicalCloseRate;

  // Aging buckets — counts of forward-looking calls in each window.
  const buckets = await Promise.all(
    NOW_BUCKET_BREAKPOINTS_DAYS.map(async (boundary, idx) => {
      const lower =
        idx === 0
          ? now
          : new Date(now.getTime() + NOW_BUCKET_BREAKPOINTS_DAYS[idx - 1]! * 24 * 3600 * 1000);
      const upper = new Date(now.getTime() + boundary * 24 * 3600 * 1000);
      const conditions = [
        eq(schema.calls.workspaceId, args.workspaceId),
        isNull(schema.calls.deletedAt),
        isNotNull(schema.calls.appointmentAt),
        gte(schema.calls.appointmentAt, lower),
        lte(schema.calls.appointmentAt, upper),
      ];
      if (args.subAccountId) conditions.push(eq(schema.calls.subAccountId, args.subAccountId));
      if (args.userId) conditions.push(eq(schema.calls.closerUserId, args.userId));
      const [row] = await db
        .select({ n: count() })
        .from(schema.calls)
        .where(and(...conditions));
      return row?.n ?? 0;
    }),
  );
  const over30Conditions = [
    eq(schema.calls.workspaceId, args.workspaceId),
    isNull(schema.calls.deletedAt),
    isNotNull(schema.calls.appointmentAt),
    gte(schema.calls.appointmentAt, new Date(now.getTime() + 30 * 24 * 3600 * 1000)),
  ];
  if (args.subAccountId) over30Conditions.push(eq(schema.calls.subAccountId, args.subAccountId));
  if (args.userId) over30Conditions.push(eq(schema.calls.closerUserId, args.userId));
  const [over30Row] = await db
    .select({ n: count() })
    .from(schema.calls)
    .where(and(...over30Conditions));
  const over30d = over30Row?.n ?? 0;

  // Stale: appointment in the past, not completed, no disposition.
  const staleConditions = [
    eq(schema.calls.workspaceId, args.workspaceId),
    isNull(schema.calls.deletedAt),
    isNull(schema.calls.completedAt),
    isNull(schema.calls.dispositionId),
    isNotNull(schema.calls.appointmentAt),
    lte(schema.calls.appointmentAt, now),
  ];
  if (args.subAccountId) staleConditions.push(eq(schema.calls.subAccountId, args.subAccountId));
  if (args.userId) staleConditions.push(eq(schema.calls.closerUserId, args.userId));
  const [staleRow] = await db
    .select({ n: count() })
    .from(schema.calls)
    .where(and(...staleConditions));
  const staleCallCount = staleRow?.n ?? 0;

  const coverageRatio =
    args.quotaGap && args.quotaGap > 0 ? weightedPipelineValue / args.quotaGap : null;

  return {
    totalCallCount,
    weightedPipelineValue,
    avgDealSize,
    historicalCloseRate,
    coverageRatio,
    agingBuckets: {
      next7d: buckets[0]!,
      next7to14d: buckets[1]!,
      next14to30d: buckets[2]!,
      over30d,
    },
    staleCallCount,
  };
}
