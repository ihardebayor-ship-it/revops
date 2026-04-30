import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { dispositionCategoryEnum, funnelStageKindEnum } from "./enums";

// funnel_stages — workspace-configured pipeline stages.
export const funnelStages = pgTable(
  "funnel_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    kind: funnelStageKindEnum("kind").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    workspaceSlugUq: unique("funnel_stages_workspace_slug_uq").on(t.workspaceId, t.slug),
    workspaceOrdinalIdx: index("funnel_stages_workspace_ordinal_idx").on(t.workspaceId, t.ordinal),
  }),
);

export const funnelStageVersions = pgTable(
  "funnel_stage_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funnelStageId: uuid("funnel_stage_id")
      .notNull()
      .references(() => funnelStages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull().$type<{
      slug: string;
      label: string;
      kind: string;
      ordinal: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stageVersionUq: unique("funnel_stage_versions_stage_version_uq").on(t.funnelStageId, t.version),
  }),
);

// funnel_events — append-only event stream. Speed-to-lead, show-up, pitch,
// close, and collection rates are all queries over this table.
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id")
      .notNull()
      .references(() => subAccounts.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    stageId: uuid("stage_id").references(() => funnelStages.id, { onDelete: "set null" }),
    stageVersionId: uuid("stage_version_id").references(() => funnelStageVersions.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    sourceEventId: uuid("source_event_id"),
    actorUserId: text("actor_user_id").references(() => user.id),
    meta: jsonb("meta").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("funnel_events_entity_idx").on(t.entityType, t.entityId),
    subAccountOccurredIdx: index("funnel_events_sub_occurred_idx").on(
      t.subAccountId,
      t.occurredAt,
    ),
    stageOccurredIdx: index("funnel_events_stage_occurred_idx").on(t.stageId, t.occurredAt),
  }),
);

// dispositions — workspace-configurable call/sale outcome taxonomy.
export const dispositions = pgTable(
  "dispositions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    category: dispositionCategoryEnum("category").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceSlugUq: unique("dispositions_workspace_slug_uq").on(t.workspaceId, t.slug),
    workspaceCategoryIdx: index("dispositions_workspace_category_idx").on(
      t.workspaceId,
      t.category,
    ),
  }),
);
