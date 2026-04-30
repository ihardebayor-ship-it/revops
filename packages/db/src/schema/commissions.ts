import {
  date,
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
import { sales, paymentPlanInstallments } from "./sales";
import { salesRoles, salesRoleVersions } from "./roles";
import { commissionRuleTypeEnum, commissionStatusEnum, periodKindEnum } from "./enums";

export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: commissionRuleTypeEnum("type").notNull(),
    salesRoleId: uuid("sales_role_id").references(() => salesRoles.id, { onDelete: "set null" }),
    sharePct: numeric("share_pct", { precision: 5, scale: 4 }),
    flatAmount: numeric("flat_amount", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    productMatch: jsonb("product_match").$type<{ kind: "any" } | { kind: "name"; value: string }>(),
    sourceMatch: jsonb("source_match").$type<{ kind: "any" } | { kind: "name"; value: string }>(),
    holdDays: integer("hold_days").notNull().default(30),
    paidOn: text("paid_on").notNull().default("collected"),
    config: jsonb("config").notNull().default({}).$type<Record<string, unknown>>(),
    isActive: integer("is_active").notNull().default(1),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index("commission_rules_workspace_idx").on(t.workspaceId),
    roleIdx: index("commission_rules_role_idx").on(t.salesRoleId),
  }),
);

export const commissionRuleVersions = pgTable(
  "commission_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commissionRuleId: uuid("commission_rule_id")
      .notNull()
      .references(() => commissionRules.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    ruleVersionUq: unique("commission_rule_versions_rule_version_uq").on(
      t.commissionRuleId,
      t.version,
    ),
  }),
);

export const commissionPeriods = pgTable(
  "commission_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, { onDelete: "cascade" }),
    kind: periodKindEnum("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceRangeIdx: index("commission_periods_workspace_range_idx").on(
      t.workspaceId,
      t.startDate,
      t.endDate,
    ),
  }),
);

// commission_entries — the ledger. One row per recipient per installment.
// Hold-period state machine: pending_until → available_at → paid_at.
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    installmentId: uuid("installment_id").references(() => paymentPlanInstallments.id, {
      onDelete: "cascade",
    }),
    periodId: uuid("period_id").references(() => commissionPeriods.id, { onDelete: "set null" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id),
    salesRoleId: uuid("sales_role_id").references(() => salesRoles.id),
    salesRoleVersionId: uuid("sales_role_version_id").references(() => salesRoleVersions.id),
    ruleId: uuid("rule_id").references(() => commissionRules.id),
    ruleVersionId: uuid("rule_version_id").references(() => commissionRuleVersions.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: commissionStatusEnum("status").notNull().default("pending"),
    pendingUntil: timestamp("pending_until", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    clawedBackAt: timestamp("clawed_back_at", { withTimezone: true }),
    computedFrom: jsonb("computed_from").notNull().default({}).$type<Record<string, unknown>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    saleIdx: index("commission_entries_sale_idx").on(t.saleId),
    recipientIdx: index("commission_entries_recipient_idx").on(t.recipientUserId),
    statusIdx: index("commission_entries_status_idx").on(t.status),
    periodIdx: index("commission_entries_period_idx").on(t.periodId),
    availableIdx: index("commission_entries_available_idx").on(t.availableAt),
  }),
);
