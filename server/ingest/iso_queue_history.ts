/**
 * ISO queue history — daily snapshot rollup per county × ISO.
 *
 * We can't rebuild history that was never captured, so we bootstrap from the CURRENT
 * raw_iso_queue snapshot (produced by the seven ISO queue pipelines) and record a
 * daily row per (fips, iso, snapshot_date). Over time, the delta between yesterday's
 * and today's snapshot gives us withdrawal_mw, additions_mw, and net_change.
 *
 * Withdrawn status detection is heuristic: statuses containing "withdraw", "cancel",
 * or "termin" (case-insensitive) count as withdrawn. Everything else is active.
 *
 * Idempotent: re-running on the same UTC date is an upsert.
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

const WITHDRAWN_RX = /withdraw|cancel|termin/i;

export async function ingestIsoQueueHistory(): Promise<{ inserted: number }> {
  const run = beginRun("iso_queue_history");
  try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS iso_queue_history (
      fips TEXT NOT NULL,
      iso TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      active_mw REAL NOT NULL DEFAULT 0,
      withdrawn_mw REAL NOT NULL DEFAULT 0,
      active_projects INTEGER NOT NULL DEFAULT 0,
      withdrawn_projects INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (fips, iso, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_iqh_fips ON iso_queue_history(fips);
    CREATE INDEX IF NOT EXISTS idx_iqh_date ON iso_queue_history(snapshot_date);
  `);

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Roll up current raw_iso_queue → per (fips, iso) counts + MW splits.
  const rows = sqlite
    .prepare(
      `SELECT fips, iso, status, mw FROM raw_iso_queue WHERE fips IS NOT NULL AND fips != ''`,
    )
    .all() as Array<{ fips: string; iso: string; status: string | null; mw: number | null }>;

  type Agg = { active_mw: number; withdrawn_mw: number; active_projects: number; withdrawn_projects: number };
  const agg = new Map<string, Agg>();
  for (const r of rows) {
    const key = `${r.fips}||${r.iso}`;
    let a = agg.get(key);
    if (!a) {
      a = { active_mw: 0, withdrawn_mw: 0, active_projects: 0, withdrawn_projects: 0 };
      agg.set(key, a);
    }
    const mw = r.mw ?? 0;
    if (r.status && WITHDRAWN_RX.test(r.status)) {
      a.withdrawn_mw += mw;
      a.withdrawn_projects += 1;
    } else {
      a.active_mw += mw;
      a.active_projects += 1;
    }
  }

  const upsert = sqlite.prepare(`
    INSERT INTO iso_queue_history
      (fips, iso, snapshot_date, active_mw, withdrawn_mw, active_projects, withdrawn_projects, updated_at)
    VALUES (@fips, @iso, @snapshot_date, @active_mw, @withdrawn_mw, @active_projects, @withdrawn_projects, @updated_at)
    ON CONFLICT(fips, iso, snapshot_date) DO UPDATE SET
      active_mw = excluded.active_mw,
      withdrawn_mw = excluded.withdrawn_mw,
      active_projects = excluded.active_projects,
      withdrawn_projects = excluded.withdrawn_projects,
      updated_at = excluded.updated_at
  `);

  let inserted = 0;
  const tx = sqlite.transaction(() => {
    for (const [key, a] of agg.entries()) {
      const [fips, iso] = key.split("||");
      upsert.run({
        fips,
        iso,
        snapshot_date: today,
        active_mw: a.active_mw,
        withdrawn_mw: a.withdrawn_mw,
        active_projects: a.active_projects,
        withdrawn_projects: a.withdrawn_projects,
        updated_at: now,
      });
      inserted++;
    }
  });
  tx();

  run.complete(inserted, `snapshot ${today}: ${agg.size} (fips,iso) pairs`);
  return { inserted };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

export function queueHistoryForCounty(fips: string, days = 90): Array<{
  iso: string;
  snapshot_date: string;
  active_mw: number;
  withdrawn_mw: number;
  active_projects: number;
  withdrawn_projects: number;
}> {
  return sqlite
    .prepare(
      `SELECT iso, snapshot_date, active_mw, withdrawn_mw, active_projects, withdrawn_projects
       FROM iso_queue_history
       WHERE fips = ? AND snapshot_date >= date('now', ?)
       ORDER BY snapshot_date ASC, iso ASC`,
    )
    .all(fips, `-${days} day`) as any;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestIsoQueueHistory().then((r) => {
    console.log(`[iso_queue_history] wrote ${r.inserted} rows`);
    process.exit(0);
  });
}
