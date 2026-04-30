import {
  date,
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
import { salesRoles } from "./roles";
import { goalKindEnum, periodKindEnum } from "./enums";

// goals — OTE / quota / ramp / target. Real comp plans, not flat numbers.
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id),
    salesRoleId: uuid("sales_role_id").references(() => salesRoles.id),
    kind: goalKindEnum("kind").notNull(),
    metric: text("metric").notNull(),
    targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency"),
    periodKind: periodKindEnum("period_kind").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    accelerators: jsonb("accelerators").notNull().default([]).$type<
      Array<{ thresholdPct: number; multiplier: number }>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    subAccountUserIdx: index("goals_sub_user_idx").on(t.subAccountId, t.userId),
    periodIdx: index("goals_period_idx").on(t.periodStart, t.periodEnd),
  }),
);
