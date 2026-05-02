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
import { accessRoleEnum, topologyPresetEnum } from "./enums";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    topologyPreset: topologyPresetEnum("topology_preset").notNull().default("solo"),
    timezone: text("timezone").notNull().default("UTC"),
    currency: text("currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    slugIdx: index("workspaces_slug_idx").on(t.slug),
  }),
);

// workspace_settings — operational config (commission caps, hold periods, etc.)
export const workspaceSettings = pgTable("workspace_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  defaultHoldDays: text("default_hold_days").notNull().default("30"),
  agentDailyCostCapUsd: text("agent_daily_cost_cap_usd").notNull().default("25"),
  agentPerTurnCostCapUsd: text("agent_per_turn_cost_cap_usd").notNull().default("0.50"),
  speedToLeadSlaSeconds: text("speed_to_lead_sla_seconds").notNull().default("300"),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// tenant_settings — whitelabel overrides (off by default).
export const tenantSettings = pgTable("tenant_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  whitelabelEnabled: boolean("whitelabel_enabled").notNull().default(false),
  brandName: text("brand_name"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  supportEmail: text("support_email"),
  agentPersona: jsonb("agent_persona").$type<{
    name?: string;
    voice?: string;
    forbiddenPhrases?: string[];
  }>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subAccounts = pgTable(
  "sub_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    workspaceSlugUq: unique("sub_accounts_workspace_slug_uq").on(t.workspaceId, t.slug),
    workspaceIdx: index("sub_accounts_workspace_idx").on(t.workspaceId),
  }),
);

// workspace_invitations — pending invites by email. When an invited user
// signs up, the auth bootstrap hook claims the invitation: it creates
// a membership (and optional sales_role_assignments) for the new user
// in the inviting workspace and skips creating a fresh workspace.
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    accessRole: accessRoleEnum("access_role").notNull().default("contributor"),
    salesRoleIds: jsonb("sales_role_ids").notNull().default([]).$type<string[]>(),
    invitedBy: text("invited_by").references(() => user.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceEmailUq: unique("workspace_invitations_ws_email_uq").on(t.workspaceId, t.email),
    emailIdx: index("workspace_invitations_email_idx").on(t.email),
  }),
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, {
      onDelete: "cascade",
    }),
    accessRole: accessRoleEnum("access_role").notNull().default("contributor"),
    invitedBy: text("invited_by").references(() => user.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userWorkspaceSubUq: unique("memberships_user_workspace_sub_uq").on(
      t.userId,
      t.workspaceId,
      t.subAccountId,
    ),
    workspaceIdx: index("memberships_workspace_idx").on(t.workspaceId),
    userIdx: index("memberships_user_idx").on(t.userId),
  }),
);
