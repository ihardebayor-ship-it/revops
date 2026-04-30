import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { customers } from "./customers";
import { dispositions } from "./funnel";
import { workspaces, subAccounts } from "./tenancy";
import { recordingConsentEnum } from "./enums";

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    contactName: text("contact_name"),
    setterUserId: text("setter_user_id").references(() => user.id),
    closerUserId: text("closer_user_id").references(() => user.id),
    appointmentAt: timestamp("appointment_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    showedAt: timestamp("showed_at", { withTimezone: true }),
    pitchedAt: timestamp("pitched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    dispositionId: uuid("disposition_id").references(() => dispositions.id),
    notes: text("notes"),
    recordingUrl: text("recording_url"),
    transcriptUrl: text("transcript_url"),
    transcriptIngestedAt: timestamp("transcript_ingested_at", { withTimezone: true }),
    recordingConsent: recordingConsentEnum("recording_consent").notNull().default("unknown"),
    linkedSaleId: uuid("linked_sale_id"),
    sourceIntegration: text("source_integration"),
    externalId: text("external_id"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    subAccountAppointmentIdx: index("calls_sub_appointment_idx").on(
      t.subAccountId,
      t.appointmentAt,
    ),
    closerIdx: index("calls_closer_idx").on(t.closerUserId),
    setterIdx: index("calls_setter_idx").on(t.setterUserId),
    customerIdx: index("calls_customer_idx").on(t.customerId),
    externalIdx: index("calls_external_idx").on(t.sourceIntegration, t.externalId),
  }),
);
