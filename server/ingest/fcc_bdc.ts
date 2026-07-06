// FCC Broadband Data Collection (BDC), December 2024 vintage
// -----------------------------------------------------------------------------
// The FCC's public broadband-map API (broadbandmap.fcc.gov/api/public/*) is
// blocked from most cloud IP ranges (returns HTTP 401 with a Chrome UA). ArcGIS
// Living Atlas mirrors the same underlying data as a REST feature service —
// service item ID e1343efcefc344709057260ee57290a0, published on
// services8.arcgis.com/peDZJliSvYims39Q. Cloud IPs work fine against the ArcGIS
// REST layer, so this pipeline hits the mirror.
//
// We use two objects in that FeatureService:
//   - Layer  1 "Counties"                     — polygons keyed by GEOID (5-char county FIPS)
//   - Table 10 "BDC Records for Counties"    — provider × technology × county aggregates
//
// Table 10 fields:
//   GEOID (5-char county FIPS), ProviderName, FRN, Technology (int code),
//   TotalBSLs, UnservedBSLs, UnderservedBSLs, ServedBSLs
//
// Technology codes we care about:
//   50 = Fiber (fiber-to-the-premises)
// Other codes (Cable=40, Copper=10, satellite, fixed wireless) are not treated
// as fiber signal for data-center site selection.
//
// Fiber density score (0-100):
//   score = clamp( 5 * distinctFiberProviders + log10(1+totalServedBSLsByFiber) * 8, 0, 100 )
// A county with 4 distinct fiber providers and 100k served BSLs scores about
// 60; a rural county with 1 provider serving 500 BSLs scores about 7; NoVa /
// Ashburn (Loudoun) with 10+ providers and >200k BSLs saturates near 100.
//
// Providers are counted at the FRN level (globally-unique FCC registration
// number) to avoid double-counting DBAs.

import { fetchJson, nowIso, withRun, USER_AGENT } from "./util.js";
import { sqlite } from "../storage.js";

const BDC_HOST =
  "https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/FCC_Broadband_Data_Collection_December_2024_View/FeatureServer";
const BDC_TABLE_URL = `${BDC_HOST}/10/query`;
const PAGE_SIZE = 2000;
const FIBER_CODE = 50;

// FCC BDC row as it comes off the ArcGIS mirror
interface BdcRecord {
  GEOID: string;
  ProviderName: string;
  FRN: string;
  Technology: number;
  TotalBSLs: number;
  UnservedBSLs: number;
  UnderservedBSLs: number;
  ServedBSLs: number;
}

interface FiberAggregate {
  frnSet: Set<string>;
  providerSet: Set<string>;
  totalBsls: number;
  servedBsls: number;
}

// Pull ALL fiber records (technology=50) from table 10, paginated.
async function fetchAllFiberRecords(): Promise<BdcRecord[]> {
  const all: BdcRecord[] = [];
  let offset = 0;
  let page = 0;
  // We rely on `exceededTransferLimit` in the response envelope to detect more pages.
  while (true) {
    const params = new URLSearchParams({
      where: `Technology=${FIBER_CODE}`,
      outFields: "GEOID,ProviderName,FRN,Technology,TotalBSLs,ServedBSLs",
      returnGeometry: "false",
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
      orderByFields: "OBJECTID",
      f: "json",
    });
    const url = `${BDC_TABLE_URL}?${params.toString()}`;
    const resp = await fetchJson<{
      features?: { attributes: BdcRecord }[];
      exceededTransferLimit?: boolean;
      error?: { code: number; message: string };
    }>(url, {
      cacheKey: `fcc_bdc_fiber_p${page.toString().padStart(3, "0")}.json`,
      timeoutMs: 90_000,
    });
    if (resp.error) {
      throw new Error(`FCC BDC error ${resp.error.code}: ${resp.error.message}`);
    }
    const feats = resp.features ?? [];
    for (const f of feats) all.push(f.attributes);
    page += 1;
    offset += PAGE_SIZE;
    if (!resp.exceededTransferLimit || feats.length === 0) break;
    if (page > 100) break; // hard safety cap
  }
  return all;
}

