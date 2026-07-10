// Point-in-time backtest — the pure core.
//
// WHY THIS EXISTS
//
// The backtest on /backtest scores counties as they look TODAY and checks
// whether announced counties rank highly. That inflates the result: when a data
// center is announced, reporters write about the county, we ingest that news as
// a signal, and signals raise the score. The model can look prescient purely
// because it read the news. That's label leakage.
//
// The only honest fix is to score each county as of the day BEFORE its
// announcement — using a snapshot taken before any of that coverage existed.
// That requires score history reaching back past each announcement date.
//
// This module is the evaluator. It is deliberately pure and DB-free: it takes
// snapshots and announcements as plain data so every rule below is unit-tested,
// and so it produces the same answer today (when history is too short to say
// anything) as it will in six months.
//
// THE CENTRAL RULE: if there is no snapshot strictly before an announcement,
// that announcement is NOT evaluable. We report it as uncovered. We never fall
// back to a later snapshot, because a later snapshot is exactly the leakage we
// are trying to eliminate. A harness that quietly substitutes today's score
// would report a great number and mean nothing.

/** One county's score on one day. */
export interface Snapshot {
  fips: string;
  /** Final landing probability: factors + signal boost. */
  score: number;
  /** Factors-only score, before the signal boost. Null on pre-migration rows. */
  baseScore: number | null;
}

/** All counties' scores for a single snapshot date. */
export interface SnapshotDay {
  date: string; // yyyy-mm-dd
  rows: Snapshot[];
}

export interface Announcement {
  fips: string;
  /** "2024-12" (month precision) or "2024-12-03". */
  announcedDate: string;
  countyName?: string;
  state?: string;
  operator?: string;
}

/** Which score column the run ranks on. */
export type ScoreBasis = "total" | "factorsOnly";

export interface EvaluatedAnnouncement {
  fips: string;
  announcedDate: string;
  /** The snapshot date actually used — always strictly before the cutoff. */
  snapshotDate: string;
  cutoff: string;
  /** Days between the snapshot and the announcement cutoff. */
  leadDays: number;
  score: number;
  /** 0..1 — fraction of counties this one outranked on that day. */
  percentile: number;
  rank: number;
  universe: number;
}

export interface UncoveredAnnouncement {
  fips: string;
  announcedDate: string;
  cutoff: string;
  reason: "no_snapshot_before_announcement" | "snapshot_too_old" | "county_absent_from_snapshot";
}

export interface PitReport {
  basis: ScoreBasis;
  /** True only when enough announcements are evaluable to say anything. */
  ready: boolean;
  /** Why the harness is not ready, in plain language. Null when ready. */
  notReady: string | null;
  totalAnnouncements: number;
  evaluated: EvaluatedAnnouncement[];
  uncovered: UncoveredAnnouncement[];
  coverage: number; // 0..1
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
  metrics: PitMetrics | null;
}

export interface PitMetrics {
  meanPercentile: number;
  medianPercentile: number;
  meanLeadDays: number;
  cutoffs: CutoffMetrics[];
}

export interface CutoffMetrics {
  /** Score threshold, e.g. 70. */
  threshold: number;
  truePositives: number;
  falseNegatives: number;
  precision: number | null; // null when nothing was flagged
  recall: number;
  f1: number | null;
  flagged: number;
}

export interface PitOptions {
  /**
   * How stale a pre-announcement snapshot may be and still count. A snapshot
   * from three years before an announcement says little about the state of the
   * world at announcement time.
   */
  maxLookbackDays?: number;
  /** Minimum evaluable announcements before headline metrics are trustworthy. */
  minEvaluable?: number;
  scoreCutoffs?: number[];
  basis?: ScoreBasis;
}

export const DEFAULT_OPTIONS: Required<PitOptions> = {
  maxLookbackDays: 540, // ~18 months: a siting decision's typical lead time
  minEvaluable: 10,
  scoreCutoffs: [50, 60, 70, 80],
  basis: "total",
};

const DAY_MS = 86_400_000;

/**
 * The last instant the model is allowed to know about. `announced_date` is
 * month-precision in our dataset ("2024-12"), and an announcement could have
 * landed on the 1st, so the cutoff is the first day of that month. Anything the
 * model saw on or after this date is potentially contaminated.
 */
export function announcementCutoff(announcedDate: string): string {
  const m = announcedDate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) throw new Error(`Unparseable announced_date: "${announcedDate}"`);
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d ?? "01"}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The newest snapshot STRICTLY BEFORE the cutoff, within the lookback window.
 * Returns null rather than reaching forward — reaching forward is the leak.
 */
export function pickSnapshotDate(
  snapshotDates: string[],
  cutoff: string,
  maxLookbackDays: number,
): { date: string | null; reason?: UncoveredAnnouncement["reason"] } {
  const before = snapshotDates.filter((d) => d < cutoff).sort();
  if (before.length === 0) return { date: null, reason: "no_snapshot_before_announcement" };
  const newest = before[before.length - 1];
  if (daysBetween(newest, cutoff) > maxLookbackDays) return { date: null, reason: "snapshot_too_old" };
  return { date: newest };
}

/** Fraction of the universe scoring strictly below `value`. Ties don't inflate. */
export function percentileRank(allScores: number[], value: number): number {
  if (allScores.length === 0) return 0;
  let below = 0;
  for (const s of allScores) if (s < value) below++;
  return below / allScores.length;
}

