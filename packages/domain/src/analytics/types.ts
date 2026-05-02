// Shared types for the analytics module. Every dashboard consumes these
// shapes; the tRPC layer + agent analytics tools serialize them.

export type Period = {
  from: Date;
  to: Date;
};

export type BucketGranularity = "day" | "week";

export type TimeseriesPoint = {
  bucket: string; // ISO date (YYYY-MM-DD), keyed for stable rendering
  value: number;
};

export type Trend = "up" | "down" | "flat";

export type ComparativeMetric = {
  current: number;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null; // 0–1
  trend: Trend;
};

export function compareMetrics(current: number, previous: number | null): ComparativeMetric {
  if (previous === null || previous === undefined) {
    return { current, previous: null, deltaAbs: null, deltaPct: null, trend: "flat" };
  }
  const deltaAbs = current - previous;
  const deltaPct = previous === 0 ? null : deltaAbs / previous;
  // Treat <1% absolute pct change as flat to avoid noise.
  const trend: Trend =
    deltaPct === null
      ? "flat"
      : Math.abs(deltaPct) < 0.01
        ? "flat"
        : deltaPct > 0
          ? "up"
          : "down";
  return { current, previous, deltaAbs, deltaPct, trend };
}

export function previousPeriod(period: Period): Period {
  const span = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - span),
    to: new Date(period.from.getTime()),
  };
}
