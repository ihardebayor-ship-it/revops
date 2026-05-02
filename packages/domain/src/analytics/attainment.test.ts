// Pure-function tests for the attainment forecast. The DB-backed
// attainment() wraps computeAttainment(), so these tests cover the
// algorithm itself; the SQL aggregation is smoke-tested via dashboards.

import { describe, expect, it } from "vitest";
import { computeAttainment } from "./attainment";

describe("computeAttainment", () => {
  it("on-pace at exactly half-time matches paceFromHistory", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 50_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    expect(r.attainmentPct).toBe(0.5);
    expect(r.paceFromHistory).toBe(50_000);
    expect(r.forecastEnd).toBe(100_000);
    expect(r.status).toBe("on_pace");
  });

  it("ahead of pace gets ahead status when forecast > 105% of quota", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 60_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    // forecastEnd = 60k * (30/15) = 120k → 120% of quota → ahead
    expect(r.forecastEnd).toBe(120_000);
    expect(r.status).toBe("ahead");
  });

  it("behind status when forecast lands 70-95% of quota", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 40_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    // forecastEnd = 80k → 80% of quota → behind
    expect(r.forecastEnd).toBe(80_000);
    expect(r.status).toBe("behind");
  });

  it("at_risk status when forecast lands < 70% of quota", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 25_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    // forecastEnd = 50k → 50% of quota → at_risk
    expect(r.status).toBe("at_risk");
  });

  it("computes required daily run-rate to close the quota gap", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 40_000,
      daysElapsed: 15,
      daysRemaining: 10,
      totalDays: 25,
    });
    // remaining = 60k, daysRemaining = 10 → $6k/day
    expect(r.requiredDailyRunRate).toBe(6_000);
  });

  it("required run-rate is 0 when already over quota", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 120_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    expect(r.requiredDailyRunRate).toBe(0);
    expect(r.attainmentPct).toBe(1.2);
  });

  it("zero quota is treated as on_pace, not divide-by-zero", () => {
    const r = computeAttainment({
      quota: 0,
      attained: 50_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    expect(r.attainmentPct).toBe(0);
    expect(r.status).toBe("on_pace");
  });

  it("zero days elapsed forecasts zero (no signal yet)", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 0,
      daysElapsed: 0,
      daysRemaining: 30,
      totalDays: 30,
    });
    expect(r.forecastEnd).toBe(0);
    expect(r.status).toBe("at_risk"); // 0 < 70% of quota
  });

  it("confidence band brackets the forecast at ±15%", () => {
    const r = computeAttainment({
      quota: 100_000,
      attained: 50_000,
      daysElapsed: 15,
      daysRemaining: 15,
      totalDays: 30,
    });
    expect(r.forecastConfidenceLow).toBeCloseTo(85_000, 5);
    expect(r.forecastConfidenceHigh).toBeCloseTo(115_000, 5);
  });
});
