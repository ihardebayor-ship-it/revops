// Quota attainment + linear forecast.
//
// Phase 1 forecast = simple linear extrapolation from current pace
// (attained / daysElapsed * totalDays). Confidence band is a fixed ±15%
// until we have enough historical periods to compute std-dev empirically.
// Once we do, swap in a band-from-history function — same return shape.

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { Period } from "./types";

export type AttainmentArgs = {
  workspaceId: string;
  subAccountId?: string;
  userId?: string;
  quota: number;
  period: Period;
  /** Default now(). Overridable for golden-test reproducibility. */
  asOf?: Date;
};

export type AttainmentResult = {
  quota: number;
  attained: number;
  attainmentPct: number; // 0–1+ (can exceed when over-quota)
  daysElapsed: number;
  daysRemaining: number;
  totalDays: number;
  paceFromHistory: number; // expected by today on a linear pace to quota
  forecastEnd: number; // projected end-of-period
  forecastConfidenceLow: number;
  forecastConfidenceHigh: number;
  requiredDailyRunRate: number; // $/day to hit quota in the days remaining
  status: "ahead" | "on_pace" | "behind" | "at_risk";
};

const CONFIDENCE_BAND = 0.15;

export async function attainment(db: Db, args: AttainmentArgs): Promise<AttainmentResult> {
  const asOf = args.asOf ?? new Date();
  const totalDays = Math.max(
    1,
    Math.ceil((args.period.to.getTime() - args.period.from.getTime()) / (24 * 3600 * 1000)),
  );
  const daysElapsed = Math.max(
    0,
    Math.min(
      totalDays,
      Math.ceil((asOf.getTime() - args.period.from.getTime()) / (24 * 3600 * 1000)),
    ),
  );
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  // Sum of attributed booked amount in period. With userId we weight by
  // sharePct via commission_recipients; without, total booked.
  let attained = 0;
  if (args.userId) {
    const [row] = await db
      .select({
        v: sql<number>`coalesce(sum(s.booked_amount * cr.share_pct), 0)::float`,
      })
      .from(sql`sales s JOIN commission_recipients cr ON cr.sale_id = s.id`)
      .where(
        sql`s.workspace_id = ${args.workspaceId}
          AND s.deleted_at IS NULL
          AND cr.user_id = ${args.userId}
          AND cr.deleted_at IS NULL
          AND s.closed_at >= ${args.period.from}
          AND s.closed_at <= ${asOf}
          ${args.subAccountId ? sql`AND s.sub_account_id = ${args.subAccountId}` : sql``}`,
      );
    attained = row?.v ?? 0;
  } else {
    const conditions = [
      eq(schema.sales.workspaceId, args.workspaceId),
      isNull(schema.sales.deletedAt),
      gte(schema.sales.closedAt, args.period.from),
      lte(schema.sales.closedAt, asOf),
    ];
    if (args.subAccountId) conditions.push(eq(schema.sales.subAccountId, args.subAccountId));
    const [row] = await db
      .select({ v: sql<number>`coalesce(sum(${schema.sales.bookedAmount}), 0)::float` })
      .from(schema.sales)
      .where(and(...conditions));
    attained = row?.v ?? 0;
  }

  return computeAttainment({
    quota: args.quota,
    attained,
    daysElapsed,
    daysRemaining,
    totalDays,
  });
}

// Pure half — extracted for unit tests + reuse from agent tools that
// already have an attained number in hand.
export function computeAttainment(args: {
  quota: number;
  attained: number;
  daysElapsed: number;
  daysRemaining: number;
  totalDays: number;
}): AttainmentResult {
  const { quota, attained, daysElapsed, daysRemaining, totalDays } = args;
  const attainmentPct = quota > 0 ? attained / quota : 0;
  const paceFromHistory = quota * (daysElapsed / totalDays);
  const dailyRate = daysElapsed > 0 ? attained / daysElapsed : 0;
  const forecastEnd = dailyRate * totalDays;
  const forecastConfidenceLow = forecastEnd * (1 - CONFIDENCE_BAND);
  const forecastConfidenceHigh = forecastEnd * (1 + CONFIDENCE_BAND);
  const remaining = Math.max(0, quota - attained);
  const requiredDailyRunRate = daysRemaining > 0 ? remaining / daysRemaining : 0;

  // Status thresholds tuned for sales-cycle psychology:
  //   ahead:    on track to exceed quota by >5%
  //   on_pace:  forecast within ±5% of quota
  //   behind:   forecast 70-95% of quota — recoverable with effort
  //   at_risk:  forecast <70% — needs intervention
  let status: AttainmentResult["status"];
  if (quota === 0) status = "on_pace";
  else if (forecastEnd >= quota * 1.05) status = "ahead";
  else if (forecastEnd >= quota * 0.95) status = "on_pace";
  else if (forecastEnd >= quota * 0.7) status = "behind";
  else status = "at_risk";

  return {
    quota,
    attained,
    attainmentPct,
    daysElapsed,
    daysRemaining,
    totalDays,
    paceFromHistory,
    forecastEnd,
    forecastConfidenceLow,
    forecastConfidenceHigh,
    requiredDailyRunRate,
    status,
  };
}
