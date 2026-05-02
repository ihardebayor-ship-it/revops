import { describe, expect, it } from "vitest";
import { _internal } from "./timeseries";

const { emptyBuckets, mergeBuckets } = _internal;

describe("emptyBuckets", () => {
  it("emits one bucket per UTC day across the window inclusive", () => {
    const buckets = emptyBuckets(
      {
        from: new Date("2026-05-01T12:00:00Z"),
        to: new Date("2026-05-04T08:00:00Z"),
      },
      "day",
    );
    expect(buckets.map((b) => b.bucket)).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
    ]);
    expect(buckets.every((b) => b.value === 0)).toBe(true);
  });

  it("emits weekly buckets stepped by 7 days", () => {
    const buckets = emptyBuckets(
      {
        from: new Date("2026-05-01T00:00:00Z"),
        to: new Date("2026-05-22T00:00:00Z"),
      },
      "week",
    );
    expect(buckets.length).toBe(4);
  });
});

describe("mergeBuckets", () => {
  it("preserves zero-buckets and overlays non-zero values by key", () => {
    const empty = [
      { bucket: "2026-05-01", value: 0 },
      { bucket: "2026-05-02", value: 0 },
      { bucket: "2026-05-03", value: 0 },
    ];
    const merged = mergeBuckets(empty, [
      { bucket: "2026-05-02", value: 1500 },
    ]);
    expect(merged.map((b) => b.value)).toEqual([0, 1500, 0]);
  });

  it("ignores rows with bucket keys not in the empty scaffold", () => {
    const empty = [{ bucket: "2026-05-01", value: 0 }];
    const merged = mergeBuckets(empty, [
      { bucket: "2026-04-30", value: 999 }, // outside window
    ]);
    expect(merged).toEqual([{ bucket: "2026-05-01", value: 0 }]);
  });
});
