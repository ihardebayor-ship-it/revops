import { describe, expect, it } from "vitest";
import { percentile } from "./speed-to-lead";

describe("percentile", () => {
  it("returns the value at the given quantile (sorted input)", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 5);
  });

  it("single-value list returns that value", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.9)).toBe(42);
  });

  it("empty list returns 0", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("p100 returns the max", () => {
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it("p0 returns the min", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  it("interpolates linearly between adjacent values", () => {
    // p25 of [0..100] in steps of 1 should be 24.75 (linear interp on 100 items)
    const arr = Array.from({ length: 101 }, (_, i) => i);
    expect(percentile(arr, 0.25)).toBeCloseTo(25, 5);
  });
});
