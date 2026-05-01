import {
  boolean,
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

// outbound_webhook_subscriptions — customers subscribe to events from their
// workspace. MVP delivery via Inngest; subscription model shaped to match
// Svix's API so the swap is hours of work later.
export const outboundWebhookSubscriptions = pgTable(
  "outbound_webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    eventTypes: jsonb("event_types").notNull().default([]).$type<string[]>(),
    isActive: boolean("is_active").notNull().default(true),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    failureCount: text("failure_count").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index("outbound_webhook_subs_workspace_idx").on(t.workspaceId),
  }),
);

// webhook_inbound_events — idempotency surface for every inbound provider
// webhook. Dedup on (source, external_id) so retries / replays are safe.
// NOT workspace-scoped: dedup happens before we know which workspace the
// event maps to. Runtime handlers run under bypassRls.
export const webhookInboundEvents = pgTable(
  "webhook_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => ({
    sourceExternalUq: unique("webhook_inbound_events_source_external_uq").on(t.source, t.externalId),
    receivedAtIdx: index("webhook_inbound_events_received_at_idx").on(t.receivedAt),
  }),
);
