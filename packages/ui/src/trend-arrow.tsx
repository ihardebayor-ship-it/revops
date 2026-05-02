// Tiny trend-arrow indicator. Shows direction + delta percentage in a
// single inline element. Use next to any number that has a previous-period
// comparison.

import { cn } from "./utils";

export type TrendArrowProps = {
  /** Trend direction. "flat" hides the arrow. */
  trend: "up" | "down" | "flat";
  /** Optional percentage delta as a fraction (e.g. 0.12 for +12%). */
  deltaPct?: number | null;
  /** Reverse the color polarity (e.g. for refund rate where down = good). */
  invertColors?: boolean;
  className?: string;
};

export function TrendArrow({ trend, deltaPct, invertColors, className }: TrendArrowProps) {
  if (trend === "flat" || deltaPct === null || deltaPct === undefined) {
    return (
      <span className={cn("text-xs text-zinc-500", className)} aria-hidden>
        →
      </span>
    );
  }
  const isPositive = invertColors ? trend === "down" : trend === "up";
  const color = isPositive ? "text-emerald-400" : "text-rose-400";
  const arrow = trend === "up" ? "↑" : "↓";
  const sign = trend === "up" ? "+" : "";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium", color, className)}
    >
      <span aria-hidden>{arrow}</span>
      <span>
        {sign}
        {(deltaPct * 100).toFixed(1)}%
      </span>
    </span>
  );
}
