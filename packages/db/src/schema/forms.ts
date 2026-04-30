import { sql } from "drizzle-orm";
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
import { calls } from "./calls";

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
    // Phase 1 M2 speed-to-lead surface: when contact is made, the call is
    // recorded here. The SLA sweep finds optins with NULL contacted_call_id
    // past `workspace_settings.speedToLeadSlaSeconds` and creates a setter task.
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    contactedCallId: uuid("contacted_call_id").references(() => calls.id, {
      onDelete: "set null",
    }),
    attributedSetterUserId: text("attributed_setter_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => ({
    externalUq: unique("optins_external_uq").on(t.sourceIntegration, t.externalId),
    subEmailIdx: index("optins_sub_email_idx").on(t.subAccountId, t.email),
    submittedIdx: index("optins_submitted_idx").on(t.submittedAt),
    // Hot path: SLA sweep finds optins with no contact past the SLA window.
    slaPendingIdx: index("optins_sla_pending_idx")
      .on(t.subAccountId, t.submittedAt)
      .where(sql`${t.contactedCallId} is null`),
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
