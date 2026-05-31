import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const callsSource = readFileSync(new URL("./calls/index.ts", import.meta.url), "utf8");
const salesSource = readFileSync(new URL("./sales/index.ts", import.meta.url), "utf8");

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
});

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}
