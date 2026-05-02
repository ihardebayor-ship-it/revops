import { describe, expect, it } from "vitest";
import { detectAnomaly } from "./anomaly";

function series(values: number[]) {
  return values.map((v, i) => ({ bucket: `2026-05-${String(i + 1).padStart(2, "0")}`, value: v }));
}

describe("detectAnomaly", () => {
  it("flags a 3-sigma spike on a stable baseline", () => {
    // 14 baseline points = 100 ± noise; recent = 200 → big z-score.
    const baseline = Array.from({ length: 14 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const r = detectAnomaly({ series: series([...baseline, 200]) });
    expect(r.isAnomaly).toBe(true);
    expect(r.direction).toBe("up");
    expect(r.zScore).toBeGreaterThan(2);
  });

  it("does not flag a small move within noise", () => {
    // Noisier baseline so std ≈ 5; recent 103 is well within ~1σ.
    const baseline = [90, 105, 95, 110, 100, 92, 108, 100, 95, 105, 100, 102, 98, 104];
    const r = detectAnomaly({ series: series([...baseline, 103]) });
    expect(r.isAnomaly).toBe(false);
  });

  it("flags a downside drop too — including the zero-variance baseline case", () => {
    const baseline = Array.from({ length: 14 }, () => 100);
    const r = detectAnomaly({ series: series([...baseline, 50]) });
    // Zero-variance baseline + downside move = infinite z; we still flag.
    expect(r.isAnomaly).toBe(true);
    expect(r.direction).toBe("down");
  });

  it("never flags when baseline has fewer than 3 points (not enough signal)", () => {
    const r = detectAnomaly({ series: series([100, 100, 999]) });
    expect(r.isAnomaly).toBe(false);
    expect(r.baselineCount).toBe(2);
  });

  it("zero stddev with matching recent returns flat z=0, not anomaly", () => {
    const r = detectAnomaly({ series: series([100, 100, 100, 100, 100, 100]) });
    expect(r.isAnomaly).toBe(false);
    expect(r.zScore).toBe(0);
  });

  it("zero stddev with different recent flags as anomaly via the infinite-z branch", () => {
    const r = detectAnomaly({ series: series([100, 100, 100, 100, 100, 200]) });
    expect(r.isAnomaly).toBe(true);
    expect(Number.isFinite(r.zScore)).toBe(false);
  });

  it("empty series returns inert result", () => {
    const r = detectAnomaly({ series: [] });
    expect(r.isAnomaly).toBe(false);
    expect(r.recentValue).toBe(0);
    expect(r.baselineCount).toBe(0);
  });

  it("uses custom z threshold when provided", () => {
    // Hand-tuned baseline with std ≈ 4. Recent value = 106 → z ≈ 1.5σ —
    // fires at threshold 1, not at threshold 2. Deterministic seed so the
    // test never flakes.
    const baseline = [94, 96, 98, 100, 102, 104, 106, 94, 100, 100, 102, 98, 104, 100];
    const recent = 106;
    const above1 = detectAnomaly({ series: series([...baseline, recent]), zThreshold: 1 });
    const above2 = detectAnomaly({ series: series([...baseline, recent]), zThreshold: 2 });
    expect(above1.isAnomaly).toBe(true);
    expect(above2.isAnomaly).toBe(false);
  });
});
