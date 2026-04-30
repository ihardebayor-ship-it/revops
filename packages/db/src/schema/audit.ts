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
import { auditActorKindEnum } from "./enums";

// audit_log — append-only. Every mutation through tRPC, server actions, and
// agent tools writes here. The agent's actions are tagged actor_kind=
// "agent_on_behalf_of_user" for clear differentiation in audit views.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, { onDelete: "set null" }),
    actorKind: auditActorKindEnum("actor_kind").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    agentTraceId: text("agent_trace_id"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceCreatedIdx: index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt),
    actorIdx: index("audit_log_actor_idx").on(t.actorUserId),
    resourceIdx: index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  }),
);
