// Goals domain — OTE / quota / ramp / target with accelerators.
//
// Phase 1 focuses on quota since every dashboard's forecast depends on it.
// What separates this from a typical sales-tool quota editor:
//
//   1. getTeamGoalsGrid: returns a per-period team grid data shape so the
//      manager sees (rows=members) × (cols=prev/current/next) at a glance.
//   2. getQuotaContext: returns the user's last 3 comparable-period actuals
//      so the editor shows live calibration ("avg $47k, best $51k").
//   3. findOverlappingGoals: detects period-overlap on (user, kind) so we
//      reject ambiguous quota lookups at write time, not at attainment time.

import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type GoalKind = "ote" | "quota" | "ramp" | "target";
export type PeriodKind =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "ramp_window"
  | "custom";

export type GoalListItem = {
  id: string;
  kind: GoalKind;
  metric: string;
  targetValue: string;
  currency: string | null;
  periodKind: PeriodKind;
  periodStart: string;
  periodEnd: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  salesRoleId: string | null;
  salesRoleLabel: string | null;
  createdAt: Date;
};

export async function listGoals(
  db: Db,
  args: { workspaceId: string; subAccountId: string },
): Promise<GoalListItem[]> {
  const rows = await db
    .select({
      id: schema.goals.id,
      kind: schema.goals.kind,
      metric: schema.goals.metric,
      targetValue: schema.goals.targetValue,
      currency: schema.goals.currency,
      periodKind: schema.goals.periodKind,
      periodStart: schema.goals.periodStart,
      periodEnd: schema.goals.periodEnd,
      userId: schema.goals.userId,
      userName: schema.user.name,
      userEmail: schema.user.email,
      salesRoleId: schema.goals.salesRoleId,
      salesRoleLabel: schema.salesRoles.label,
      createdAt: schema.goals.createdAt,
    })
    .from(schema.goals)
    .leftJoin(schema.user, eq(schema.user.id, schema.goals.userId))
    .leftJoin(schema.salesRoles, eq(schema.salesRoles.id, schema.goals.salesRoleId))
    .where(
      and(
        eq(schema.goals.workspaceId, args.workspaceId),
        eq(schema.goals.subAccountId, args.subAccountId),
        isNull(schema.goals.deletedAt),
      ),
    )
    .orderBy(desc(schema.goals.periodStart), asc(schema.goals.kind));
  return rows as GoalListItem[];
}

export type CreateGoalInput = {
  workspaceId: string;
  subAccountId: string;
  actorUserId: string;
  kind: GoalKind;
  metric: string;
  targetValue: string;
  currency?: string | null;
  periodKind: PeriodKind;
  periodStart: string;
  periodEnd: string;
  userId?: string | null;
  salesRoleId?: string | null;
};

export async function createGoal(db: Db, input: CreateGoalInput) {
  if (!input.userId && !input.salesRoleId) {
    throw new Error("Goal must target a user OR a sales role (got neither).");
  }
  if (Number(input.targetValue) <= 0) {
    throw new Error("Target value must be > 0");
  }
  if (input.periodStart > input.periodEnd) {
    throw new Error("Period start must be on or before period end");
  }

  await assertGoalTargetInSubAccount(db, input);

  // Soundness: reject overlapping quotas for the same user/kind. Two
  // quota rows whose date ranges intersect would make
  // analytics.getActiveQuota() ambiguous (it picks the most recent and
  // discards the rest — silent data loss).
  if (input.userId && input.kind === "quota") {
    const overlapping = await findOverlappingGoals(db, {
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      userId: input.userId,
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    if (overlapping.length > 0) {
      throw new Error(
        `Overlapping quota exists for this user (${overlapping[0]!.periodStart}..${overlapping[0]!.periodEnd}). Edit that one or pick a non-overlapping period.`,
      );
    }
  }

  const [row] = await db
    .insert(schema.goals)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      kind: input.kind,
      metric: input.metric,
      targetValue: input.targetValue,
      currency: input.currency ?? "USD",
      periodKind: input.periodKind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      userId: input.userId ?? null,
      salesRoleId: input.salesRoleId ?? null,
      createdBy: input.actorUserId,
    })
    .returning({ id: schema.goals.id });
  if (!row) throw new Error("Failed to create goal");
  return { goalId: row.id };
}

