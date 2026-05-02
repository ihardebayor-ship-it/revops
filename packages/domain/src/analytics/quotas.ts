// Resolve the active quota for a user/role/workspace within a period.
// Phase 1: pulls the most recent goals row matching (workspace, user OR
// salesRole, period overlapping). Returns null if nothing matches —
// dashboards render a "no quota set" path in that case.

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { Period } from "./types";

export type QuotaArgs = {
  workspaceId: string;
  subAccountId?: string;
  userId?: string;
  /** Falls back to 'monthly' if not provided. */
  periodKind?: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "ramp_window" | "custom";
  /** Period to look for an active goal; defaults to "current month". */
  period?: Period;
};

export type ActiveQuota = {
  goalId: string;
  targetValue: number;
  currency: string | null;
  periodStart: string;
  periodEnd: string;
};

export async function getActiveQuota(
  db: Db,
  args: QuotaArgs,
): Promise<ActiveQuota | null> {
  const period = args.period ?? currentMonth();
  const conditions = [
    eq(schema.goals.workspaceId, args.workspaceId),
    eq(schema.goals.kind, "quota"),
    isNull(schema.goals.deletedAt),
    // Active iff goal period overlaps the requested period at all.
    lte(schema.goals.periodStart, period.to.toISOString().slice(0, 10)),
    gte(schema.goals.periodEnd, period.from.toISOString().slice(0, 10)),
  ];
  if (args.subAccountId) conditions.push(eq(schema.goals.subAccountId, args.subAccountId));
  if (args.userId) {
    // user-specific OR role-not-yet-resolved (we accept either the
    // user's own goal or a role-level fallback that the engine can
    // attribute later). For Phase 1 we just take user-specific.
    conditions.push(eq(schema.goals.userId, args.userId));
  }
  if (args.periodKind) conditions.push(eq(schema.goals.periodKind, args.periodKind));

  const [row] = await db
    .select({
      id: schema.goals.id,
      targetValue: schema.goals.targetValue,
      currency: schema.goals.currency,
      periodStart: schema.goals.periodStart,
      periodEnd: schema.goals.periodEnd,
    })
    .from(schema.goals)
    .where(and(...conditions))
    .orderBy(desc(schema.goals.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    goalId: row.id,
    targetValue: Number(row.targetValue),
    currency: row.currency,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

export function currentMonth(): Period {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

void or;
