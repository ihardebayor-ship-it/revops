// Speed-to-lead distribution + breach metrics.
//
// "Speed-to-lead" = elapsed time from optin.submittedAt to optin.contactedAt.
// SLA = workspace_settings.speedToLeadSlaSeconds (default 300 = 5 min).
// We compute median, p90, breach count + rate over the requested period.

import { and, count, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { Period } from "./types";

export type SpeedArgs = {
  workspaceId: string;
  subAccountId?: string;
  period: Period;
  slaSeconds?: number;
};

export type SpeedResult = {
  contactedCount: number;
  uncontactedCount: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  breachCount: number;
  breachRatePct: number | null; // 0–1, null when contactedCount = 0
  slaSeconds: number;
};

export async function speedToLead(db: Db, args: SpeedArgs): Promise<SpeedResult> {
  const slaSeconds = args.slaSeconds ?? 300;

  const conditions = [
    eq(schema.optins.workspaceId, args.workspaceId),
    gte(schema.optins.submittedAt, args.period.from),
    lte(schema.optins.submittedAt, args.period.to),
  ];
  if (args.subAccountId) conditions.push(eq(schema.optins.subAccountId, args.subAccountId));

  // Pull seconds-to-contact for every contacted optin in window. We sort
  // in-memory for percentiles since the volume is bounded by lead count
  // per period, not by N rows in the table.
  const contactedRows = await db
    .select({
      seconds: sql<number>`extract(epoch from (${schema.optins.contactedAt} - ${schema.optins.submittedAt}))::float`,
    })
    .from(schema.optins)
    .where(and(...conditions, isNotNull(schema.optins.contactedAt)));

  const seconds = contactedRows
    .map((r) => r.seconds)
    .filter((v): v is number => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  const [uncontactedRow] = await db
    .select({ n: count() })
    .from(schema.optins)
    .where(and(...conditions, isNull(schema.optins.contactedAt)));

  const breachCount = seconds.filter((s) => s > slaSeconds).length;
  return {
    contactedCount: seconds.length,
    uncontactedCount: uncontactedRow?.n ?? 0,
    medianSeconds: seconds.length ? percentile(seconds, 0.5) : null,
    p90Seconds: seconds.length ? percentile(seconds, 0.9) : null,
    breachCount,
    breachRatePct: seconds.length ? breachCount / seconds.length : null,
    slaSeconds,
  };
}

// Pure helper, unit-tested.
export function percentile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sortedValues.length) {
    return sortedValues[base]! + rest * (sortedValues[base + 1]! - sortedValues[base]!);
  }
  return sortedValues[base]!;
}
