import { describe, expect, it } from "vitest";
import { _internal } from "./funnel";

const { median } = _internal;

describe("median", () => {
  it("odd-length picks the middle value", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("even-length averages the middle two", () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("empty input returns null (no median for zero data)", () => {
    expect(median([])).toBe(null);
  });

  it("single value", () => {
    expect(median([42])).toBe(42);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});
