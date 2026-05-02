// Forecast card: the hero element on Closer + Manager dashboards.
// Shows attainment-to-quota with a status-graded color, the forecast
// number, the confidence band, and an honest "what's needed" line.
//
// Status mapping:
//   ahead    → emerald
//   on_pace  → blue
//   behind   → amber
//   at_risk  → rose

import { type ReactNode } from "react";
import { cn } from "./utils";

export type ForecastStatus = "ahead" | "on_pace" | "behind" | "at_risk";

export type ForecastCardProps = {
  /** Headline narrative — "Tracking to 96% of quota". */
  headline: string;
  /** Status drives color. */
  status: ForecastStatus;
  /** Big primary number (e.g. attained dollars). */
  primaryValue: ReactNode;
  /** Smaller secondary number (e.g. forecast end-of-period). */
  secondaryValue?: ReactNode;
  /** Label under primary value. */
  primaryLabel?: string;
  /** Label under secondary value. */
  secondaryLabel?: string;
  /** 0–1 progress bar value. */
  progressPct: number;
  /** Optional reference markers on the progress bar (e.g. expected pace). */
  paceMark?: number; // 0–1
  /** Honest "what's needed" message under the bar. */
  footnote?: string;
  className?: string;
};

const STATUS_STYLES: Record<
  ForecastStatus,
  { bar: string; text: string; ring: string; pillBg: string; pillText: string }
> = {
  ahead: {
    bar: "bg-emerald-500",
    text: "text-emerald-400",
    ring: "border-emerald-500/30 bg-emerald-500/5",
    pillBg: "bg-emerald-500/15",
    pillText: "text-emerald-300",
  },
  on_pace: {
    bar: "bg-blue-500",
    text: "text-blue-400",
    ring: "border-blue-500/30 bg-blue-500/5",
    pillBg: "bg-blue-500/15",
    pillText: "text-blue-300",
  },
  behind: {
    bar: "bg-amber-500",
    text: "text-amber-400",
    ring: "border-amber-500/30 bg-amber-500/5",
    pillBg: "bg-amber-500/15",
    pillText: "text-amber-300",
  },
  at_risk: {
    bar: "bg-rose-500",
    text: "text-rose-400",
    ring: "border-rose-500/30 bg-rose-500/5",
    pillBg: "bg-rose-500/15",
    pillText: "text-rose-300",
  },
};

export function ForecastCard({
  headline,
  status,
  primaryValue,
  secondaryValue,
  primaryLabel,
  secondaryLabel,
  progressPct,
  paceMark,
  footnote,
  className,
}: ForecastCardProps) {
  const s = STATUS_STYLES[status];
  const clamped = Math.max(0, Math.min(1, progressPct));
  const paceClamped = paceMark === undefined ? null : Math.max(0, Math.min(1, paceMark));

  return (
    <section className={cn("rounded-lg border p-5", s.ring, className)}>
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-base font-semibold", s.text)}>{headline}</p>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider",
            s.pillBg,
            s.pillText,
          )}
        >
          {status.replace("_", " ")}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between md:gap-6">
        <div>
          <p className="text-3xl font-semibold tracking-tight text-zinc-100">
            {primaryValue}
          </p>
          {primaryLabel && <p className="text-xs text-zinc-500">{primaryLabel}</p>}
        </div>
        {secondaryValue !== undefined && (
          <div className="md:text-right">
            <p className="text-base text-zinc-200">{secondaryValue}</p>
            {secondaryLabel && <p className="text-xs text-zinc-500">{secondaryLabel}</p>}
          </div>
        )}
      </div>

      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-zinc-800/70">
        <div
          className={cn("h-full rounded-full transition-all", s.bar)}
          style={{ width: `${clamped * 100}%` }}
        />
        {paceClamped !== null && (
          <div
            className="absolute top-[-2px] h-[12px] w-[2px] bg-zinc-400"
            style={{ left: `${paceClamped * 100}%` }}
            aria-label="expected pace"
          />
        )}
      </div>

      {footnote && <p className="mt-3 text-xs text-zinc-400">{footnote}</p>}
    </section>
  );
}
