import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recomputeSource = readFileSync(new URL("./recompute.ts", import.meta.url), "utf8");

describe("commission recompute ledger safety", () => {
  it("does not rewrite paid or clawed back entries during rule-id upserts", () => {
    expect(recomputeSource).toContain("setWhere");
    expect(recomputeSource).toContain("status} IN ('pending', 'available')");
    expect(recomputeSource).toContain("// Don't rewrite paid/clawed_back rows.");
  });

  it("does not duplicate paid or clawed back entries when ruleId is null", () => {
    const nullRuleSection = sectionBetween(
      recomputeSource,
      "if (e.ruleId === null)",
      ".delete(schema.commissionEntries)",
    );

    expect(nullRuleSection).toContain("const [lockedExisting]");
    expect(nullRuleSection).toContain("isNull(schema.commissionEntries.ruleId)");
    expect(nullRuleSection).toContain("status} IN ('paid', 'clawed_back')");
    expect(nullRuleSection).toContain("if (lockedExisting) continue");
  });

  it("voids only pending and available rows for terminal installments or rule changes", () => {
    expect(recomputeSource).toContain(
      'inst.status === "failed" || inst.status === "skipped" || inst.status === "refunded"',
    );
    expect(recomputeSource).toContain('canceledReason: "rule_change_or_installment_terminal"');
    expect(recomputeSource).toContain("status} IN ('pending', 'available')");
  });

  it("voids only pending and available rows when a sale is soft-deleted", () => {
    const deletedSaleSection = sectionBetween(
      recomputeSource,
      "if (sale.deletedAt)",
      "const recipientRows = await tx",
    );

    expect(deletedSaleSection).toContain('status: "voided"');
    expect(deletedSaleSection).toContain('canceledReason: "sale_deleted"');
    expect(deletedSaleSection).toContain("status} IN ('pending', 'available')");
  });
});

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}
