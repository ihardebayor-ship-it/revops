// Inline-SVG sparkline. Zero deps, tiny render cost, identical on
// server + client. Auto-scales to the value range; an optional
// referenceLine (e.g. quota target) overlays as a dashed horizontal.

import { type CSSProperties } from "react";

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  /** Tailwind color name keyed off context: emerald = positive trend,
   *  rose = negative, blue = neutral. */
  tone?: "emerald" | "rose" | "blue" | "amber" | "zinc";
  /** Optional dashed horizontal line (target / median / etc.). */
  referenceLine?: number;
  /** Show a filled-area underneath. Default true; false = pure line. */
  fill?: boolean;
  className?: string;
};

const STROKE: Record<NonNullable<SparklineProps["tone"]>, string> = {
  emerald: "#10b981",
  rose: "#f43f5e",
  blue: "#3b82f6",
  amber: "#f59e0b",
  zinc: "#71717a",
};

export function Sparkline({
  values,
  width = 120,
  height = 32,
  tone = "blue",
  referenceLine,
  fill = true,
  className,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#3f3f46"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const min = Math.min(...values, referenceLine ?? Infinity);
  const max = Math.max(...values, referenceLine ?? -Infinity);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width / 2;
  const padding = 2;
  const usableHeight = height - padding * 2;

  const pointAt = (v: number, i: number): [number, number] => {
    const x = values.length > 1 ? i * stepX : width / 2;
    const y = padding + (1 - (v - min) / range) * usableHeight;
    return [x, y];
  };

  const points = values.map((v, i) => pointAt(v, i));
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const fillPath =
    fill && points.length > 0
      ? `${linePath} L${(points[points.length - 1]![0]).toFixed(1)},${height} L${points[0]![0].toFixed(
          1,
        )},${height} Z`
      : null;

  const stroke = STROKE[tone];
  const fillStyle: CSSProperties = { fill: stroke, fillOpacity: 0.12 };

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      {referenceLine !== undefined && (
        <line
          x1={0}
          y1={padding + (1 - (referenceLine - min) / range) * usableHeight}
          x2={width}
          y2={padding + (1 - (referenceLine - min) / range) * usableHeight}
          stroke="#52525b"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      {fillPath && <path d={fillPath} style={fillStyle} />}
      <path d={linePath} stroke={stroke} strokeWidth={1.5} fill="none" />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1]![0]}
          cy={points[points.length - 1]![1]}
          r={2}
          fill={stroke}
        />
      )}
    </svg>
  );
}
