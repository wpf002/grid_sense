// Score history snapshotter — writes today's snapshot for every county.
// Enables day-over-day score diffs (Gap 12).

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
        PRIMARY KEY (snapshot_date, fips)
      )
    `).run();
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_fips ON score_history_daily(fips)`).run();
    sqlite.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_date ON score_history_daily(snapshot_date)`).run();

    const today = new Date().toISOString().slice(0, 10);
    const rows = sqlite
      .prepare(
        `SELECT fips, landing_probability AS score, score_tier AS tier,
                queued_load_mw, substation_headroom_mva, time_to_power_months,
                fiber_density_score, hazard_score, water_stress_score, moratorium_status
           FROM counties`,
      )
      .all() as any[];

    const stmt = sqlite.prepare(`
      INSERT INTO score_history_daily
        (snapshot_date, fips, score, tier, queued_load_mw, substation_headroom_mva, time_to_power_months, fiber_density_score, hazard_score, water_stress_score, moratorium_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_date, fips) DO UPDATE SET
        score = excluded.score,
        tier = excluded.tier,
        queued_load_mw = excluded.queued_load_mw,
        substation_headroom_mva = excluded.substation_headroom_mva,
        time_to_power_months = excluded.time_to_power_months,
        fiber_density_score = excluded.fiber_density_score,
        hazard_score = excluded.hazard_score,
        water_stress_score = excluded.water_stress_score,
        moratorium_status = excluded.moratorium_status
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
