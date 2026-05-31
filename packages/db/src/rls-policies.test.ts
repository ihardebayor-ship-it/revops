import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const policySql = readFileSync(
  new URL("../drizzle/9001-rls-policies.sql", import.meta.url),
  "utf8",
);
const webhookSchema = readFileSync(new URL("./schema/webhooks.ts", import.meta.url), "utf8");
const ghlWebhookRoute = readRepoFile("apps/web/src/app/api/webhooks/ghl/route.ts");
const aircallWebhookRoute = readRepoFile("apps/web/src/app/api/webhooks/aircall/route.ts");
const fathomWebhookRoute = readRepoFile("apps/web/src/app/api/webhooks/fathom/route.ts");
const fathomWebhookHandler = readRepoFile("packages/jobs/src/webhooks/fathom-handler.ts");
const salesSchema = readRepoFile("packages/db/src/schema/sales.ts");
const formsSchema = readRepoFile("packages/db/src/schema/forms.ts");
const dataSourcesSchema = readRepoFile("packages/db/src/schema/data-sources.ts");
const commissionsSchema = readRepoFile("packages/db/src/schema/commissions.ts");
const dataSpineIndexesSql = readFileSync(
  new URL("../drizzle/9002-data-spine-indexes.sql", import.meta.url),
  "utf8",
);

const betterAuthTables = ["account", "session", "user", "verification"];
const specialPolicyTables = [
  "agent_eval_runs",
  "audit_log",
  "installment_status_history",
  "payment_plan_installments",
  "platform_settings",
  "platform_users",
  "webhook_inbound_events",
  "workspaces",
];
const viaParentTables = [
  "agent_messages",
  "commission_rule_versions",
  "funnel_stage_versions",
  "sales_role_versions",
];

const workspaceTables = [
  "sub_accounts",
  "memberships",
  "workspace_invitations",
  "workspace_settings",
  "tenant_settings",
  "sales_roles",
  "sales_role_assignments",
  "funnel_stages",
  "funnel_event_dedupe",
  "dispositions",
  "commission_rules",
  "commission_periods",
  "commission_recompute_runs",
  "agent_threads",
  "agent_facts",
  "outbound_webhook_subscriptions",
];

const subAccountTables = [
  "calls",
  "sales",
  "payment_plans",
  "commission_entries",
  "commission_recipients",
  "funnel_events",
  "tasks",
  "applications",
  "optins",
  "customers",
  "goals",
  "data_sources",
  "data_source_connections",
];

describe("RLS policy migration", () => {
  it("keeps workspace-only and sub-account tables in separate policy groups", () => {
    const overlap = workspaceTables.filter((table) => subAccountTables.includes(table));

    expect(overlap).toEqual([]);
  });

  it("lists every expected workspace-only table", () => {
    for (const table of workspaceTables) {
      expect(policySql).toContain(`'${table}'`);
    }
  });

  it("lists every expected sub-account-scoped table", () => {
    for (const table of subAccountTables) {
      expect(policySql).toContain(`'${table}'`);
    }
  });

  it("requires sub-account match for sub-account-scoped direct tables", () => {
    const subAccountPolicy = sectionBetween(
      policySql,
      "-- 2a-bis. Sub-account-scoped direct policies",
      "-- 2b. Via-parent policies",
    );

    expect(subAccountPolicy).toContain("workspace_id = app_current_workspace_id()");
    expect(subAccountPolicy).toContain("app_current_access_role() = 'workspace_admin'");
    expect(subAccountPolicy).toContain("sub_account_id = app_current_sub_account_id()");
    expect(subAccountPolicy).toContain("WITH CHECK");
  });

  it("preserves sub-account scope for sales-derived child tables", () => {
    const installmentPolicy = sectionBetween(
      policySql,
      "-- 2b-bis. payment_plan_installments",
      "-- 2b-ter. installment_status_history",
    );
    const historyPolicy = sectionBetween(
      policySql,
      "-- 2b-ter. installment_status_history",
      "-- 2c. workspaces",
    );

    expect(installmentPolicy).toContain("s.sub_account_id = app_current_sub_account_id()");
    expect(historyPolicy).toContain("s.sub_account_id = app_current_sub_account_id()");
  });

  it("classifies every schema table into exactly one RLS group or explicit auth exemption", () => {
    const schemaTables = readSchemaTableNames();
    const classified = [
      ...betterAuthTables,
      ...workspaceTables,
      ...subAccountTables,
      ...viaParentTables,
      ...specialPolicyTables,
    ];

    expect([...new Set(classified)].sort()).toEqual(classified.sort());
    expect(schemaTables.sort()).toEqual(classified.sort());
  });
});

describe("webhook idempotency schema", () => {
  it("dedupes inbound events by source, provider account, and external id", () => {
    expect(webhookSchema).toContain("providerAccountId");
    expect(webhookSchema).toContain("webhook_inbound_events_source_account_external_uq");
    expect(webhookSchema).toContain("t.providerAccountId");
  });

  it("does not insert inbound webhook events under anonymous provider accounts", () => {
    for (const route of [ghlWebhookRoute, aircallWebhookRoute]) {
      expect(route).toContain('skipped: "no_provider_account"');
      expect(route).not.toContain('?? "unknown"');
      expect(route).not.toContain('?? "global"');
    }
    expect(fathomWebhookRoute).toContain("verifyFathomWebhookScope");
    expect(fathomWebhookRoute).not.toContain('?? "unknown"');
    expect(fathomWebhookRoute).not.toContain('?? "global"');
  });

  it("keeps Fathom customer matching constrained to the webhook tenant key", () => {
    expect(fathomWebhookRoute).toContain("verifyFathomWebhookScope");
    expect(fathomWebhookRoute).toContain("`subAccount:${scope.subAccountId}`");
    expect(fathomWebhookRoute).toContain("`workspace:${scope.workspaceId}`");
    expect(fathomWebhookHandler).toContain("parseFathomProviderAccountId");
    expect(fathomWebhookHandler).toContain("eq(schema.customers.subAccountId, scope.subAccountId)");
    expect(fathomWebhookHandler).toContain("eq(schema.customers.workspaceId, scope.workspaceId!)");
  });
});

describe("data spine indexes", () => {
  it("scopes provider external ids by sub-account", () => {
    expect(salesSchema).toContain("sales_sub_source_external_uq");
    expect(formsSchema).toContain("optins_sub_source_external_uq");
    expect(formsSchema).toContain("applications_sub_source_external_uq");
    expect(dataSpineIndexesSql).toContain(
      "UNIQUE (sub_account_id, source_integration, external_id)",
    );
  });

  it("adds lookup indexes needed by Sprint 1 query paths", () => {
    expect(dataSourcesSchema).toContain("data_source_connections_tool_external_idx");
    expect(commissionsSchema).toContain("commission_entries_sub_recipient_status_available_idx");
    expect(dataSpineIndexesSql).toContain("customers_sub_lower_email_idx");
    expect(dataSpineIndexesSql).toContain("memberships_user_workspace_null_sub_uq");
  });
});

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function readSchemaTableNames(): string[] {
  const schemaDir = new URL("./schema/", import.meta.url);
  const names = new Set<string>();
  for (const file of readdirSync(schemaDir)) {
    if (!file.endsWith(".ts") || file === "index.ts" || file === "enums.ts") continue;
    const source = readFileSync(new URL(`./schema/${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/pgTable\(\s*["']([^"']+)["']/g)) {
      names.add(match[1]!);
    }
  }
  return [...names];
}
