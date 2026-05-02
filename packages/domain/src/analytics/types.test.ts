import { describe, expect, it } from "vitest";
import { compareMetrics, previousPeriod } from "./types";

describe("compareMetrics", () => {
  it("flags up trend when current > previous by >1%", () => {
    const r = compareMetrics(110, 100);
    expect(r.deltaAbs).toBe(10);
    expect(r.deltaPct).toBeCloseTo(0.1, 5);
    expect(r.trend).toBe("up");
  });

  it("flags down trend when current < previous", () => {
    const r = compareMetrics(80, 100);
    expect(r.deltaPct).toBeCloseTo(-0.2, 5);
    expect(r.trend).toBe("down");
  });

  it("treats <1% absolute change as flat (avoid noise)", () => {
    const r = compareMetrics(100.5, 100);
    expect(r.trend).toBe("flat");
  });

  it("null previous returns flat with no delta", () => {
    const r = compareMetrics(100, null);
    expect(r.trend).toBe("flat");
    expect(r.deltaAbs).toBe(null);
    expect(r.deltaPct).toBe(null);
  });

  it("zero previous returns null deltaPct (avoid divide-by-zero)", () => {
    const r = compareMetrics(50, 0);
    expect(r.deltaPct).toBe(null);
    expect(r.trend).toBe("flat");
  });
});

describe("previousPeriod", () => {
  it("returns a window of equal length immediately preceding the given one", () => {
    const cur = {
      from: new Date("2026-05-01T00:00:00Z"),
      to: new Date("2026-05-31T00:00:00Z"),
    };
    const prev = previousPeriod(cur);
    const span = cur.to.getTime() - cur.from.getTime();
    expect(prev.to.getTime()).toBe(cur.from.getTime());
    expect(prev.from.getTime()).toBe(cur.from.getTime() - span);
  });
});
