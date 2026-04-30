import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { sales } from "./sales";
import { salesRoles, salesRoleVersions } from "./roles";
import { commissionRules, commissionRuleVersions } from "./commissions";

// commission_recipients — multi-party commission allocation per sale.
// Created in Phase 1 M1 (migration 0002) even though sales CRUD lands in M3,
// to keep the migration sequence linear. Recipients are populated when a
// sale is created (M3); the table sits empty until then.
//
// One row per (sale, user, sales_role). Share percentages must sum to 1.0
// across all active recipients of a sale; the constraint is enforced at
// sale creation time in domain logic, not via a DB CHECK.
export const commissionRecipients = pgTable(
  "commission_recipients",
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
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    salesRoleId: uuid("sales_role_id")
      .notNull()
      .references(() => salesRoles.id),
    salesRoleVersionId: uuid("sales_role_version_id")
      .notNull()
      .references(() => salesRoleVersions.id),
    sharePct: numeric("share_pct", { precision: 5, scale: 4 }).notNull(),
    computedAmount: numeric("computed_amount", { precision: 14, scale: 2 }),
    ruleId: uuid("rule_id").references(() => commissionRules.id),
    ruleVersionId: uuid("rule_version_id").references(() => commissionRuleVersions.id),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("pending"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    saleUserRoleUq: uniqueIndex("commission_recipients_sale_user_role_uq")
      .on(t.saleId, t.userId, t.salesRoleId)
      .where(sql`${t.deletedAt} is null`),
    saleIdx: index("commission_recipients_sale_idx").on(t.saleId),
    userIdx: index("commission_recipients_user_idx").on(t.userId),
    workspaceIdx: index("commission_recipients_workspace_idx").on(t.workspaceId),
  }),
);