export type UpdateGoalInput = {
  goalId: string;
  workspaceId: string;
  subAccountId: string;
  patch: Partial<{
    kind: GoalKind;
    metric: string;
    targetValue: string;
    currency: string | null;
    periodKind: PeriodKind;
    periodStart: string;
    periodEnd: string;
  }>;
};

export async function updateGoal(db: Db, input: UpdateGoalInput) {
  const setPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.patch.kind !== undefined) setPatch.kind = input.patch.kind;
  if (input.patch.metric !== undefined) setPatch.metric = input.patch.metric;
  if (input.patch.targetValue !== undefined) {
    if (Number(input.patch.targetValue) <= 0) {
      throw new Error("Target value must be > 0");
    }
    setPatch.targetValue = input.patch.targetValue;
  }
  if (input.patch.currency !== undefined) setPatch.currency = input.patch.currency;
  if (input.patch.periodKind !== undefined) setPatch.periodKind = input.patch.periodKind;
  if (input.patch.periodStart !== undefined) setPatch.periodStart = input.patch.periodStart;
  if (input.patch.periodEnd !== undefined) setPatch.periodEnd = input.patch.periodEnd;

  await db
    .update(schema.goals)
    .set(setPatch)
    .where(
      and(
        eq(schema.goals.id, input.goalId),
        eq(schema.goals.workspaceId, input.workspaceId),
        eq(schema.goals.subAccountId, input.subAccountId),
        isNull(schema.goals.deletedAt),
      ),
    );
  return { goalId: input.goalId };
}

export async function softDeleteGoal(
  db: Db,
  args: { goalId: string; workspaceId: string; subAccountId: string },
) {
  await db
    .update(schema.goals)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.goals.id, args.goalId),
        eq(schema.goals.workspaceId, args.workspaceId),
        eq(schema.goals.subAccountId, args.subAccountId),
      ),
    );
  return { goalId: args.goalId };
}

// ─── Differentiators ──────────────────────────────────────────────

export async function findOverlappingGoals(
  db: Db,
  args: {
    workspaceId: string;
    subAccountId: string;
    userId: string;
    kind: GoalKind;
    periodStart: string;
    periodEnd: string;
    excludeGoalId?: string;
  },
): Promise<Array<{ id: string; periodStart: string; periodEnd: string; targetValue: string }>> {
  const conditions = [
    eq(schema.goals.workspaceId, args.workspaceId),
    eq(schema.goals.subAccountId, args.subAccountId),
    eq(schema.goals.userId, args.userId),
    eq(schema.goals.kind, args.kind),
    isNull(schema.goals.deletedAt),
    // Overlap test: A.start <= B.end AND A.end >= B.start
    lte(schema.goals.periodStart, args.periodEnd),
    gte(schema.goals.periodEnd, args.periodStart),
  ];
  if (args.excludeGoalId) conditions.push(ne(schema.goals.id, args.excludeGoalId));
  return db
    .select({
      id: schema.goals.id,
      periodStart: schema.goals.periodStart,
      periodEnd: schema.goals.periodEnd,
      targetValue: schema.goals.targetValue,
    })
    .from(schema.goals)
    .where(and(...conditions));
}

async function assertGoalTargetInSubAccount(db: Db, input: CreateGoalInput) {
  if (input.userId) {
    const [member] = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, input.workspaceId),
          eq(schema.memberships.subAccountId, input.subAccountId),
          eq(schema.memberships.userId, input.userId),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .limit(1);
    if (!member) throw new Error("Goal user must belong to the selected sub-account");
  }

  if (input.salesRoleId) {
    const [role] = await db
      .select({ id: schema.salesRoles.id })
      .from(schema.salesRoles)
      .innerJoin(
        schema.salesRoleAssignments,
        eq(schema.salesRoleAssignments.salesRoleId, schema.salesRoles.id),
      )
      .where(
        and(
          eq(schema.salesRoles.id, input.salesRoleId),
          eq(schema.salesRoles.workspaceId, input.workspaceId),
          eq(schema.salesRoleAssignments.subAccountId, input.subAccountId),
          isNull(schema.salesRoles.deletedAt),
          isNull(schema.salesRoleAssignments.deletedAt),
        ),
      )
      .limit(1);
    if (!role) throw new Error("Goal sales role must belong to the selected sub-account");
  }
}

