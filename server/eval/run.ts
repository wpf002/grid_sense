// Database adapter for the point-in-time evaluator.
//
// server/eval/pit.ts holds the rules and is DB-free. This file is the thin,
// boring layer that loads snapshots and announcements out of SQLite and hands
// them over. Keeping the two apart is what makes the rules testable.

import { sqlite } from "../storage.js";
import {
  evaluatePointInTime,
  type Announcement,
  type PitOptions,
  type PitReport,
  type ScoreBasis,
  type SnapshotDay,
} from "./pit.js";

/** Snapshot rows are ~3,100/day; loading many years is still trivial for SQLite. */
export function loadSnapshotDays(): SnapshotDay[] {
  let rows: Array<{ snapshot_date: string; fips: string; score: number; base_score: number | null }>;
  try {
    rows = sqlite
      .prepare(
        `SELECT snapshot_date, fips, score, base_score
           FROM score_history_daily
          ORDER BY snapshot_date`,
      )
      .all() as any[];
  } catch {
    // base_score predates its migration on very old databases.
    rows = (sqlite
      .prepare(`SELECT snapshot_date, fips, score FROM score_history_daily ORDER BY snapshot_date`)
      .all() as any[]).map((r) => ({ ...r, base_score: null }));
  }

  const byDate = new Map<string, SnapshotDay>();
  for (const r of rows) {
    let day = byDate.get(r.snapshot_date);
    if (!day) {
      day = { date: r.snapshot_date, rows: [] };
      byDate.set(r.snapshot_date, day);
    }
    day.rows.push({ fips: r.fips, score: r.score, baseScore: r.base_score });
  }
  return [...byDate.values()];
}

export function loadAnnouncements(): Announcement[] {
  return (
    sqlite
      .prepare(
        `SELECT fips, announced_date, county_name, state, operator
           FROM dc_announcements
          WHERE fips IS NOT NULL AND announced_date IS NOT NULL
          ORDER BY announced_date`,
      )
      .all() as any[]
  ).map((r) => ({
    fips: r.fips,
    announcedDate: r.announced_date,
    countyName: r.county_name,
    state: r.state,
    operator: r.operator,
  }));
}

export function runPointInTime(options: PitOptions = {}): PitReport {
  return evaluatePointInTime(loadSnapshotDays(), loadAnnouncements(), options);
}

/**
 * Both bases in one pass. The gap between them IS the leakage estimate — once
 * there is enough history to compute it honestly.
 */
export function runBothBases(options: PitOptions = {}): Record<ScoreBasis, PitReport> {
  const days = loadSnapshotDays();
  const anns = loadAnnouncements();
  return {
    total: evaluatePointInTime(days, anns, { ...options, basis: "total" }),
    factorsOnly: evaluatePointInTime(days, anns, { ...options, basis: "factorsOnly" }),
  };
}

/** Days of history still needed before the first announcement becomes evaluable. */
export function historyOutlook(): {
  snapshotDays: number;
  earliest: string | null;
  latest: string | null;
  announcementsAfterHistoryStart: number;
  totalAnnouncements: number;
} {
  const days = sqlite
    .prepare(`SELECT MIN(snapshot_date) a, MAX(snapshot_date) b, COUNT(DISTINCT snapshot_date) n FROM score_history_daily`)
    .get() as { a: string | null; b: string | null; n: number };

  const total = (sqlite.prepare(`SELECT COUNT(*) c FROM dc_announcements`).get() as { c: number }).c;
  // An announcement is only ever evaluable if it happens after history begins.
  const after = days.a
    ? (sqlite
        .prepare(`SELECT COUNT(*) c FROM dc_announcements WHERE announced_date > ?`)
        .get(days.a.slice(0, 7)) as { c: number }).c
    : 0;

  return {
    snapshotDays: days.n,
    earliest: days.a,
    latest: days.b,
    announcementsAfterHistoryStart: after,
    totalAnnouncements: total,
  };
}
