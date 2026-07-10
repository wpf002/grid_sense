// Pure helpers for turning generated alert rows into human sentences.
// Kept out of the component so they can be unit-tested without a DOM.

import type { Alert } from "@shared/schema";
import { formatDay } from "./dates";

export type Direction = "up" | "down" | "neutral";

export interface ParsedAlert {
  /** The place as written in the title, e.g. "Loudoun, VA". */
  place: string | null;
  fromTier: string | null;
  toTier: string | null;
  direction: Direction;
  /** Points moved, if the detail line carries a number. */
  points: number | null;
  /** The two dates the comparison spans. */
  fromDate: string | null;
  toDate: string | null;
}

export const TIER_RANK: Record<string, number> = { cold: 0, emerging: 1, warm: 2, hot: 3 };

/**
 * Alerts are generated machine-side as "Washington, WI: emerging → cold" with a
 * detail like "Landing-probability fell 5 pts day-over-day (2026-07-07 →
 * 2026-07-09)." That's a log line, not a sentence. Pull it apart so the UI can
 * render it the way a person would say it. Anything unrecognized degrades to a
 * neutral alert rather than throwing — new alert types must not break the page.
 */
export function parseAlert(a: Pick<Alert, "title" | "detail">): ParsedAlert {
  const title = a.title ?? "";
  const detail = a.detail ?? "";

  const tierMatch = title.match(/^(.*?):\s*(\w+)\s*→\s*(\w+)\s*$/);
  const place = tierMatch ? tierMatch[1].trim() : title.split(":")[0]?.trim() || null;
  const fromTier = tierMatch ? tierMatch[2].toLowerCase() : null;
  const toTier = tierMatch ? tierMatch[3].toLowerCase() : null;

  let direction: Direction = "neutral";
  if (fromTier && toTier && TIER_RANK[fromTier] != null && TIER_RANK[toTier] != null) {
    direction =
      TIER_RANK[toTier] > TIER_RANK[fromTier] ? "up" : TIER_RANK[toTier] < TIER_RANK[fromTier] ? "down" : "neutral";
  } else if (/\bfell\b|\bdropped\b|\bdown\b/i.test(detail)) direction = "down";
  else if (/\brose\b|\bgained\b|\bup\b/i.test(detail)) direction = "up";

  const ptsMatch = detail.match(/(\d+(?:\.\d+)?)\s*pts?\b/i);
  const dates = detail.match(/(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})/);

  return {
    place,
    fromTier,
    toTier,
    direction,
    points: ptsMatch ? Number(ptsMatch[1]) : null,
    fromDate: dates?.[1] ?? null,
    toDate: dates?.[2] ?? null,
  };
}

/** Rebuild the alert as a sentence instead of echoing the raw machine string. */
export function alertSentence(p: ParsedAlert, fallback: string): string {
  if (p.points == null) return fallback;
  const verb = p.direction === "up" ? "rose" : "fell";
  const span = p.fromDate && p.toDate ? ` between ${shortDate(p.fromDate)} and ${shortDate(p.toDate)}` : "";
  return `Landing probability ${verb} ${p.points} ${p.points === 1 ? "point" : "points"}${span}.`;
}

/** "2026-07-09" -> "Jul 9" */
export const shortDate = (iso: string | null): string => formatDay(iso, { month: "short", day: "numeric" });

/** Relative label for when the alert fired. */
export function firedAtLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hours = (now - d.getTime()) / 36e5;
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