export type QuotaContext = {
  userId: string;
  recentActuals: Array<{
    periodStart: string;
    periodEnd: string;
    actual: number;
  }>;
  avgRecent: number;
  bestRecent: number;
  lastQuota: { targetValue: number; periodStart: string; periodEnd: string } | null;
};

/**
 * Live calibration data for the goal editor: the user's last 3
 * monthly-equivalent actuals + their last quota. The form uses this to
 * show "this $55k target = 117% of your avg" while the manager types.
 */
export async function getQuotaContext(
  db: Db,
  args: { workspaceId: string; subAccountId: string; userId: string; periodKind: PeriodKind },
): Promise<QuotaContext> {
  const periods = lastNPeriods(args.periodKind, 3);

  const recentActuals = await Promise.all(
    periods.map(async (p) => {
      const [row] = await db
        .select({
          v: sql<number>`coalesce(sum(s.booked_amount * cr.share_pct), 0)::float`,
        })
        .from(sql`sales s JOIN commission_recipients cr ON cr.sale_id = s.id`)
        .where(
          sql`s.workspace_id = ${args.workspaceId}
            AND s.sub_account_id = ${args.subAccountId}
            AND s.deleted_at IS NULL
            AND cr.user_id = ${args.userId}
            AND cr.sub_account_id = ${args.subAccountId}
            AND cr.deleted_at IS NULL
            AND s.closed_at >= ${p.from}
            AND s.closed_at < ${p.to}`,
        );
      return {
        periodStart: p.from.toISOString().slice(0, 10),
        periodEnd: new Date(p.to.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10),
        actual: row?.v ?? 0,
      };
    }),
  );
  const totals = recentActuals.map((r) => r.actual);
  const avgRecent = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const bestRecent = totals.length > 0 ? Math.max(...totals) : 0;

  const [lastQuotaRow] = await db
    .select({
      targetValue: schema.goals.targetValue,
      periodStart: schema.goals.periodStart,
      periodEnd: schema.goals.periodEnd,
    })
    .from(schema.goals)
    .where(
      and(
        eq(schema.goals.workspaceId, args.workspaceId),
        eq(schema.goals.subAccountId, args.subAccountId),
        eq(schema.goals.userId, args.userId),
        eq(schema.goals.kind, "quota"),
        isNull(schema.goals.deletedAt),
      ),
    )
    .orderBy(desc(schema.goals.periodEnd))
    .limit(1);

  return {
    userId: args.userId,
    recentActuals,
    avgRecent,
    bestRecent,
    lastQuota: lastQuotaRow
      ? {
          targetValue: Number(lastQuotaRow.targetValue),
          periodStart: lastQuotaRow.periodStart,
          periodEnd: lastQuotaRow.periodEnd,
        }
      : null,
  };
}

export type TeamGridCell = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  quota: number | null;
  attained: number;
  attainmentPct: number | null;
  goalId: string | null;
};

export type TeamGridRow = {
  userId: string;
  email: string;
  name: string | null;
  cells: TeamGridCell[];
};

/**
 * Manager-facing per-period team grid. Returns rows = members of the
 * sub-account, cols = the 3 periods (prev / current / next). Each cell
 * carries the quota (if set) and the user's actual attained for that
 * window so the manager can spot fairness or coverage gaps at a glance.
 */
