import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const callsSource = readFileSync(new URL("./calls/index.ts", import.meta.url), "utf8");
const customersSource = readFileSync(new URL("./customers/index.ts", import.meta.url), "utf8");
const goalsSource = readFileSync(new URL("./goals/index.ts", import.meta.url), "utf8");
const reconciliationSource = readFileSync(
  new URL("./reconciliation/index.ts", import.meta.url),
  "utf8",
);
const retentionSource = readFileSync(new URL("./analytics/retention.ts", import.meta.url), "utf8");
const salesSource = readFileSync(new URL("./sales/index.ts", import.meta.url), "utf8");
const teamSource = readFileSync(new URL("./team/index.ts", import.meta.url), "utf8");

describe("data spine tenant guards", () => {
  it("requires calls and opt-ins to share the selected sub-account before linking", () => {
    const linkOptinSection = sectionBetween(
      callsSource,
      "export async function linkOptin",
      "export async function softDeleteCall",
    );

    expect(linkOptinSection).toContain("eq(schema.calls.subAccountId, input.subAccountId)");
    expect(linkOptinSection).toContain("eq(schema.optins.subAccountId, input.subAccountId)");
  });

  it("requires sales and calls to share the selected sub-account before linking", () => {
    const linkToCallSection = sectionBetween(
      salesSource,
      "export async function linkToCall",
      "export async function unlinkFromCall",
    );

    expect(linkToCallSection).toContain("eq(schema.sales.subAccountId, args.subAccountId)");
    expect(linkToCallSection).toContain("eq(schema.calls.subAccountId, args.subAccountId)");
    expect(linkToCallSection).toContain('throw new Error("Sale or call not found")');
  });

  it("keeps call and sale list queries date-range filterable", () => {
    expect(callsSource).toContain("appointmentFrom?: Date | null");
    expect(callsSource).toContain("gte(schema.calls.appointmentAt, filter.appointmentFrom)");
    expect(callsSource).toContain("lte(schema.calls.appointmentAt, filter.appointmentTo)");
    expect(salesSource).toContain("closedFrom?: Date | null");
    expect(salesSource).toContain("gte(schema.sales.closedAt, filter.closedFrom)");
    expect(salesSource).toContain("lte(schema.sales.closedAt, filter.closedTo)");
  });

  it("validates assignment and commission targets against the selected sub-account", () => {
    expect(callsSource).toContain("assertAssignableUsersInSubAccount");
    expect(callsSource).toContain("Assigned call users must belong to the selected sub-account");
    expect(salesSource).toContain("assertRecipientsInSubAccount");
    expect(salesSource).toContain("Commission recipients must belong to the selected sub-account");
    expect(salesSource).toContain("Linked call must belong to the selected sub-account");
  });

  it("keeps goals and team attainment scoped to the selected sub-account", () => {
    expect(goalsSource).toContain("eq(schema.goals.subAccountId, args.subAccountId)");
    expect(goalsSource).toContain("eq(schema.memberships.subAccountId, args.subAccountId)");
    expect(goalsSource).toContain("AND s.sub_account_id = ${args.subAccountId}");
    expect(goalsSource).toContain("AND cr.sub_account_id = ${args.subAccountId}");
    expect(goalsSource).toContain("assertGoalTargetInSubAccount");
  });

  it("keeps customer upsert and detail scoped to the selected sub-account", () => {
    expect(customersSource).toContain("Upsert by (sub_account_id, primary_email)");
    expect(customersSource).toContain("eq(schema.customers.subAccountId, input.subAccountId)");
    expect(customersSource).toContain("eq(schema.customers.subAccountId, args.subAccountId)");
    expect(customersSource).toContain("eq(schema.sales.subAccountId, args.subAccountId)");
    expect(customersSource).toContain("eq(schema.calls.subAccountId, args.subAccountId)");
  });

  it("keeps adjacent data-spine reads sub-account aware", () => {
    expect(teamSource).toContain("args: { workspaceId: string; subAccountId?: string | null }");
    expect(teamSource).toContain("eq(schema.memberships.subAccountId, args.subAccountId)");
    expect(retentionSource).toContain(
      "churnConditions.push(eq(schema.customers.subAccountId, args.subAccountId))",
    );
    expect(retentionSource).toContain(
      "refundConditions.push(eq(schema.sales.subAccountId, args.subAccountId))",
    );
    expect(reconciliationSource).toContain("eq(schema.customers.subAccountId, sale.subAccountId)");
    expect(reconciliationSource).toContain("eq(schema.calls.workspaceId, args.workspaceId)");
    expect(reconciliationSource).toContain("eq(schema.calls.subAccountId, sale.subAccountId)");
  });

  it("keeps rejected reconciliation suggestions tenant-scoped and filtered", () => {
    const rejectSection = sectionBetween(
      reconciliationSource,
      "export async function rejectSuggestedLink",
      "function rejectedReconciliationCallIds",
    );

    expect(reconciliationSource).toContain("rejectedReconciliationCallIds(sale.metadata)");
    expect(reconciliationSource).toContain("if (rejectedCallIds.has(call.id)) continue");
    expect(rejectSection).toContain("eq(schema.sales.workspaceId, args.workspaceId)");
    expect(rejectSection).toContain("eq(schema.sales.subAccountId, args.subAccountId)");
    expect(rejectSection).toContain("eq(schema.calls.workspaceId, args.workspaceId)");
    expect(rejectSection).toContain("eq(schema.calls.subAccountId, args.subAccountId)");
    expect(rejectSection).toContain("isNull(schema.sales.linkedCallId)");
    expect(rejectSection).toContain("isNull(schema.calls.linkedSaleId)");
  });
});

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}
