// Pure-function tests for the commission engine's compute step. No DB.
// Covers the algorithm-spec edge cases listed in the M4 plan.

import { describe, expect, it } from "vitest";
import { computeEntriesForInstallment, type ComputeInstallment, type ComputeRecipient } from "./compute";

function recipient(over: Partial<ComputeRecipient> = {}): ComputeRecipient {
  return {
    recipientId: "r-1",
    userId: "u-1",
    salesRoleId: "role-1",
    salesRoleVersionId: "rv-1",
    sharePct: 1,
    ruleId: "rule-1",
    ruleVersionId: "rv-1",
    ruleHoldDays: 30,
    rulePaidOn: "collected",
    ruleCurrency: "USD",
    ...over,
  };
}

function installment(over: Partial<ComputeInstallment> = {}): ComputeInstallment {
  return {
    id: "i-1",
    expectedAmount: "1000.00",
    actualAmount: null,
    expectedDate: "2026-05-01",
    collectedAt: null,
    status: "scheduled",
    currency: "USD",
    ...over,
  };
}

describe("computeEntriesForInstallment", () => {
  it("solo seller takes 100% of the base", () => {
    const out = computeEntriesForInstallment(installment(), [recipient()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.amount).toBe("1000.00");
    expect(out[0]!.userId).toBe("u-1");
  });

  it("setter+closer 20/80 split sums exactly to base", () => {
    const out = computeEntriesForInstallment(installment({ expectedAmount: "1666.67" }), [
      recipient({ recipientId: "r-setter", userId: "u-setter", sharePct: 0.2 }),
      recipient({ recipientId: "r-closer", userId: "u-closer", sharePct: 0.8 }),
    ]);
    expect(out).toHaveLength(2);
    const total = out.reduce((acc, e) => acc + Number(e.amount), 0);
    expect(total).toBeCloseTo(1666.67, 2);
  });

  it("rounds with penny remainder going to highest-share recipient", () => {
    // base = 100, three-way split 0.333/0.333/0.334 -> 33.33+33.33+33.34=100.00
    const out = computeEntriesForInstallment(installment({ expectedAmount: "100.00" }), [
      recipient({ recipientId: "a", userId: "ua", sharePct: 0.333 }),
      recipient({ recipientId: "b", userId: "ub", sharePct: 0.333 }),
      recipient({ recipientId: "c", userId: "uc", sharePct: 0.334 }),
    ]);
    const total = out.reduce((acc, e) => acc + Number(e.amount), 0);
    expect(total).toBeCloseTo(100.0, 2);
    // The highest-share recipient (c) should receive any remainder.
    const cAmount = Number(out.find((e) => e.userId === "uc")!.amount);
    const aAmount = Number(out.find((e) => e.userId === "ua")!.amount);
    expect(cAmount).toBeGreaterThanOrEqual(aAmount);
  });

  it("empty recipients returns empty entry list", () => {
    expect(computeEntriesForInstallment(installment(), [])).toEqual([]);
  });

  it("hold period anchors to expectedDate when installment is not collected", () => {
    const out = computeEntriesForInstallment(
      installment({ expectedDate: "2026-05-01", status: "scheduled" }),
      [recipient({ ruleHoldDays: 30 })],
    );
    expect(out[0]!.pendingUntil.toISOString().slice(0, 10)).toBe("2026-05-31");
  });

  it("hold period anchors to collectedAt when installment is collected and rule is paid_on=collected", () => {
    const collectedAt = new Date("2026-06-15T12:00:00Z");
    const out = computeEntriesForInstallment(
      installment({
        expectedDate: "2026-05-01",
        actualAmount: "1000.00",
        collectedAt,
        status: "collected",
      }),
      [recipient({ ruleHoldDays: 14, rulePaidOn: "collected" })],
    );
    expect(out[0]!.pendingUntil.toISOString().slice(0, 10)).toBe("2026-06-29");
  });

  it("uses actualAmount when rule.paidOn=collected and installment is collected", () => {
    const out = computeEntriesForInstallment(
      installment({
        expectedAmount: "1000.00",
        actualAmount: "950.00", // partial collection
        collectedAt: new Date("2026-06-01T00:00:00Z"),
        status: "collected",
      }),
      [recipient({ rulePaidOn: "collected" })],
    );
    expect(out[0]!.amount).toBe("950.00");
  });

  it("uses expectedAmount when rule.paidOn=booked even if installment is collected", () => {
    const out = computeEntriesForInstallment(
      installment({
        expectedAmount: "1000.00",
        actualAmount: "950.00",
        collectedAt: new Date("2026-06-01T00:00:00Z"),
        status: "collected",
      }),
      [recipient({ rulePaidOn: "booked" })],
    );
    expect(out[0]!.amount).toBe("1000.00");
  });

  it("preserves recipient order in output", () => {
    const out = computeEntriesForInstallment(installment(), [
      recipient({ recipientId: "a", userId: "ua", sharePct: 0.5 }),
      recipient({ recipientId: "b", userId: "ub", sharePct: 0.5 }),
    ]);
    expect(out.map((e) => e.userId)).toEqual(["ua", "ub"]);
  });

  it("computedFrom blob captures all the inputs the engine used", () => {
    const out = computeEntriesForInstallment(installment(), [recipient({ sharePct: 0.6 })]);
    const cf = out[0]!.computedFrom;
    expect(cf.base).toBe("1000.00");
    expect(cf.sharePct).toBe(0.6);
    expect(cf.holdDays).toBe(30);
    expect(cf.paidOn).toBe("collected");
  });
});
