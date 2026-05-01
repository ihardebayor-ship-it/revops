// Pure-function tests for the reconciliation scorer. Validates Levenshtein-2
// fuzzy email, last-7-digit phone, name token overlap, amount match, and
// date proximity weighting.

import { describe, expect, it } from "vitest";
import { scoreCallSaleMatch } from "./index";

const baseSale = {
  customerEmail: "alex@example.com",
  customerName: "Alex Johnson",
  customerPhone: "+1 (555) 123-4567",
  bookedAmount: "5000.00",
  closedAt: new Date("2026-05-01T12:00:00Z"),
};

describe("scoreCallSaleMatch", () => {
  it("exact email match scores high", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: "alex@example.com",
        contactPhone: null,
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("email_exact");
    expect(r.score).toBeGreaterThanOrEqual(0.99);
  });

  it("levenshtein-2 typo on domain still matches as fuzzy", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: "alex@exmple.com",
        contactPhone: null,
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("email_fuzzy");
    expect(r.signals).not.toContain("email_exact");
  });

  it("phone last-7-digits match across country code drift", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: null,
        contactPhone: "555-123-4567", // no country code
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("phone_match");
  });

  it("name overlap fires on a single shared token >= 2 chars", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: null,
        contactPhone: null,
        contactName: "Mr. Johnson",
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("name_overlap");
  });

  it("amount match fires within $1 of installment expected amount", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: null,
        contactPhone: null,
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
      installmentExpectedAmount: "5000.50",
    });
    expect(r.signals).toContain("amount_match");
  });

  it("date proximity fires within 14 days of close", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: null,
        contactPhone: null,
        contactName: null,
        appointmentAt: new Date("2026-04-25T12:00:00Z"),
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("date_proximity");
  });

  it("no signals → score 0", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: null,
        contactPhone: null,
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.score).toBe(0);
    expect(r.signals).toEqual([]);
  });

  it("unrelated email + matching phone scores positive", () => {
    const r = scoreCallSaleMatch({
      call: {
        contactEmail: "different@elsewhere.com",
        contactPhone: "+44 555-123-4567",
        contactName: null,
        appointmentAt: null,
      },
      sale: baseSale,
    });
    expect(r.signals).toContain("phone_match");
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });
});
