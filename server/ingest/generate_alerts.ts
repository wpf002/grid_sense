/**
 * Generate alerts from real day-over-day score movement.
 *
 * The product promises "alerting for material changes." This turns the daily
 * score-history diff into concrete alerts: tier crossings and large score jumps.
 * System alerts use subscription_id = 0 (not tied to a user subscription).
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

const SYSTEM_SUB = 0;
const BIG_DELTA = 10; // absolute score points worth flagging without a tier change

const TIER_RANK: Record<string, number> = { cold: 0, emerging: 1, warm: 2, hot: 3 };

export async function generateAlerts(): Promise<{ inserted: number }> {
  const run = beginRun("generate_alerts", "Alerts from day-over-day tier/score changes");
  try {
    const dates = sqlite
      .prepare("SELECT DISTINCT snapshot_date d FROM score_history_daily ORDER BY d DESC LIMIT 2")
      .all() as { d: string }[];
    if (dates.length < 2) {
      run.complete(0, "need >=2 daily snapshots");
      return { inserted: 0 };
    }
    const [today, yesterday] = [dates[0].d, dates[1].d];
    const rows = sqlite.prepare(`
      SELECT t.fips, c.name, c.state, t.tier AS tier_now, y.tier AS tier_prev,
             ROUND(t.score - y.score) AS delta
        FROM score_history_daily t
        JOIN score_history_daily y ON y.fips = t.fips AND y.snapshot_date = ?
        JOIN counties c ON c.fips = t.fips
       WHERE t.snapshot_date = ?
    `).all(yesterday, today) as Array<{
      fips: string; name: string; state: string; tier_now: string; tier_prev: string; delta: number;
    }>;

    const ins = sqlite.prepare(
      `INSERT INTO alerts (subscription_id, county_fips, fired_at, title, detail, severity, acknowledged)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    );
    const now = new Date().toISOString();
    let inserted = 0;
    const txn = sqlite.transaction(() => {
      // Idempotent: clear previously-generated system alerts.
      sqlite.prepare("DELETE FROM alerts WHERE subscription_id = ?").run(SYSTEM_SUB);
      for (const r of rows) {
        const tierChanged = r.tier_now !== r.tier_prev;
        if (!tierChanged && Math.abs(r.delta) < BIG_DELTA) continue;
        const up = (TIER_RANK[r.tier_now] ?? 0) >= (TIER_RANK[r.tier_prev] ?? 0);
        let title: string, severity: string;
        if (tierChanged) {
          title = `${r.name}, ${r.state}: ${r.tier_prev} → ${r.tier_now}`;
          severity = r.tier_now === "hot" ? "critical" : up ? "warning" : "info";
        } else {
          title = `${r.name}, ${r.state}: score ${r.delta > 0 ? "+" : ""}${r.delta}`;
          severity = "info";
        }
        const detail = `Landing-probability ${r.delta > 0 ? "rose" : "fell"} ${Math.abs(r.delta)} pts day-over-day (${yesterday} → ${today}).`;
        ins.run(SYSTEM_SUB, r.fips, now, title, detail, severity);
        inserted++;
      }
    });
    txn();
    run.complete(inserted, `${inserted} alerts from ${yesterday}→${today}`);
    return { inserted };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateAlerts()
    .then((r) => { console.log("[generate_alerts]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
