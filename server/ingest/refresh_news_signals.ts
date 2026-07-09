// Lightweight live-news refresh: pull the latest data-center RSS items and turn
// them into signal rows, WITHOUT the heavy overlay/re-score pass in enrich.ts.
//
// This is the piece that keeps the "Latest signals" feed and cluster triggers
// current. It is cheap enough to run on a short schedule (news updates daily),
// unlike the full enrich pass which re-warms EIA/HIFLD/ISO overlays.
//
// Flow: ingestDcNews() (fetch live RSS -> raw_dc_news) then map new raw rows to
// one representative county each (no state fan-out), deduped by (source, county).

import { db } from "../storage.js";
import { counties as countiesTable, rawDcNews, signals as signalsTable } from "@shared/schema";
import { sql } from "drizzle-orm";
import { ingestDcNews } from "./dc_news.js";
import { beginRun } from "./util.js";

function signalTypeFor(category: string): string {
  return category === "opposition" ? "moratorium_change"
    : category === "permit" ? "rezoning"
    : category === "expansion" ? "building_permit"
    : "codename_resolved";
}
function weightFor(category: string): number {
  return category === "opposition" ? 0.7 : category === "permit" ? 1.1 : 0.8;
}

export async function refreshNewsSignals(): Promise<{ fetched: number; signalsAdded: number }> {
  // Record the run so the data-freshness banner reflects the live feed.
  const run = beginRun("dc_news", "live RSS -> signals");
  try {
    return await doRefresh(run);
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

async function doRefresh(run: { complete: (rows: number, note?: string) => void }): Promise<{ fetched: number; signalsAdded: number }> {
  const fetched = await ingestDcNews();

  const allCounties = db.select().from(countiesTable).all();
  const news = db.select().from(rawDcNews).all();
  let signalsAdded = 0;

  for (const n of news) {
    const fipsList: string[] = JSON.parse(n.mentionedCounties || "[]");
    const states: string[] = JSON.parse(n.mentionedStates || "[]");

    // Prefer specific counties. Otherwise attach to ONE representative county per
    // mentioned state (highest landing probability) instead of fanning across
    // every county — fan-out repeats the same story and inflates triggers.
    let attachTo: string[] = fipsList;
    if (attachTo.length === 0 && states.length > 0) {
      attachTo = states
        .map((st) =>
          allCounties
            .filter((c) => c.state === st)
            .sort((a, b) => (b.landingProbability ?? 0) - (a.landingProbability ?? 0))[0]?.fips,
        )
        .filter((f): f is string => Boolean(f));
    }

    for (const fips of attachTo) {
      const existing = db.select({ id: signalsTable.id }).from(signalsTable)
        .where(sql`${signalsTable.sourceUrl} = ${n.link} AND ${signalsTable.countyFips} = ${fips}`)
        .get();
      if (existing) continue;
      const category = n.category ?? "news";
      db.insert(signalsTable).values({
        countyFips: fips,
        signalType: signalTypeFor(category),
        weight: weightFor(category),
        leadTimeMonths: 3,
        headline: n.title.slice(0, 200),
        detail: (n.summary ?? "").slice(0, 400),
        suspectedOperator: null,
        shellLlc: null,
        parcelAcres: null,
        detectedAt: n.publishedAt.split("T")[0],
        sourceUrl: n.link,
        sourceName: n.source,
        confidence: 0.65,
      }).run();
      signalsAdded++;
    }
  }

  run.complete(signalsAdded, `fetched ${fetched.inserted} items, +${signalsAdded} signals`);
  console.log(`[refresh_news_signals] fetched=${fetched.inserted} signalsAdded=${signalsAdded}`);
  return { fetched: fetched.inserted, signalsAdded };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshNewsSignals()
    .then((r) => { console.log("Done:", r); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
