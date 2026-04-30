import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { dataSourceConnections } from "./data-sources";

export const optins = pgTable(
  "optins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    dataSourceConnectionId: uuid("data_source_connection_id").references(
      () => dataSourceConnections.id,
    ),
    email: text("email").notNull(),
    name: text("name"),
    phone: text("phone"),
    leadSource: text("lead_source"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    formResponse: jsonb("form_response").notNull().default({}).$type<Record<string, unknown>>(),
    sourceIntegration: text("source_integration"),
    externalId: text("external_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    externalUq: unique("optins_external_uq").on(t.sourceIntegration, t.externalId),
    subEmailIdx: index("optins_sub_email_idx").on(t.subAccountId, t.email),
    submittedIdx: index("optins_submitted_idx").on(t.submittedAt),
  }),
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    dataSourceConnectionId: uuid("data_source_connection_id").references(
      () => dataSourceConnections.id,
    ),
    email: text("email").notNull(),
    name: text("name"),
    phone: text("phone"),
    formResponse: jsonb("form_response").notNull().default({}).$type<Record<string, unknown>>(),
    qualifyingScore: text("qualifying_score"),
    sourceIntegration: text("source_integration"),
    externalId: text("external_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalUq: unique("applications_external_uq").on(t.sourceIntegration, t.externalId),
    subEmailIdx: index("applications_sub_email_idx").on(t.subAccountId, t.email),
  }),
);
