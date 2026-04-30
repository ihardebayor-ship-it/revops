// Tasks domain — the unified inbox.
//
// Phase 1 M1 ships CRUD + the idempotent upsert path used by the
// speed-to-lead SLA sweep. Phase 1 M5 will add agent-suggestion tasks
// (kind='agent_suggestion') from `proposeCommissionLink`.

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

type TaskKind =
  | "call_outcome_pending"
  | "sale_unlinked"
  | "follow_up_due"
  | "no_show_recovery"
  | "commission_approval"
  | "refund_save"
  | "agent_suggestion"
  | "manager_one_on_one"
  | "custom";

type TaskStatus = "open" | "snoozed" | "completed" | "dismissed";

export type CreateTaskInput = {
  workspaceId: string;
  subAccountId: string;
  kind: TaskKind;
  title: string;
  description?: string | null;
  payload?: Record<string, unknown>;
  assignedUserId?: string | null;
  salesRoleId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  dueAt?: Date | null;
  uniqueKey?: string | null;
  agentOriginId?: string | null;
  createdBy?: string | null;
};

export async function createTask(db: Db, input: CreateTaskInput) {
  const [row] = await db
    .insert(schema.tasks)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      payload: input.payload ?? {},
      assignedUserId: input.assignedUserId ?? null,
      salesRoleId: input.salesRoleId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      dueAt: input.dueAt ?? null,
      uniqueKey: input.uniqueKey ?? null,
      agentOriginId: input.agentOriginId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: schema.tasks.id });
  if (!row) throw new Error("Failed to create task");
  return { id: row.id };
}

/**
 * Upsert by `(sub_account_id, unique_key)`. Used by jobs that materialize a
 * task on a recurring schedule (e.g. speed-to-lead SLA sweep) — replays
 * leave a single task.
 */
export async function upsertTaskByUniqueKey(db: Db, input: CreateTaskInput & { uniqueKey: string }) {
  const [row] = await db
    .insert(schema.tasks)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      payload: input.payload ?? {},
      assignedUserId: input.assignedUserId ?? null,
      salesRoleId: input.salesRoleId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      dueAt: input.dueAt ?? null,
      uniqueKey: input.uniqueKey,
      agentOriginId: input.agentOriginId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({
      target: [schema.tasks.subAccountId, schema.tasks.uniqueKey],
      // Mirror the partial-index WHERE so Postgres can pick the right unique
      // constraint. tasks_unique_key_uq is `WHERE unique_key IS NOT NULL`.
      where: isNotNull(schema.tasks.uniqueKey),
    })
    .returning({ id: schema.tasks.id });
  return { id: row?.id ?? null, inserted: !!row };
}

export async function completeTask(
  db: Db,
  args: { taskId: string; completedBy: string; subAccountId: string },
) {
  const [row] = await db
    .update(schema.tasks)
    .set({
      status: "completed" as TaskStatus,
      completedAt: new Date(),
      completedBy: args.completedBy,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.tasks.id, args.taskId),
        eq(schema.tasks.subAccountId, args.subAccountId),
        inArray(schema.tasks.status, ["open", "snoozed"] as const),
      ),
    )
    .returning({ id: schema.tasks.id });
  return { completed: !!row };
}

export async function snoozeTask(
  db: Db,
  args: { taskId: string; snoozedUntil: Date; subAccountId: string },
) {
  const [row] = await db
    .update(schema.tasks)
    .set({
      status: "snoozed" as TaskStatus,
      snoozedUntil: args.snoozedUntil,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.tasks.id, args.taskId),
        eq(schema.tasks.subAccountId, args.subAccountId),
        eq(schema.tasks.status, "open" as TaskStatus),
      ),
    )
    .returning({ id: schema.tasks.id });
  return { snoozed: !!row };
}

export async function assignTask(
  db: Db,
  args: { taskId: string; assignedUserId: string; subAccountId: string },
) {
  const [row] = await db
    .update(schema.tasks)
    .set({ assignedUserId: args.assignedUserId, updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, args.taskId), eq(schema.tasks.subAccountId, args.subAccountId)))
    .returning({ id: schema.tasks.id });
  return { assigned: !!row };
}

export type ListTasksFilter = {
  subAccountId: string;
  /** When set, only tasks assigned to this user OR matching one of the user's
   *  sales roles. */
  assignedUserId?: string | null;
  salesRoleSlugs?: string[];
  statuses?: TaskStatus[];
  kinds?: TaskKind[];
  dueBefore?: Date | null;
  limit?: number;
  cursor?: string | null;
};

export async function listTasks(db: Db, filter: ListTasksFilter) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conditions = [
    eq(schema.tasks.subAccountId, filter.subAccountId),
    inArray(schema.tasks.status, filter.statuses ?? (["open", "snoozed"] as TaskStatus[])),
  ];
  if (filter.assignedUserId) {
    conditions.push(
      or(
        eq(schema.tasks.assignedUserId, filter.assignedUserId),
        // tasks not yet assigned but matching the user's sales role
        and(
          isNull(schema.tasks.assignedUserId),
          filter.salesRoleSlugs && filter.salesRoleSlugs.length > 0
            ? sql`${schema.tasks.salesRoleId} IN (
                SELECT id FROM sales_roles
                 WHERE workspace_id = (SELECT workspace_id FROM sub_accounts WHERE id = ${filter.subAccountId})
                   AND slug = ANY(${filter.salesRoleSlugs}))`
            : sql`false`,
        ),
      )!,
    );
  }
  if (filter.kinds && filter.kinds.length > 0) {
    conditions.push(inArray(schema.tasks.kind, filter.kinds));
  }
  if (filter.dueBefore) {
    conditions.push(lte(schema.tasks.dueAt, filter.dueBefore));
  }
  if (filter.cursor) {
    conditions.push(gte(schema.tasks.id, filter.cursor));
  }

  const rows = await db
    .select({
      id: schema.tasks.id,
      kind: schema.tasks.kind,
      status: schema.tasks.status,
      title: schema.tasks.title,
      description: schema.tasks.description,
      payload: schema.tasks.payload,
      assignedUserId: schema.tasks.assignedUserId,
      salesRoleId: schema.tasks.salesRoleId,
      relatedEntityType: schema.tasks.relatedEntityType,
      relatedEntityId: schema.tasks.relatedEntityId,
      dueAt: schema.tasks.dueAt,
      snoozedUntil: schema.tasks.snoozedUntil,
      createdAt: schema.tasks.createdAt,
    })
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.dueAt), desc(schema.tasks.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}