/** 1 = highest score. Ties share the best rank. */
export function rankOf(allScores: number[], value: number): number {
  let above = 0;
  for (const s of allScores) if (s > value) above++;
  return above + 1;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const scoreFor = (row: Snapshot, basis: ScoreBasis): number | null =>
  basis === "factorsOnly" ? row.baseScore : row.score;

/**
 * Precision/recall at a score threshold, measured on the pre-announcement
 * snapshots. `flagged` counts every county at or above the threshold on the
 * snapshot days we actually used, so precision means: of the counties we called
 * hot back then, what share went on to land a data center?
 */
export function metricsAtCutoff(
  evaluated: EvaluatedAnnouncement[],
  flaggedByDate: Map<string, number>,
  threshold: number,
): CutoffMetrics {
  const truePositives = evaluated.filter((e) => e.score >= threshold).length;
  const falseNegatives = evaluated.length - truePositives;

  // Union of counties flagged on the snapshot dates in play. A county flagged on
  // two different snapshot dates is two chances to be right, so we sum.
  let flagged = 0;
  for (const date of new Set(evaluated.map((e) => e.snapshotDate))) {
    flagged += flaggedByDate.get(date) ?? 0;
  }

  const precision = flagged > 0 ? truePositives / flagged : null;
  const recall = evaluated.length > 0 ? truePositives / evaluated.length : 0;
  const f1 =
    precision != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;

  return { threshold, truePositives, falseNegatives, precision, recall, f1, flagged };
}

/**
 * Run the point-in-time evaluation.
 *
 * `snapshotDays` may be sparse; only the days that exist are considered. When
 * `basis` is "factorsOnly", counties whose snapshot predates the base_score
 * column are skipped rather than treated as zero.
 */
export function evaluatePointInTime(
  snapshotDays: SnapshotDay[],
  announcements: Announcement[],
  options: PitOptions = {},
): PitReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const basis = opts.basis;

  const byDate = new Map(snapshotDays.map((d) => [d.date, d]));
  const dates = [...byDate.keys()].sort();

  const evaluated: EvaluatedAnnouncement[] = [];
  const uncovered: UncoveredAnnouncement[] = [];

  for (const a of announcements) {
    const cutoff = announcementCutoff(a.announcedDate);
    const picked = pickSnapshotDate(dates, cutoff, opts.maxLookbackDays);
    if (!picked.date) {
      uncovered.push({ fips: a.fips, announcedDate: a.announcedDate, cutoff, reason: picked.reason! });
      continue;
    }

    const day = byDate.get(picked.date)!;
    // Rank only against counties that have a score on this basis, so a
    // factors-only run isn't diluted by rows predating the base_score column.
    const universe = day.rows
      .map((r) => scoreFor(r, basis))
      .filter((s): s is number => s != null && Number.isFinite(s));

    const self = day.rows.find((r) => r.fips === a.fips);
    const selfScore = self ? scoreFor(self, basis) : null;
    if (selfScore == null || !Number.isFinite(selfScore)) {
      uncovered.push({
        fips: a.fips,
        announcedDate: a.announcedDate,
        cutoff,
        reason: "county_absent_from_snapshot",
      });
      continue;
    }

    evaluated.push({
      fips: a.fips,
      announcedDate: a.announcedDate,
      snapshotDate: picked.date,
      cutoff,
      leadDays: daysBetween(picked.date, cutoff),
      score: selfScore,
      percentile: percentileRank(universe, selfScore),
      rank: rankOf(universe, selfScore),
      universe: universe.length,
    });
  }

  const coverage = announcements.length ? evaluated.length / announcements.length : 0;
  const ready = evaluated.length >= opts.minEvaluable;

  let metrics: PitMetrics | null = null;
  if (evaluated.length > 0) {
    const pcts = evaluated.map((e) => e.percentile);
    const cutoffs = opts.scoreCutoffs.map((t) => {
      const flaggedByDate = new Map<string, number>();
      for (const date of new Set(evaluated.map((e) => e.snapshotDate))) {
        const day = byDate.get(date)!;
        const n = day.rows.filter((r) => {
          const s = scoreFor(r, basis);
          return s != null && s >= t;
        }).length;
        flaggedByDate.set(date, n);
      }
      return metricsAtCutoff(evaluated, flaggedByDate, t);
    });
    metrics = {
      meanPercentile: pcts.reduce((a, b) => a + b, 0) / pcts.length,
      medianPercentile: median(pcts),
      meanLeadDays: evaluated.reduce((a, e) => a + e.leadDays, 0) / evaluated.length,
      cutoffs,
    };
  }

  return {
    basis,
    ready,
    notReady: ready ? null : explainNotReady(evaluated.length, opts.minEvaluable, announcements.length, dates),
    totalAnnouncements: announcements.length,
    evaluated,
    uncovered,
    coverage,
    earliestSnapshot: dates[0] ?? null,
    latestSnapshot: dates[dates.length - 1] ?? null,
    metrics,
  };
}

/** A sentence a person can act on, not a status code. */
export function explainNotReady(
  evaluable: number,
  minEvaluable: number,
  total: number,
  dates: string[],
): string {
  if (dates.length === 0) {
    return "No score history has been recorded yet, so no announcement can be scored as of the day before it happened.";
  }
  if (evaluable === 0) {
    return (
      `Score history begins ${dates[0]}, which is after all ${total} known announcements. ` +
      `None can be scored point-in-time yet. This becomes measurable as new data centers are announced ` +
      `from here forward — each one gets evaluated against the snapshot taken before it.`
    );
  }
  return (
    `Only ${evaluable} of ${total} announcements have a snapshot from before they happened ` +
    `(${minEvaluable} needed for a stable read). History starts ${dates[0]}.`
  );
}
