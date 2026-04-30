import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { customerStatusEnum } from "./enums";

// customers — persists post-sale. CX commissions, retention, churn,
// expansion all attach here.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    primaryEmail: text("primary_email").notNull(),
    name: text("name"),
    phone: text("phone"),
    status: customerStatusEnum("status").notNull().default("active"),
    lifetimeValue: numeric("lifetime_value", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    originalSaleId: uuid("original_sale_id"),
    attributedSetterUserId: text("attributed_setter_user_id").references(() => user.id),
    attributedCloserUserId: text("attributed_closer_user_id").references(() => user.id),
    attributedCxUserId: text("attributed_cx_user_id").references(() => user.id),
    churnAt: timestamp("churn_at", { withTimezone: true }),
    churnReason: text("churn_reason"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    subAccountIdx: index("customers_sub_account_idx").on(t.subAccountId),
    workspaceEmailIdx: index("customers_workspace_email_idx").on(t.workspaceId, t.primaryEmail),
    statusIdx: index("customers_status_idx").on(t.status),
  }),
);