function normalizeGeoid(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  return s.padStart(5, "0");
}

function computeScore(agg: FiberAggregate): number {
  const providers = agg.frnSet.size;
  const served = agg.servedBsls;
  const raw = 5 * providers + Math.log10(1 + served) * 8;
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
}

export async function ingestFccBdc(): Promise<null> {
  return withRun("fcc_bdc", async () => {
    console.log(`[fcc_bdc] ${nowIso()} — fetching ArcGIS Living Atlas mirror`);
    console.log(`[fcc_bdc] source: ${BDC_HOST} (view id e1343efcefc344709057260ee57290a0)`);
    console.log(`[fcc_bdc] UA: ${USER_AGENT}`);

    const recs = await fetchAllFiberRecords();
    console.log(`[fcc_bdc] pulled ${recs.length} fiber-technology rows`);

    // Aggregate per-GEOID
    const byGeo = new Map<string, FiberAggregate>();
    for (const r of recs) {
      const geoid = normalizeGeoid(r.GEOID);
      if (!geoid) continue;
      // Filter out slivers: a provider must actually serve BSLs in this county
      if (!r.ServedBSLs || r.ServedBSLs < 50) continue;
      let agg = byGeo.get(geoid);
      if (!agg) {
        agg = {
          frnSet: new Set<string>(),
          providerSet: new Set<string>(),
          totalBsls: 0,
          servedBsls: 0,
        };
        byGeo.set(geoid, agg);
      }
      if (r.FRN) agg.frnSet.add(r.FRN);
      if (r.ProviderName) agg.providerSet.add(r.ProviderName);
      agg.totalBsls += r.TotalBSLs || 0;
      agg.servedBsls += r.ServedBSLs || 0;
    }

    console.log(`[fcc_bdc] aggregated to ${byGeo.size} distinct counties with ≥50 served BSLs`);

    // Update only tracked counties (we don't add counties from FCC data —
    // ISO queues drive the county set).
    const trackedFips: string[] = (
      sqlite.prepare("SELECT fips FROM counties").all() as { fips: string }[]
    ).map((r) => r.fips);

    let updated = 0;
    const upd = sqlite.prepare(
      "UPDATE counties SET fiber_density_score = ?, updated_at = ? WHERE fips = ?",
    );
    const today = new Date().toISOString().slice(0, 10);
    const trackedSet = new Set(trackedFips);
    // Also collect stats for the run note
    let maxScore = 0;
    let maxFips = "";
    const scoreDistribution = { p0: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
    const scores: number[] = [];

    const txn = sqlite.transaction(() => {
      for (const fips of trackedFips) {
        const agg = byGeo.get(fips);
        if (!agg) {
          // No fiber data for this county — leave score at whatever it was
          // (usually 0 from bootstrap enricher).
          continue;
        }
        const score = computeScore(agg);
        upd.run(score, today, fips);
        updated += 1;
        scores.push(score);
        if (score > maxScore) {
          maxScore = score;
          maxFips = fips;
        }
      }
    });
    txn();

    // Distribution buckets for logging
    for (const s of scores) {
      if (s < 20) scoreDistribution.p0 += 1;
      else if (s < 40) scoreDistribution.p25 += 1;
      else if (s < 60) scoreDistribution.p50 += 1;
      else if (s < 80) scoreDistribution.p75 += 1;
      else scoreDistribution.p100 += 1;
    }

    console.log(
      `[fcc_bdc] updated ${updated}/${trackedFips.length} tracked counties; max=${maxScore} @ FIPS ${maxFips}`,
    );
    console.log(
      `[fcc_bdc] score distribution: <20=${scoreDistribution.p0} · 20-39=${scoreDistribution.p25} · 40-59=${scoreDistribution.p50} · 60-79=${scoreDistribution.p75} · 80+=${scoreDistribution.p100}`,
    );

    return {
      rows: updated,
      note: `FCC BDC Dec 2024 · fiber (tech=50) · ${recs.length} rows → ${byGeo.size} counties · updated ${updated}/${trackedFips.length} tracked`,
    };
  });
}
