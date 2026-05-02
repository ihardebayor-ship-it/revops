// Per-rep ranked leaderboard with WoW trend.
// Used by the Manager dashboard.

import { sql } from "drizzle-orm";
import { type Db } from "@revops/db/client";
import { compareMetrics, previousPeriod, type Period, type Trend } from "./types";

export type LeaderboardEntry = {
  userId: string;
  email: string;
  name: string | null;
  attained: number;
  attainmentTrend: Trend;
  attainmentDeltaPct: number | null;
  closesCount: number;
  pipelineCount: number; // future scheduled calls owned
  /** Ratio of attained vs the median of the team this period — 1.0 = at
   *  median, >1 = above. Lets the UI show fairness. */
  vsMedian: number | null;
};

export type LeaderboardArgs = {
  workspaceId: string;
  subAccountId?: string;
  period: Period;
};

export async function leaderboard(db: Db, args: LeaderboardArgs): Promise<LeaderboardEntry[]> {
  const prev = previousPeriod(args.period);

  // Per-user attainment (current + previous), weighted by share_pct on
  // commission_recipients. Joined to user table for email/name.
  const rows = await db.execute(sql`
    WITH cur AS (
      SELECT cr.user_id,
             coalesce(sum(s.booked_amount * cr.share_pct), 0)::float AS attained,
             count(distinct s.id)::int AS closes
        FROM commission_recipients cr
        JOIN sales s ON s.id = cr.sale_id
       WHERE s.workspace_id = ${args.workspaceId}
         AND s.deleted_at IS NULL
         AND cr.deleted_at IS NULL
         AND s.closed_at >= ${args.period.from}
         AND s.closed_at <= ${args.period.to}
         ${args.subAccountId ? sql`AND s.sub_account_id = ${args.subAccountId}` : sql``}
       GROUP BY cr.user_id
    ),
    prev AS (
      SELECT cr.user_id,
             coalesce(sum(s.booked_amount * cr.share_pct), 0)::float AS attained
        FROM commission_recipients cr
        JOIN sales s ON s.id = cr.sale_id
       WHERE s.workspace_id = ${args.workspaceId}
         AND s.deleted_at IS NULL
         AND cr.deleted_at IS NULL
         AND s.closed_at >= ${prev.from}
         AND s.closed_at <= ${prev.to}
         ${args.subAccountId ? sql`AND s.sub_account_id = ${args.subAccountId}` : sql``}
       GROUP BY cr.user_id
    ),
    pipe AS (
      SELECT closer_user_id AS user_id, count(*)::int AS pipe_count
        FROM calls
       WHERE workspace_id = ${args.workspaceId}
         AND deleted_at IS NULL
         AND appointment_at >= now()
         AND closer_user_id IS NOT NULL
         ${args.subAccountId ? sql`AND sub_account_id = ${args.subAccountId}` : sql``}
       GROUP BY closer_user_id
    )
    SELECT u.id          AS user_id,
           u.email       AS email,
           u.name        AS name,
           coalesce(cur.attained, 0)::float AS attained,
           coalesce(prev.attained, 0)::float AS prev_attained,
           coalesce(cur.closes, 0)::int     AS closes_count,
           coalesce(pipe.pipe_count, 0)::int AS pipeline_count
      FROM "user" u
      JOIN memberships m ON m.user_id = u.id
                        AND m.workspace_id = ${args.workspaceId}
                        AND m.deleted_at IS NULL
      LEFT JOIN cur  ON cur.user_id  = u.id
      LEFT JOIN prev ON prev.user_id = u.id
      LEFT JOIN pipe ON pipe.user_id = u.id
     WHERE coalesce(cur.attained, 0) > 0
        OR coalesce(prev.attained, 0) > 0
        OR coalesce(pipe.pipe_count, 0) > 0
     ORDER BY attained DESC
  `);

  type Row = {
    user_id: string;
    email: string;
    name: string | null;
    attained: number;
    prev_attained: number;
    closes_count: number;
    pipeline_count: number;
  };
  const list = (rows as unknown as Row[]).map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    attained: r.attained,
    closesCount: r.closes_count,
    pipelineCount: r.pipeline_count,
    prevAttained: r.prev_attained,
  }));

  // Compute team median attained for fairness lens.
  const attaineds = list.map((e) => e.attained).filter((v) => v > 0);
  const teamMedian = attaineds.length ? medianValue(attaineds) : 0;

  return list.map((e) => {
    const cmp = compareMetrics(e.attained, e.prevAttained || null);
    return {
      userId: e.userId,
      email: e.email,
      name: e.name,
      attained: e.attained,
      attainmentTrend: cmp.trend,
      attainmentDeltaPct: cmp.deltaPct,
      closesCount: e.closesCount,
      pipelineCount: e.pipelineCount,
      vsMedian: teamMedian > 0 ? e.attained / teamMedian : null,
    };
  });
}

function medianValue(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
