// Score history snapshotter — writes today's snapshot for every county.
// Enables day-over-day score diffs, and is the substrate for the point-in-time
// backtest (server/eval/pit.ts).
//
// base_score and signal_boost are snapshotted ALONGSIDE the final score on
// purpose. A point-in-time backtest has to be able to ask "how did this county
// rank on factors alone, before any news signal touched it?" — and that is
// unrecoverable after the fact if only the combined score was stored. Every day
// we don't record them is a day of history that can never answer that question.

import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

export async function ingestScoreHistory() {
  const run = beginRun("score_history_daily", "snapshot daily county scores");
  try {
    sqlite.prepare(`
      CREATE TABLE IF NOT EXISTS score_history_daily (
        snapshot_date TEXT NOT NULL,
        fips TEXT NOT NULL,
        score REAL NOT NULL,
        tier TEXT,
        queued_load_mw REAL,
        substation_headroom_mva REAL,
        time_to_power_months REAL,
        fiber_density_score REAL,
        hazard_score REAL,
        water_stress_score REAL,
        moratorium_status TEXT,
        base_score REAL,
        signal_boost REAL,
        PRIMARY KEY (snapshot_date, fips)
      )
    `).run();
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_fips ON score_history_daily(fips)`).run();
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_date ON score_history_daily(snapshot_date)`).run();
    // Additive migration for databases created before the leakage-free columns.
    for (const col of ["base_score", "signal_boost"]) {
      try { sqlite.exec(`ALTER TABLE score_history_daily ADD COLUMN ${col} REAL;`); } catch { /* already present */ }
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = sqlite
      .prepare(
        `SELECT fips, landing_probability AS score, score_tier AS tier,
                queued_load_mw, substation_headroom_mva, time_to_power_months,
                fiber_density_score, hazard_score, water_stress_score, moratorium_status,
                base_score, signal_boost
           FROM counties`,
      )
      .all() as any[];

    const stmt = sqlite.prepare(`
      INSERT INTO score_history_daily
        (snapshot_date, fips, score, tier, queued_load_mw, substation_headroom_mva, time_to_power_months, fiber_density_score, hazard_score, water_stress_score, moratorium_status, base_score, signal_boost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_date, fips) DO UPDATE SET
        score = excluded.score,
        tier = excluded.tier,
        queued_load_mw = excluded.queued_load_mw,
        substation_headroom_mva = excluded.substation_headroom_mva,
        time_to_power_months = excluded.time_to_power_months,
        fiber_density_score = excluded.fiber_density_score,
        hazard_score = excluded.hazard_score,
        water_stress_score = excluded.water_stress_score,
        moratorium_status = excluded.moratorium_status,
        base_score = excluded.base_score,
        signal_boost = excluded.signal_boost
    `);

    const tx = sqlite.transaction((items: any[]) => {
      for (const r of items) {
        stmt.run(
          today,
          r.fips,
          r.score ?? 0,
          r.tier ?? null,
          r.queued_load_mw ?? null,
          r.substation_headroom_mva ?? null,
          r.time_to_power_months ?? null,
          r.fiber_density_score ?? null,
          r.hazard_score ?? null,
          r.water_stress_score ?? null,
          r.moratorium_status ?? null,
          r.base_score ?? null,
          r.signal_boost ?? null,
        );
      }
    });
    tx(rows);

    run.complete(rows.length, `snapshotted ${rows.length} counties for ${today}`);

    // After snapshot: evaluate alert rules and dispatch emails.
    try {
      const { dispatchAlerts } = await import("../mailer.js");
      const dispatch = await dispatchAlerts(today);
      console.log(`[score_history] alerts evaluated=${dispatch.evaluated} sent=${dispatch.sent}`);
    } catch (e: any) {
      console.warn(`[score_history] alert dispatch skipped: ${e?.message ?? e}`);
    }

    return { rows: rows.length, today };
  } catch (err: any) {
    run.fail(err);
    throw err;
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestScoreHistory()
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
