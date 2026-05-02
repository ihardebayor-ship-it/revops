// Pure anomaly detector. Takes a time series, returns whether the most
// recent point is z-score-anomalous against the baseline of prior points.
// No DB. Used as an overlay on top of any timeseries function — funnel
// rate, daily booked $, show rate, refund rate, etc.

import type { TimeseriesPoint } from "./types";

export type AnomalyArgs = {
  series: TimeseriesPoint[];
  /** Number of points to use as the historical baseline. The most recent
   *  point is the candidate. Defaults to 14 (two weeks of daily data). */
  baselineSize?: number;
  /** z-score threshold above which the recent value is flagged as anomaly.
   *  Default 2.0 → ~95% confidence the move isn't noise. */
  zThreshold?: number;
};

export type AnomalyResult = {
  isAnomaly: boolean;
  direction: "up" | "down" | "flat";
  zScore: number;
  recentValue: number;
  historicalMean: number;
  historicalStd: number;
  /** How many baseline points were used. If <3, anomaly detection is
   *  effectively disabled — we don't have enough signal yet. */
  baselineCount: number;
};

export function detectAnomaly(args: AnomalyArgs): AnomalyResult {
  const baselineSize = args.baselineSize ?? 14;
  const zThreshold = args.zThreshold ?? 2.0;
  const series = args.series;

  if (series.length === 0) {
    return {
      isAnomaly: false,
      direction: "flat",
      zScore: 0,
      recentValue: 0,
      historicalMean: 0,
      historicalStd: 0,
      baselineCount: 0,
    };
  }

  const recent = series[series.length - 1]!.value;
  const baseline = series.slice(Math.max(0, series.length - 1 - baselineSize), series.length - 1);
  const baselineCount = baseline.length;

  if (baselineCount < 3) {
    // Not enough history. Return the recent value but never flag.
    return {
      isAnomaly: false,
      direction: "flat",
      zScore: 0,
      recentValue: recent,
      historicalMean: baselineCount === 0 ? 0 : mean(baseline.map((p) => p.value)),
      historicalStd: 0,
      baselineCount,
    };
  }

  const mu = mean(baseline.map((p) => p.value));
  const sigma = std(baseline.map((p) => p.value), mu);
  let zScore: number;
  if (sigma === 0) {
    zScore = recent === mu ? 0 : recent > mu ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else {
    zScore = (recent - mu) / sigma;
  }
  const direction: "up" | "down" | "flat" =
    Number.isFinite(zScore) && Math.abs(zScore) < 0.5 ? "flat" : zScore > 0 ? "up" : "down";

  // Infinite z (zero-variance baseline + nonzero move) IS an anomaly: any
  // change against perfectly stable history is surprising. The numeric
  // value isn't meaningful but the boolean is.
  const isAnomaly = Number.isFinite(zScore)
    ? Math.abs(zScore) >= zThreshold
    : zScore !== 0;
  return {
    isAnomaly,
    direction,
    zScore,
    recentValue: recent,
    historicalMean: mu,
    historicalStd: sigma,
    baselineCount,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export const _internal = { mean, std };
