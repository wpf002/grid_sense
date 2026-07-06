// FEMA National Risk Index — county-level hazard scores via ArcGIS FeatureServer
// Source: https://fema.maps.arcgis.com item 39485e8035d446a5bff03259508ae355
import { sqlite } from "../storage.js";
import { fetchJson, beginRun } from "./util.js";

export const NRI_URL =
  "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0";
const OUT_FIELDS =
  "STCOFIPS,COUNTY,STATE,RISK_SCORE,RISK_RATNG,EAL_SCORE,EAL_RATNG";

export interface NriRow {
  fips: string;
  county: string;
  state: string;
  riskScore: number | null;
  riskRating: string | null;
  ealScore: number | null;
  ealRating: string | null;
  fetchedAt: number;
}

export async function ingestFemaNri(): Promise<number> {
  const run = beginRun("fema_nri", "FEMA National Risk Index counties");
  try {
    const allRows: any[] = [];
    let offset = 0;
    const pageSize = 2000;
    for (let i = 0; i < 5; i++) {
      const url =
        `${NRI_URL}/query?where=1%3D1&outFields=${OUT_FIELDS}` +
        `&returnGeometry=false&resultRecordCount=${pageSize}&resultOffset=${offset}&f=json`;
      const page = await fetchJson<any>(url, {
        cacheKey: `nri_counties_${offset}.json`,
      });
      const feats = Array.isArray(page.features) ? page.features : [];
      allRows.push(...feats);
      if (!page.exceededTransferLimit || feats.length === 0) break;
      offset += pageSize;
    }
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO raw_fema_nri (fips, county, state, riskScore, riskRating, ealScore, ealRating, fetchedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    let inserted = 0;
    const insertMany = sqlite.transaction((rows: any[]) => {
      for (const r of rows) {
        const a = r.attributes || {};
        if (!a.STCOFIPS) continue;
        stmt.run(
          a.STCOFIPS,
          a.COUNTY ?? "",
          a.STATE ?? "",
          a.RISK_SCORE ?? null,
          a.RISK_RATNG ?? null,
          a.EAL_SCORE ?? null,
          a.EAL_RATNG ?? null,
          now,
        );
        inserted++;
      }
    });
    insertMany(allRows);
    run.complete(inserted, `${inserted} counties from FEMA ArcGIS`);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

export function getNriByFips(fips: string): NriRow | null {
  const row = sqlite
    .prepare(
      `SELECT fips, county, state, riskScore, riskRating, ealScore, ealRating, fetchedAt
       FROM raw_fema_nri WHERE fips = ?`,
    )
    .get(fips) as NriRow | undefined;
  return row ?? null;
}

export function nriStats(): { rows: number; lastFetch: number | null } {
  const r = sqlite
    .prepare(
      `SELECT COUNT(*) as c, MAX(fetchedAt) as t FROM raw_fema_nri`,
    )
    .get() as { c: number; t: number | null };
  return { rows: r.c, lastFetch: r.t };
}
