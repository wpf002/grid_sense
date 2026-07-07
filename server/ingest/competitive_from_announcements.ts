/**
 * Rebuild competitive_bids from REAL data-center announcements.
 *
 * Replaces the seeded competitive-bid rows (which used fabricated
 * gridsense.internal source URLs) with real operator activity derived from the
 * FIPS-verified dc_announcements set: who is actually building where, at what
 * stage and size, with a real source URL.
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

const STAGE: Record<string, string> = {
  announced: "option",
  under_construction: "under_contract",
  operational: "closed",
};

export async function ingestCompetitiveFromAnnouncements(): Promise<{ inserted: number }> {
  const run = beginRun("competitive_from_announcements", "Competitive activity from real DC announcements");
  try {
    const anns = sqlite.prepare(`
      SELECT fips, operator, status, announced_mw, announced_date, source_url, project_name
      FROM dc_announcements
    `).all() as Array<{
      fips: string; operator: string; status: string; announced_mw: number | null;
      announced_date: string; source_url: string; project_name: string | null;
    }>;

    const ins = sqlite.prepare(`
      INSERT INTO competitive_bids
        (county_fips, operator, stage, megawatts, observed_date, source, source_url, confidence, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 'public announcement', ?, 0.9, ?, ?)
    `);
    const now = Date.now();
    let inserted = 0;
    const txn = sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM competitive_bids").run();
      for (const a of anns) {
        const stage = STAGE[a.status] ?? "option";
        // Normalize month-precision dates (YYYY-MM) to a full date so SQLite
        // date() works in the heat query.
        const obsDate = /^\d{4}-\d{2}$/.test(a.announced_date) ? `${a.announced_date}-01` : a.announced_date;
        const notes = `${a.operator}${a.project_name ? ` (${a.project_name})` : ""} — ${stage}, from public announcement.`;
        ins.run(a.fips, a.operator, stage, a.announced_mw, obsDate, a.source_url, notes, now);
        inserted++;
      }
    });
    txn();
    run.complete(inserted, `${inserted} real competitive rows from announcements`);
    return { inserted };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestCompetitiveFromAnnouncements()
    .then((r) => { console.log("[competitive_from_announcements]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
