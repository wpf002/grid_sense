// Date formatting that doesn't lose a day.
//
// Several columns are date-only strings ("2026-07-10"): signals.detected_at,
// permits.filed_date, competitive_bids.observed_date, score_history_daily.
// `new Date("2026-07-10")` parses that as midnight UTC, and toLocaleDateString
// then renders it in the viewer's zone — so anyone west of UTC sees "Jul 9".
// A signal ingested today looked a day stale to every US user.
//
// Timestamps ("2026-07-09T20:12:28.409Z") are a real instant and SHOULD be
// shown in the local zone. formatDay handles both: date-only strings are read
// as UTC and printed as UTC; full timestamps are printed locally.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/**
 * Format a date-only string or a full timestamp for display, without shifting
 * a date-only value across a timezone boundary. Returns "" for empty/invalid.
 */
export function formatDay(
  value: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!value) return "";
  const dateOnly = isDateOnly(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", dateOnly ? { ...opts, timeZone: "UTC" } : opts);
}

/** Calendar parts of a date-only string, safe to render individually. */
export function dayParts(value: string): { month: string; day: string; year: string } {
  if (!value) return { month: "", day: "", year: "" };
  const dateOnly = isDateOnly(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return { month: "", day: "", year: "" };
  const tz = dateOnly ? "UTC" : undefined;
  return {
    month: d.toLocaleDateString("en-US", { month: "short", timeZone: tz }),
    day: d.toLocaleDateString("en-US", { day: "numeric", timeZone: tz }),
    year: d.toLocaleDateString("en-US", { year: "numeric", timeZone: tz }),
  };
}
