// Stacked health-distribution bar. Used for the CX dashboard's
// "book health" hero (Healthy / Watch / At-risk / Churning) and for any
// other multi-segment status mix.

import { cn } from "./utils";

export type HealthBarSegment = {
  label: string;
  value: number;
  /** Tailwind color class (bg-…). Picked at the call site. */
  colorClass: string;
};

export type HealthBarProps = {
  segments: HealthBarSegment[];
  className?: string;
  /** When true, render label + count above the bar. Default true. */
  showLegend?: boolean;
};

export function HealthBar({ segments, showLegend = true, className }: HealthBarProps) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="h-2 rounded-full bg-zinc-800" />
        <p className="text-xs text-zinc-500">No data yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className={cn("h-full", s.colorClass)}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${s.value}`}
            />
          );
        })}
      </div>
      {showLegend && (
        <ul className="flex flex-wrap gap-3 text-xs">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", s.colorClass)} />
              <span className="text-zinc-300">{s.label}</span>
              <span className="text-zinc-500">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
