import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces, subAccounts } from "./tenancy";
import { agentFactKindEnum, agentFactScopeEnum, agentMessageRoleEnum } from "./enums";

// pgvector custom type. Requires the `vector` extension enabled on the DB
// (drizzle-kit will not enable it; see migrations/0000-extensions.sql).
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value) {
      return JSON.stringify(value);
    },
    fromDriver(value) {
      if (typeof value === "string") {
        return JSON.parse(value) as number[];
      }
      return value as number[];
    },
  })(name);

export const agentThreads = pgTable(
  "agent_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subAccountId: uuid("sub_account_id").references(() => subAccounts.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    summary: text("summary"),
    summaryUpdatedAt: timestamp("summary_updated_at", { withTimezone: true }),
    tokenCountEstimate: integer("token_count_estimate").notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("agent_threads_user_idx").on(t.userId),
    workspaceIdx: index("agent_threads_workspace_idx").on(t.workspaceId),
    lastMessageIdx: index("agent_threads_last_message_idx").on(t.lastMessageAt),
  }),
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").notNull(),
    role: agentMessageRoleEnum("role").notNull(),
    content: jsonb("content").notNull().$type<Record<string, unknown>>(),
    model: text("model"),
    tokenUsage: jsonb("token_usage").$type<{
      input?: number;
      output?: number;
      cacheCreate?: number;
      cacheRead?: number;
    }>(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    langfuseTraceId: text("langfuse_trace_id"),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadCreatedIdx: index("agent_messages_thread_created_idx").on(t.threadId, t.createdAt),
    turnIdx: index("agent_messages_turn_idx").on(t.turnId),
  }),
);

// agent_facts — semantic memory. Embeddings are 1536-dim (text-embedding-3-small).
export const agentFacts = pgTable(
  "agent_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scope: agentFactScopeEnum("scope").notNull(),
    scopeRefId: uuid("scope_ref_id"),
    kind: agentFactKindEnum("kind").notNull(),
    content: text("content").notNull(),
    sourceMessageId: uuid("source_message_id").references(() => agentMessages.id, {
      onDelete: "set null",
    }),
    embedding: vector("embedding", 1536),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull().default("0.6"),
    confirmedByUserAt: timestamp("confirmed_by_user_at", { withTimezone: true }),
    contradictedAt: timestamp("contradicted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceScopeIdx: index("agent_facts_workspace_scope_idx").on(
      t.workspaceId,
      t.scope,
      t.scopeRefId,
    ),
    embeddingIdx: index("agent_facts_embedding_idx")
      .using("hnsw", sql`embedding vector_cosine_ops`)
      .with({ m: 16, ef_construction: 64 }),
  }),
);

export const agentEvalRuns = pgTable(
  "agent_eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteSlug: text("suite_slug").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    model: text("model").notNull(),
    scorerVersion: text("scorer_version").notNull(),
    scoreSummary: jsonb("score_summary").notNull().$type<Record<string, number>>(),
    regressions: jsonb("regressions").notNull().default([]).$type<Array<Record<string, unknown>>>(),
    langfuseRunId: text("langfuse_run_id"),
    durationMs: integer("duration_ms"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    suiteRunIdx: index("agent_eval_runs_suite_run_idx").on(t.suiteSlug, t.runAt),
  }),
);
