import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";

// sales_roles — workspace-configured sales roles (setter, closer, cx, custom).
// See ADR-0002.
export const salesRoles = pgTable(
  "sales_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    stageOwnership: jsonb("stage_ownership").notNull().default([]).$type<string[]>(),
    defaultCommissionShare: numeric("default_commission_share", {
      precision: 5,
      scale: 4,
    }).notNull(),
    defaultSlaSeconds: integer("default_sla_seconds"),
    color: text("color"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    workspaceSlugUq: unique("sales_roles_workspace_slug_uq").on(t.workspaceId, t.slug),
    workspaceIdx: index("sales_roles_workspace_idx").on(t.workspaceId),
  }),
);

// sales_role_versions — immutable history. Commission entries reference the
// version that produced them, so renaming a role mid-period is safe.
export const salesRoleVersions = pgTable(
  "sales_role_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    salesRoleId: uuid("sales_role_id")
      .notNull()
      .references(() => salesRoles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull().$type<{
      slug: string;
      label: string;
      stageOwnership: string[];
      defaultCommissionShare: string;
      defaultSlaSeconds: number | null;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    roleVersionUq: unique("sales_role_versions_role_version_uq").on(t.salesRoleId, t.version),
  }),
);

// sales_role_assignments — user × sales_role × sub_account.
export const salesRoleAssignments = pgTable(
  "sales_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    salesRoleId: uuid("sales_role_id")
      .notNull()
      .references(() => salesRoles.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userRoleSubUq: unique("sales_role_assignments_user_role_sub_uq").on(
      t.userId,
      t.salesRoleId,
      t.subAccountId,
    ),
    subIdx: index("sales_role_assignments_sub_idx").on(t.subAccountId),
    userIdx: index("sales_role_assignments_user_idx").on(t.userId),
  }),
);
