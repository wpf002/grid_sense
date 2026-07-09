// Enrichment pass v0.5 — real data now DRIVES the score, not just provenance.
//
// Flow:
//   1. Warm overlay caches (EIA, HIFLD, ISO queue, FEMA NRI).
//   2. For each county, build overlay, recompute score using computeCountyFactorsV5.
//   3. Persist landing_probability + score_tier back to counties table.
//   4. Write provenance rows for every factor with real/partial/synthetic quality.
//   5. Convert DCD news + EDGAR filings into signal rows (unchanged from v0.4).

import { db } from "../storage.js";
import {
  counties as countiesTable,
  rawEdgarFilings, rawDcNews,
  signals as signalsTable, dataProvenance,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { nowIso } from "./util.js";
import { warmOverlayCaches, buildOverlayFor, overlayStats } from "./overlay.js";
import {
  computeCountyFactorsV5,
  computeSignalBoost,
  scoreTierFor,
} from "../scoring.js";

const EIA_URL = "https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip";
const HIFLD_URL =
  "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0";
const NRI_URL =
  "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0";
const PJM_URL =
  "https://www.pjm.com/pjmfiles/media/planning/queues-data/PlanningQueues.xml";
const MISO_URL = "https://www.misoenergy.org/api/giqueue/getprojects";
const ERCOT_URL =
  "https://www.ercot.com/mp/data-products/data-product-details?id=NP3-233-CD";
const SEED_URL =
  "https://www.perplexity.ai/computer/a/gridsense-ai-data-center-land-gbsqPlN.QjaXHqTZLTIJWw";
const FCC_BDC_URL =
  "https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/FCC_Broadband_Data_Collection_December_2024_View/FeatureServer/10";

const SOURCE_URLS: Record<string, { name: string; url: string }> = {
  gridDemandIntent: { name: "PJM + MISO interconnection queues", url: PJM_URL },
  timeToPower: { name: "PJM + MISO queue withdrawal ratio", url: MISO_URL },
  onsiteGeneration: { name: "EIA-860 (2024) generators", url: EIA_URL },
  clusterAdjacency: { name: "HIFLD Electric Power Transmission Lines", url: HIFLD_URL },
  hazardSafety: { name: "FEMA National Risk Index", url: NRI_URL },
  landAvailability: { name: "USDA ERS Rural-Urban Continuum Codes 2023", url: "https://www.ers.usda.gov/data-products/rural-urban-continuum-codes" },
  landAffordability: { name: "USDA NASS Land Values 2025 Summary", url: "https://www.nass.usda.gov/Charts_and_Maps/graphics/farm_value_map.pdf" },
  fiberConnectivity: { name: "FCC BDC (Dec 2024) + PeeringDB IX facilities", url: "https://www.peeringdb.com/api/fac" },
  fiscalIncentives: { name: "State DC tax incentive statutes + Tax Foundation survey", url: "https://taxfoundation.org/data/all/state/state-tax-data-centers/" },
  waterAvailability: { name: "USGS Estimated Water Use 2015", url: "https://doi.org/10.5066/F7TB15V5" },
};

export async function enrichCounties(): Promise<{
  countiesUpdated: number;
  provenanceRows: number;
  newsSignals: number;
  overlayStats: ReturnType<typeof overlayStats>;
}> {
  const fetchedAt = nowIso();
  warmOverlayCaches();
  const stats = overlayStats();
  console.log("[enrich v0.5] Overlay stats:", stats);

  const allCounties = db.select().from(countiesTable).all();
  const allSignals = db.select().from(signalsTable).all();
  console.log("[enrich v0.5] Enriching", allCounties.length, "counties");

  // Clear old provenance rows for factors we're refreshing.
  // Clear ALL prior provenance — enrich is the sole writer and rewrites every
  // factor below. Deleting only a subset let stale rows for carbon/gas/cooling/
  // generation accumulate across runs and double-count on the Data Quality page.
  db.delete(dataProvenance).run();

  let countiesUpdated = 0;
  const provRows: (typeof dataProvenance.$inferInsert)[] = [];

  for (const c of allCounties) {
    const overlay = buildOverlayFor(c.fips);
    const factors = computeCountyFactorsV5(c, overlay);
    const base = factors.reduce((s, f) => s + f.contribution, 0);
    const boost = computeSignalBoost(allSignals.filter(s => s.countyFips === c.fips));
    const landingProbability = Math.round(Math.max(0, Math.min(100, base + boost)));
    const tier = scoreTierFor(landingProbability);
    // Persist the REAL ISO interconnection-queue MW from the overlay back to the
    // display column so the map, KPI, and county tables show actual queue data
    // (1,500+ RTO counties) instead of the sparse seed values. Counties outside
    // any RTO legitimately have no ISO queue -> 0.
    const realQueueMw = Math.round(overlay.queue?.queuedMw ?? 0);
    const realTtp = overlay.queue?.ttpMonths ?? null;
    db.update(countiesTable)
      .set({
        landingProbability,
        scoreTier: tier,
        queuedLoadMw: realQueueMw,
        // Persist the real median time-to-power for display when we have it.
        ...(realTtp != null ? { timeToPowerMonths: realTtp } : {}),
      })
      .where(eq(countiesTable.id, c.id))
      .run();

    // Write provenance for every factor
    for (const f of factors) {
      const src = SOURCE_URLS[f.key] ?? {
        name: "GridSense curated seed (v0.3)",
        url: SEED_URL,
      };
      let note: string | undefined = f.sourceHint;
      if (!note) {
        note =
          f.dataQuality === "synthetic"
            ? "Seed value pending real-data pipeline"
            : `Real value: ${f.value.toFixed(1)}/100`;
      }
      provRows.push({
        fips: c.fips,
        factorKey: f.key,
        quality: f.dataQuality,
        sourceName: src.name,
        sourceUrl: src.url,
        fetchedAt,
        rawValue: JSON.stringify({ value: f.value, contribution: f.contribution }),
        note,
      });
    }

    countiesUpdated++;
  }

  const BATCH = 500;
  for (let i = 0; i < provRows.length; i += BATCH) {
    db.insert(dataProvenance).values(provRows.slice(i, i + BATCH)).run();
  }

  // Turn DCD news items into signals (unchanged from v0.4)
  const news = db.select().from(rawDcNews).all();
  let newsSignals = 0;
  for (const n of news) {
    const fipsList: string[] = JSON.parse(n.mentionedCounties || "[]");
    const states: string[] = JSON.parse(n.mentionedStates || "[]");
    let attachTo: string[] = fipsList;
    if (attachTo.length === 0 && states.length > 0) {
      // State-only news (no resolvable county): attach to a single representative
      // county per mentioned state — the highest landing-probability one — instead
      // of fanning the same story across every county in the state. Fanning it out
      // duplicated one article hundreds of times in the feed and inflated the
      // signal-cluster triggers with state-level noise.
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
      const signalType = n.category === "opposition" ? "moratorium_change"
        : n.category === "permit" ? "rezoning"
        : n.category === "expansion" ? "building_permit"
        : "codename_resolved";
      db.insert(signalsTable).values({
        countyFips: fips,
        signalType,
        weight: n.category === "opposition" ? 0.7 : n.category === "permit" ? 1.1 : 0.8,
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
      newsSignals++;
    }
  }

  // EDGAR filings → signals
  const edgar = db.select().from(rawEdgarFilings).all();
  const hyperscalers: Record<string, string[]> = {
    "Meta Platforms": ["LA", "TX", "IN", "OH", "NM", "OK", "IA", "NE"],
    "Alphabet": ["NE", "IA", "OK", "NV", "OR", "VA", "GA", "SC"],
    "Microsoft": ["WI", "WA", "VA", "IA", "TX", "GA", "AZ", "OH"],
    "Amazon": ["VA", "OR", "OH", "MS", "IN", "PA", "LA"],
  };
  for (const e of edgar) {
    const matchedH = Object.entries(hyperscalers).find(([n]) => e.company.includes(n.split(" ")[0]));
    if (!matchedH) continue;
    const [operator, activeStates] = matchedH;
    // Attach the 8-K to the single most-probable county across the operator's
    // active states (one row per filing), not the first N counties — the old
    // slice(0, 2) kept landing on the same two counties and piled dozens of
    // identical EDGAR signals onto them.
    const target = allCounties
      .filter((c) => activeStates.includes(c.state))
      .sort((a, b) => (b.landingProbability ?? 0) - (a.landingProbability ?? 0))[0];
    if (target) {
      const existing = db.select({ id: signalsTable.id }).from(signalsTable)
        .where(sql`${signalsTable.sourceUrl} = ${e.filingUrl} AND ${signalsTable.countyFips} = ${target.fips}`)
        .get();
      if (!existing) {
        db.insert(signalsTable).values({
          countyFips: target.fips,
          signalType: "codename_resolved",
          weight: 0.9,
          leadTimeMonths: 6,
          headline: `${operator} 8-K referencing "${e.matchedQuery}"`,
          detail: (e.snippet ?? "").slice(0, 400) || `SEC 8-K filing dated ${e.filedDate}.`,
          suspectedOperator: operator,
          shellLlc: null,
          parcelAcres: null,
          detectedAt: e.filedDate,
          sourceUrl: e.filingUrl,
          sourceName: "SEC EDGAR",
          confidence: 0.75,
        }).run();
        newsSignals++;
      }
    }
  }

  console.log("[enrich v0.5] Done. countiesUpdated=", countiesUpdated, "provenanceRows=", provRows.length, "newsSignals=", newsSignals);
  return { countiesUpdated, provenanceRows: provRows.length, newsSignals, overlayStats: stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrichCounties()
    .then((r) => { console.log("Done:", r); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
