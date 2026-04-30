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
import { customers } from "./customers";
import { calls } from "./calls";
import { workspaces, subAccounts } from "./tenancy";
import { installmentStatusEnum, refundStatusEnum } from "./enums";

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    linkedCallId: uuid("linked_call_id").references(() => calls.id, { onDelete: "set null" }),
    productName: text("product_name"),
    bookedAmount: numeric("booked_amount", { precision: 14, scale: 2 }).notNull(),
    collectedAmount: numeric("collected_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("USD"),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    paymentProcessor: text("payment_processor"),
    refundStatus: refundStatusEnum("refund_status").notNull().default("none"),
    refundedAmount: numeric("refunded_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    originalSaleId: uuid("original_sale_id"),
    sourceIntegration: text("source_integration"),
    externalId: text("external_id"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    externalUq: unique("sales_external_uq").on(t.sourceIntegration, t.externalId),
    subClosedIdx: index("sales_sub_closed_idx").on(t.subAccountId, t.closedAt),
    customerIdx: index("sales_customer_idx").on(t.customerId),
    callIdx: index("sales_call_idx").on(t.linkedCallId),
  }),
);

export const paymentPlans = pgTable(
  "payment_plans",
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
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    installmentFrequency: text("installment_frequency").notNull(),
    totalInstallments: integer("total_installments").notNull(),
    installmentAmount: numeric("installment_amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    firstInstallmentDate: date("first_installment_date").notNull(),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    saleIdx: index("payment_plans_sale_idx").on(t.saleId),
  }),
);

export const paymentPlanInstallments = pgTable(
  "payment_plan_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentPlanId: uuid("payment_plan_id")
      .notNull()
      .references(() => paymentPlans.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    expectedAmount: numeric("expected_amount", { precision: 14, scale: 2 }).notNull(),
    actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    expectedDate: date("expected_date").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    status: installmentStatusEnum("status").notNull().default("scheduled"),
    failureReason: text("failure_reason"),
    externalChargeId: text("external_charge_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    planSequenceUq: unique("payment_plan_installments_plan_seq_uq").on(t.paymentPlanId, t.sequence),
    expectedDateIdx: index("payment_plan_installments_expected_date_idx").on(t.expectedDate),
    statusIdx: index("payment_plan_installments_status_idx").on(t.status),
  }),
);
