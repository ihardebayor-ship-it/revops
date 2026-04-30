// Time renders an ISO-string or Date deterministically. Server and client
// both format in UTC by default to avoid hydration mismatches; pass `tz`
// to render in a specific zone (e.g. workspace.timezone).
//
// Phase 1 ships this minimal version. Phase 2+ adds locale-aware relative
// times ("3 minutes ago") with proper hydration boundaries.

export type TimeProps = {
  value: string | Date;
  format?: "datetime" | "date" | "time";
  tz?: string;
  className?: string;
};

export function Time({ value, format = "datetime", tz = "UTC", className }: TimeProps) {
  const date = typeof value === "string" ? new Date(value) : value;
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    ...(format === "datetime" && {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    ...(format === "date" && { year: "numeric", month: "short", day: "numeric" }),
    ...(format === "time" && { hour: "2-digit", minute: "2-digit" }),
  };
  // toISOString as the title attribute keeps the source-of-truth available
  // for power users who want UTC.
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toISOString()}
      className={className}
    >
      {new Intl.DateTimeFormat("en-US", opts).format(date)}
    </time>
  );
}
