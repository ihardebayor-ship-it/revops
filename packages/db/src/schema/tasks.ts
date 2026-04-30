import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { salesRoles } from "./roles";
import { taskKindEnum, taskStatusEnum } from "./enums";

// tasks — the unified inbox. Same surface for humans and agent.
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    kind: taskKindEnum("kind").notNull(),
    status: taskStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description"),
    payload: jsonb("payload").notNull().default({}).$type<Record<string, unknown>>(),
    assignedUserId: text("assigned_user_id").references(() => user.id),
    salesRoleId: uuid("sales_role_id").references(() => salesRoles.id),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by").references(() => user.id),
    agentOriginId: uuid("agent_origin_id"),
    // unique_key dedupes auto-generated tasks (e.g. speed-to-lead SLA
    // sweep upserts on `speed_to_lead:{optinId}`). Idempotent under retry
    // and replay.
    uniqueKey: text("unique_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    subAssignedStatusIdx: index("tasks_sub_assigned_status_idx").on(
      t.subAccountId,
      t.assignedUserId,
      t.status,
    ),
    dueIdx: index("tasks_due_idx").on(t.dueAt),
    relatedIdx: index("tasks_related_idx").on(t.relatedEntityType, t.relatedEntityId),
    uniqueKeyUq: uniqueIndex("tasks_unique_key_uq")
      .on(t.subAccountId, t.uniqueKey)
      .where(sql`${t.uniqueKey} is not null`),
    // Hot path: per-user inbox, ordered by due_at ascending.
    inboxIdx: index("tasks_inbox_idx").on(
      t.subAccountId,
      t.assignedUserId,
      t.status,
      t.dueAt,
    ),
  }),
);
