import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { dataSourceKindEnum } from "./enums";

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    kind: dataSourceKindEnum("kind").notNull(),
    label: text("label").notNull(),
    config: jsonb("config").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    subKindIdx: index("data_sources_sub_kind_idx").on(t.subAccountId, t.kind),
  }),
);

// data_source_connections — per-tool credentials. Tokens are encrypted at rest.
export const dataSourceConnections = pgTable(
  "data_source_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    toolType: text("tool_type").notNull(),
    label: text("label").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text("scope"),
    externalAccountId: text("external_account_id"),
    config: jsonb("config").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    dataSourceIdx: index("data_source_connections_ds_idx").on(t.dataSourceId),
    toolTypeIdx: index("data_source_connections_tool_idx").on(t.toolType),
  }),
);
