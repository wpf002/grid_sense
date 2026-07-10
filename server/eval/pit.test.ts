import { describe, it, expect } from "vitest";
import {
  announcementCutoff,
  daysBetween,
  pickSnapshotDate,
  percentileRank,
  rankOf,
  metricsAtCutoff,
  evaluatePointInTime,
  type SnapshotDay,
  type Announcement,
} from "./pit";

/** A snapshot day where `target` scores `hi` and everyone else scores `lo`. */
function day(date: string, target: string, hi: number, others = 20, lo = 10): SnapshotDay {
  const rows = [{ fips: target, score: hi, baseScore: hi - 5 }];
  for (let i = 0; i < others; i++) {
    rows.push({ fips: `x${i}`, score: lo, baseScore: lo - 5 });
  }
  return { date, rows };
}

describe("announcementCutoff", () => {
  it("treats a month-precision date as the first of that month", () => {
    // "2024-12" could mean Dec 1. Anything the model knew on Dec 1 is suspect.
    expect(announcementCutoff("2024-12")).toBe("2024-12-01");
  });

  it("passes a full date through", () => {
    expect(announcementCutoff("2024-12-03")).toBe("2024-12-03");
  });

  it("throws rather than silently guessing on garbage", () => {
    expect(() => announcementCutoff("Dec 2024")).toThrow(/Unparseable/);
    expect(() => announcementCutoff("")).toThrow();
  });
});

