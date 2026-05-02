// MetricCard: small stat with sparkline + trend arrow + comparison line.
// The atomic unit for non-hero metrics across every dashboard.

import { type ReactNode } from "react";
import { Sparkline, type SparklineProps } from "./sparkline";
import { TrendArrow } from "./trend-arrow";
import { cn } from "./utils";

export type MetricCardProps = {
  label: string;
  value: ReactNode;
  /** "vs last week" / "vs target" line. */
  comparison?: string;
  trend?: "up" | "down" | "flat";
  deltaPct?: number | null;
  /** Inverse colors for metrics where lower is better (refund rate, etc.) */
  invertColors?: boolean;
  /** Sparkline values (last N periods). */
  series?: number[];
  sparklineTone?: SparklineProps["tone"];
  /** Optional reference value for the sparkline (e.g. quota line). */
  referenceLine?: number;
  /** Optional click-through. Renders as <a> when present. */
  href?: string;
  className?: string;
};

export function MetricCard({
  label,
  value,
  comparison,
  trend,
  deltaPct,
  invertColors,
  series,
  sparklineTone,
  referenceLine,
  href,
  className,
}: MetricCardProps) {
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        "block rounded-lg border border-zinc-800 bg-zinc-950 p-4",
        href && "transition-colors hover:border-zinc-700 hover:bg-zinc-900/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
        {trend && (
          <TrendArrow trend={trend} deltaPct={deltaPct ?? null} invertColors={invertColors} />
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{value}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        {comparison ? (
          <p className="text-xs text-zinc-500">{comparison}</p>
        ) : (
          <span />
        )}
        {series && series.length > 0 && (
          <Sparkline values={series} tone={sparklineTone} referenceLine={referenceLine} />
        )}
      </div>
    </Wrapper>
  );
}