export async function getTeamGoalsGrid(
  db: Db,
  args: {
    workspaceId: string;
    subAccountId: string;
    periodKind?: PeriodKind;
  },
): Promise<{ periods: Array<{ from: Date; to: Date; label: string }>; rows: TeamGridRow[] }> {
  const periodKind = args.periodKind ?? "monthly";
  const periods = threePeriodsAround(periodKind);

  const memberRows = await db
    .select({
      userId: schema.memberships.userId,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.workspaceId, args.workspaceId),
        eq(schema.memberships.subAccountId, args.subAccountId),
        isNull(schema.memberships.deletedAt),
      ),
    )
    .orderBy(asc(schema.user.name), asc(schema.user.email));

  const earliest = periods[0]!.from.toISOString().slice(0, 10);
  const latest = periods[periods.length - 1]!.to.toISOString().slice(0, 10);
  const goalRows = await db
    .select({
      id: schema.goals.id,
      userId: schema.goals.userId,
      targetValue: schema.goals.targetValue,
      periodStart: schema.goals.periodStart,
      periodEnd: schema.goals.periodEnd,
    })
    .from(schema.goals)
    .where(
      and(
        eq(schema.goals.workspaceId, args.workspaceId),
        eq(schema.goals.subAccountId, args.subAccountId),
        eq(schema.goals.kind, "quota"),
        isNull(schema.goals.deletedAt),
        lte(schema.goals.periodStart, latest),
        gte(schema.goals.periodEnd, earliest),
      ),
    );

  const rows: TeamGridRow[] = await Promise.all(
    memberRows.map(async (m) => {
      const cells = await Promise.all(
        periods.map(async (p) => {
          const [actualRow] = await db
            .select({
              v: sql<number>`coalesce(sum(s.booked_amount * cr.share_pct), 0)::float`,
            })
            .from(sql`sales s JOIN commission_recipients cr ON cr.sale_id = s.id`)
            .where(
              sql`s.workspace_id = ${args.workspaceId}
                AND s.sub_account_id = ${args.subAccountId}
                AND s.deleted_at IS NULL
                AND cr.user_id = ${m.userId}
                AND cr.sub_account_id = ${args.subAccountId}
                AND cr.deleted_at IS NULL
                AND s.closed_at >= ${p.from}
                AND s.closed_at < ${p.to}`,
            );
          const attained = actualRow?.v ?? 0;
          const goal = goalRows.find(
            (g) =>
              g.userId === m.userId &&
              g.periodStart <= p.from.toISOString().slice(0, 10) &&
              g.periodEnd >= p.from.toISOString().slice(0, 10),
          );
          const quota = goal ? Number(goal.targetValue) : null;
          return {
            userId: m.userId,
            periodStart: p.from.toISOString().slice(0, 10),
            periodEnd: new Date(p.to.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10),
            quota,
            attained,
            attainmentPct: quota && quota > 0 ? attained / quota : null,
            goalId: goal?.id ?? null,
          };
        }),
      );
      return {
        userId: m.userId,
        email: m.email,
        name: m.name,
        cells,
      };
    }),
  );

  return {
    periods: periods.map((p) => ({ from: p.from, to: p.to, label: p.label })),
    rows,
  };
}

// ─── Period helpers ───────────────────────────────────────────────

function lastNPeriods(kind: PeriodKind, n: number): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  for (let i = n; i >= 1; i--) {
    out.push(periodBoundaryAt(kind, -i));
  }
  return out;
}

function threePeriodsAround(kind: PeriodKind): Array<{ from: Date; to: Date; label: string }> {
  return [-1, 0, 1].map((offset) => {
    const { from, to } = periodBoundaryAt(kind, offset);
    return { from, to, label: labelFor(kind, from) };
  });
}

function periodBoundaryAt(kind: PeriodKind, offset: number): { from: Date; to: Date } {
  const now = new Date();
  if (kind === "monthly") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    return { from, to };
  }
  if (kind === "weekly") {
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const baseFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset),
    );
    const from = new Date(baseFrom.getTime() + offset * 7 * 24 * 3600 * 1000);
    const to = new Date(from.getTime() + 7 * 24 * 3600 * 1000);
    return { from, to };
  }
  if (kind === "quarterly") {
    const quarterIndex = Math.floor(now.getUTCMonth() / 3) + offset;
    const year = now.getUTCFullYear() + Math.floor(quarterIndex / 4);
    const q = ((quarterIndex % 4) + 4) % 4;
    const from = new Date(Date.UTC(year, q * 3, 1));
    const to = new Date(Date.UTC(year, q * 3 + 3, 1));
    return { from, to };
  }
  if (kind === "annual") {
    const from = new Date(Date.UTC(now.getUTCFullYear() + offset, 0, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear() + offset + 1, 0, 1));
    return { from, to };
  }
  // daily / ramp_window / custom — fall back to monthly so the form
  // always renders something usable.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { from, to };
}

function labelFor(kind: PeriodKind, from: Date): string {
  if (kind === "monthly")
    return from.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (kind === "weekly") return `Week of ${from.toISOString().slice(0, 10)}`;
  if (kind === "quarterly") {
    const q = Math.floor(from.getUTCMonth() / 3) + 1;
    return `Q${q} ${from.getUTCFullYear()}`;
  }
  if (kind === "annual") return `${from.getUTCFullYear()}`;
  return from.toISOString().slice(0, 10);
}

void or;