describe("daysBetween", () => {
  it("counts calendar days in UTC", () => {
    expect(daysBetween("2026-07-01", "2026-07-10")).toBe(9);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });
  it("goes negative when b precedes a", () => {
    expect(daysBetween("2026-07-10", "2026-07-01")).toBe(-9);
  });
  it("is unaffected by a DST boundary", () => {
    // US DST springs forward 2026-03-08. A naive local-time diff gives 0.958 days.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("pickSnapshotDate — the anti-leakage rule", () => {
  const dates = ["2024-01-01", "2024-06-01", "2025-01-01"];

  it("picks the newest snapshot strictly before the cutoff", () => {
    expect(pickSnapshotDate(dates, "2024-12-01", 540).date).toBe("2024-06-01");
  });

  it("NEVER reaches forward past the cutoff, even when a snapshot sits right after", () => {
    // This is the whole point. A snapshot from after the announcement contains
    // the news coverage the announcement generated.
    expect(pickSnapshotDate(["2025-01-01"], "2024-12-01", 540).date).toBeNull();
    expect(pickSnapshotDate(["2025-01-01"], "2024-12-01", 540).reason).toBe("no_snapshot_before_announcement");
  });

  it("excludes a snapshot dated exactly on the cutoff", () => {
    // The announcement may have landed that morning.
    expect(pickSnapshotDate(["2024-12-01"], "2024-12-01", 540).date).toBeNull();
  });

  it("rejects a snapshot older than the lookback window", () => {
    const r = pickSnapshotDate(["2020-01-01"], "2024-12-01", 540);
    expect(r.date).toBeNull();
    expect(r.reason).toBe("snapshot_too_old");
  });

  it("accepts a snapshot exactly at the lookback boundary and rejects one day earlier", () => {
    const cutoff = "2026-07-01";
    const exactly540 = "2025-01-07";
    const oneDayTooOld = "2025-01-06";
    expect(daysBetween(exactly540, cutoff)).toBe(540);
    expect(daysBetween(oneDayTooOld, cutoff)).toBe(541);
    expect(pickSnapshotDate([exactly540], cutoff, 540).date).toBe(exactly540);
    expect(pickSnapshotDate([oneDayTooOld], cutoff, 540).date).toBeNull();
  });
});

describe("percentileRank / rankOf", () => {
  it("scores a top county near 1 and a bottom county at 0", () => {
    expect(percentileRank([10, 20, 30, 40], 40)).toBe(0.75);
    expect(percentileRank([10, 20, 30, 40], 10)).toBe(0);
  });
  it("does not let ties inflate the percentile", () => {
    expect(percentileRank([50, 50, 50, 50], 50)).toBe(0);
  });
  it("ranks 1 for the highest, sharing rank on ties", () => {
    expect(rankOf([10, 20, 30], 30)).toBe(1);
    expect(rankOf([10, 20, 30], 10)).toBe(3);
    expect(rankOf([30, 30, 10], 30)).toBe(1);
  });
  it("survives an empty universe", () => {
    expect(percentileRank([], 50)).toBe(0);
  });
});

describe("metricsAtCutoff", () => {
  const evaluated = [
    { snapshotDate: "2024-06-01", score: 80 },
    { snapshotDate: "2024-06-01", score: 40 },
  ] as any;

  it("computes precision against everything flagged that day", () => {
    // 1 of 2 announcements scored >= 70; 10 counties were flagged >= 70 that day.
    const m = metricsAtCutoff(evaluated, new Map([["2024-06-01", 10]]), 70);
    expect(m.truePositives).toBe(1);
    expect(m.falseNegatives).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.precision).toBe(0.1);
    expect(m.f1).toBeCloseTo((2 * 0.1 * 0.5) / 0.6, 6);
  });

  it("returns null precision rather than dividing by zero when nothing is flagged", () => {
    const m = metricsAtCutoff(evaluated, new Map([["2024-06-01", 0]]), 99);
    expect(m.precision).toBeNull();
    expect(m.f1).toBeNull();
    expect(m.recall).toBe(0);
  });
});

describe("evaluatePointInTime", () => {
  const announcements: Announcement[] = [{ fips: "22083", announcedDate: "2024-12" }];

  it("evaluates an announcement that has a prior snapshot", () => {
    const days = [day("2024-06-01", "22083", 90)];
    const r = evaluatePointInTime(days, announcements, { minEvaluable: 1 });

    expect(r.evaluated).toHaveLength(1);
    expect(r.uncovered).toHaveLength(0);
    expect(r.coverage).toBe(1);
    expect(r.ready).toBe(true);
    expect(r.notReady).toBeNull();

    const e = r.evaluated[0];
    expect(e.snapshotDate).toBe("2024-06-01");
    expect(e.cutoff).toBe("2024-12-01");
    expect(e.leadDays).toBe(183);
    expect(e.rank).toBe(1);
    expect(e.percentile).toBeCloseTo(20 / 21, 6);
    expect(r.metrics!.meanPercentile).toBeCloseTo(20 / 21, 6);
  });

  it("REGRESSION: refuses to score an announcement using a later snapshot", () => {
    // Today's reality: all history postdates every announcement.
    const days = [day("2026-07-06", "22083", 95), day("2026-07-10", "22083", 96)];
    const r = evaluatePointInTime(days, announcements);

    expect(r.evaluated).toHaveLength(0);
    expect(r.coverage).toBe(0);
    expect(r.metrics).toBeNull();
    expect(r.ready).toBe(false);
    expect(r.uncovered[0].reason).toBe("no_snapshot_before_announcement");
    expect(r.notReady).toMatch(/after all 1 known announcements/);
  });

  it("reports not-ready with no history at all", () => {
    const r = evaluatePointInTime([], announcements);
    expect(r.ready).toBe(false);
    expect(r.earliestSnapshot).toBeNull();
    expect(r.notReady).toMatch(/No score history/);
  });

  it("is not ready when evaluable count is below the minimum", () => {
    const days = [day("2024-06-01", "22083", 90)];
    const r = evaluatePointInTime(days, announcements, { minEvaluable: 10 });
    expect(r.evaluated).toHaveLength(1);
    expect(r.ready).toBe(false);
    expect(r.notReady).toMatch(/Only 1 of 1/);
  });

  it("flags a county missing from the snapshot instead of scoring it as zero", () => {
    const days = [{ date: "2024-06-01", rows: [{ fips: "other", score: 50, baseScore: 45 }] }];
    const r = evaluatePointInTime(days, announcements, { minEvaluable: 1 });
    expect(r.evaluated).toHaveLength(0);
    expect(r.uncovered[0].reason).toBe("county_absent_from_snapshot");
  });

  it("ranks on base_score under the factorsOnly basis", () => {
    const days = [day("2024-06-01", "22083", 90)]; // baseScore 85 vs others' 5
    const total = evaluatePointInTime(days, announcements, { minEvaluable: 1, basis: "total" });
    const factors = evaluatePointInTime(days, announcements, { minEvaluable: 1, basis: "factorsOnly" });
    expect(total.evaluated[0].score).toBe(90);
    expect(factors.evaluated[0].score).toBe(85);
    expect(factors.basis).toBe("factorsOnly");
  });

  it("skips rows predating the base_score column rather than treating null as 0", () => {
    const days: SnapshotDay[] = [{
      date: "2024-06-01",
      rows: [
        { fips: "22083", score: 90, baseScore: 85 },
        { fips: "legacy1", score: 80, baseScore: null }, // pre-migration row
        { fips: "legacy2", score: 70, baseScore: null },
      ],
    }];
    const r = evaluatePointInTime(days, announcements, { minEvaluable: 1, basis: "factorsOnly" });
    // Universe is just the one county that has a base score — nulls are excluded,
    // not silently ranked at the bottom, which would fake a perfect percentile.
    expect(r.evaluated[0].universe).toBe(1);
    expect(r.evaluated[0].percentile).toBe(0);
  });

  it("marks an announcement uncovered when its only prior snapshot is stale", () => {
    const days = [day("2020-01-01", "22083", 90)];
    const r = evaluatePointInTime(days, announcements, { maxLookbackDays: 540 });
    expect(r.uncovered[0].reason).toBe("snapshot_too_old");
  });

  it("handles a mix of covered and uncovered announcements", () => {
    const days = [day("2024-06-01", "22083", 90)];
    const mixed: Announcement[] = [
      { fips: "22083", announcedDate: "2024-12" },
      { fips: "22083", announcedDate: "2023-01" }, // predates the snapshot
    ];
    const r = evaluatePointInTime(days, mixed, { minEvaluable: 1 });
    expect(r.evaluated).toHaveLength(1);
    expect(r.uncovered).toHaveLength(1);
    expect(r.coverage).toBe(0.5);
  });
});
