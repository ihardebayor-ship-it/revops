import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routersDir = new URL(".", import.meta.url);
const contextSource = readFileSync(new URL("../context.ts", import.meta.url), "utf8");
const callsSource = readFileSync(new URL("./calls.ts", import.meta.url), "utf8");
const salesSource = readFileSync(new URL("./sales.ts", import.meta.url), "utf8");
const webhooksSource = readFileSync(new URL("./webhooks.ts", import.meta.url), "utf8");
const commissionsSource = readFileSync(new URL("./commissions.ts", import.meta.url), "utf8");

describe("router mutation authorization", () => {
  it("does not define mutations from plain authedProcedure", () => {
    const offenders = readdirSync(routersDir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(join(routersDir.pathname, file), "utf8");
        return findPlainAuthedMutations(source).map((name) => `${file}:${name}`);
      });

    expect(offenders).toEqual([]);
  });
});

describe("data spine guards", () => {
  it("populates sales role slugs for role-targeted task visibility", () => {
    expect(contextSource).toContain("salesRoleAssignments");
    expect(contextSource).toContain("salesRoles.slug");
    expect(contextSource).toContain(
      "salesRoleSlugs: [...new Set(roleRows.map((row) => row.slug))]",
    );
    expect(contextSource).not.toContain("for now `salesRoleSlugs` is empty");
  });

  it("keeps core list APIs date-range filterable", () => {
    expect(callsSource).toContain("appointmentFrom");
    expect(callsSource).toContain("appointmentTo");
    expect(salesSource).toContain("closedFrom");
    expect(salesSource).toContain("closedTo");
  });
});

describe("webhook ops safeguards", () => {
  it("does not expose raw inbound payloads from the ops list", () => {
    expect(webhooksSource).toContain("listInbound");
    expect(webhooksSource).toContain("externalId: schema.webhookInboundEvents.externalId");
    expect(webhooksSource).not.toContain("payload: schema.webhookInboundEvents.payload");
  });

  it("scopes inbound replay by connected provider account before dispatch", () => {
    expect(webhooksSource).toContain("const providerPairs = await listAllowedProviderAccounts");
    expect(webhooksSource).toContain(
      "const providerCondition = buildProviderCondition(providerPairs)",
    );
    expect(webhooksSource).toContain(
      "and(eq(schema.webhookInboundEvents.id, input.inboundEventId), providerCondition)",
    );
    expect(webhooksSource).toContain("eq(schema.webhookInboundEvents.providerAccountId");
  });

  it("rejects unsupported webhook sources during replay", () => {
    expect(webhooksSource).toContain("const eventName = getReplayEventName(row.source)");
    expect(webhooksSource).toContain("Unsupported webhook source");
    expect(webhooksSource).toContain('if (source === "gohighlevel") return "ghl.webhook.received"');
    expect(webhooksSource).toContain('if (source === "aircall") return "aircall.webhook.received"');
    expect(webhooksSource).toContain('if (source === "fathom") return "fathom.webhook.received"');
  });
});

describe("commission ops safeguards", () => {
  it("keeps ledger health scoped to the selected workspace and sub-account", () => {
    expect(commissionsSource).toContain("health: authedProcedure.query");
    expect(commissionsSource).toContain(
      "eq(schema.commissionEntries.workspaceId, ctx.user.workspaceId)",
    );
    expect(commissionsSource).toContain(
      "eq(schema.commissionEntries.subAccountId, ctx.user.subAccountId)",
    );
    expect(commissionsSource).toContain("eq(schema.sales.subAccountId, ctx.user.subAccountId)");
    expect(commissionsSource).toContain("missingExplanation");
    expect(commissionsSource).toContain("stalePending");
  });
});

function findPlainAuthedMutations(source: string): string[] {
  const offenders: string[] = [];
  const mutationPattern = /\b([A-Za-z0-9_]+):\s+authedProcedure\b[\s\S]*?\.mutation\(/g;
  let match: RegExpExecArray | null;

  while ((match = mutationPattern.exec(source))) {
    const snippet = match[0];
    if (!snippet.includes("authedProcedureWith(")) {
      offenders.push(match[1]!);
    }
  }

  return offenders;
}
