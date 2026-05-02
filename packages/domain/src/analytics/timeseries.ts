// Time-bucketed aggregates for sparklines. Cheap by design: daily/weekly
// buckets over the requested window, no materialized views yet (Phase 2
// when volume justifies it).
//
// Every series function returns a stable [from..to] array — buckets with
// zero rows are still present with value=0 — so the UI can render
// sparklines without gap-filling.

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { BucketGranularity, Period, TimeseriesPoint } from "./types";

function bucketExpr(column: string, granularity: BucketGranularity): string {
  return granularity === "week"
    ? `date_trunc('week', ${column})::date`
    : `date_trunc('day', ${column})::date`;
}

function emptyBuckets(period: Period, granularity: BucketGranularity): TimeseriesPoint[] {
  const stepMs = granularity === "week" ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
  const out: TimeseriesPoint[] = [];
  // Anchor to UTC midnight to match date_trunc('day', …)::date.
  const startMs = Date.UTC(
    period.from.getUTCFullYear(),
    period.from.getUTCMonth(),
    period.from.getUTCDate(),
  );
  const endMs = Date.UTC(
    period.to.getUTCFullYear(),
    period.to.getUTCMonth(),
    period.to.getUTCDate(),
  );
  for (let t = startMs; t <= endMs; t += stepMs) {
    out.push({ bucket: new Date(t).toISOString().slice(0, 10), value: 0 });
  }
  return out;
}

function mergeBuckets(
  empty: TimeseriesPoint[],
  rows: { bucket: string; value: number }[],
): TimeseriesPoint[] {
  const m = new Map(rows.map((r) => [r.bucket, r.value]));
  return empty.map((b) => ({ bucket: b.bucket, value: m.get(b.bucket) ?? 0 }));
}

export type SeriesArgs = {
  workspaceId: string;
  subAccountId?: string;
  userId?: string; // optional rep filter
  period: Period;
  granularity?: BucketGranularity;
};

export async function bookedAmountSeries(db: Db, args: SeriesArgs): Promise<TimeseriesPoint[]> {
  const granularity = args.granularity ?? "day";
  const empty = emptyBuckets(args.period, granularity);
  const conditions = [
    eq(schema.sales.workspaceId, args.workspaceId),
    isNull(schema.sales.deletedAt),
    gte(schema.sales.closedAt, args.period.from),
    lte(schema.sales.closedAt, args.period.to),
  ];
  if (args.subAccountId) conditions.push(eq(schema.sales.subAccountId, args.subAccountId));

  // Per-user attribution joins commission_recipients so each row weights
  // by sharePct (so a $5k sale at 20% counts $1k for the setter).
  if (args.userId) {
    const rows = await db
      .select({
        bucket: sql<string>`${sql.raw(bucketExpr("s.closed_at", granularity))}::text`,
        value: sql<number>`coalesce(sum(s.booked_amount * cr.share_pct), 0)::float`,
      })
      .from(sql`sales s JOIN commission_recipients cr ON cr.sale_id = s.id`)
      .where(
        sql`s.workspace_id = ${args.workspaceId}
          AND s.deleted_at IS NULL
          AND cr.user_id = ${args.userId}
          AND cr.deleted_at IS NULL
          AND s.closed_at >= ${args.period.from}
          AND s.closed_at <= ${args.period.to}
          ${args.subAccountId ? sql`AND s.sub_account_id = ${args.subAccountId}` : sql``}`,
      )
      .groupBy(sql.raw(bucketExpr("s.closed_at", granularity)))
      .orderBy(sql.raw(bucketExpr("s.closed_at", granularity)));
    return mergeBuckets(empty, rows);
  }

  const rows = await db
    .select({
      bucket: sql<string>`${sql.raw(bucketExpr("closed_at", granularity))}::text`,
      value: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float`,
    })
    .from(schema.sales)
    .where(and(...conditions))
    .groupBy(sql.raw(bucketExpr("closed_at", granularity)))
    .orderBy(sql.raw(bucketExpr("closed_at", granularity)));
  return mergeBuckets(empty, rows);
}

export async function callCountSeries(db: Db, args: SeriesArgs): Promise<TimeseriesPoint[]> {
  const granularity = args.granularity ?? "day";
  const empty = emptyBuckets(args.period, granularity);
  const conditions = [
    eq(schema.calls.workspaceId, args.workspaceId),
    isNull(schema.calls.deletedAt),
    gte(schema.calls.appointmentAt, args.period.from),
    lte(schema.calls.appointmentAt, args.period.to),
  ];
  if (args.subAccountId) conditions.push(eq(schema.calls.subAccountId, args.subAccountId));
  if (args.userId) conditions.push(eq(schema.calls.closerUserId, args.userId));

  const rows = await db
    .select({
      bucket: sql<string>`${sql.raw(bucketExpr("appointment_at", granularity))}::text`,
      value: sql<number>`count(*)::int`,
    })
    .from(schema.calls)
    .where(and(...conditions))
    .groupBy(sql.raw(bucketExpr("appointment_at", granularity)))
    .orderBy(sql.raw(bucketExpr("appointment_at", granularity)));
  return mergeBuckets(empty, rows);
}

export async function commissionAvailableSeries(
  db: Db,
  args: SeriesArgs,
): Promise<TimeseriesPoint[]> {
  // Sum of commission entries whose available_at lands in each bucket.
  // Used by the "pending hold-release timeline" chart.
  const granularity = args.granularity ?? "day";
  const empty = emptyBuckets(args.period, granularity);
  const conditions = [
    eq(schema.commissionEntries.workspaceId, args.workspaceId),
    sql`${schema.commissionEntries.availableAt} IS NOT NULL`,
    gte(schema.commissionEntries.availableAt, args.period.from),
    lte(schema.commissionEntries.availableAt, args.period.to),
  ];
  if (args.userId) conditions.push(eq(schema.commissionEntries.recipientUserId, args.userId));
  if (args.subAccountId)
    conditions.push(eq(schema.commissionEntries.subAccountId, args.subAccountId));

  const rows = await db
    .select({
      bucket: sql<string>`${sql.raw(bucketExpr("available_at", granularity))}::text`,
      value: sql<number>`coalesce(sum(${schema.commissionEntries.amount}), 0)::float`,
    })
    .from(schema.commissionEntries)
    .where(and(...conditions))
    .groupBy(sql.raw(bucketExpr("available_at", granularity)))
    .orderBy(sql.raw(bucketExpr("available_at", granularity)));
  return mergeBuckets(empty, rows);
}

// Helper for tests + UI that need the synthesizable "empty bucket" shape.
export const _internal = { emptyBuckets, mergeBuckets };
