/**
 * REAL parcel ingest — county assessor ArcGIS FeatureServers.
 *
 * Pulls large (DC-relevant) parcels — APN, acreage, zoning/use — for top data-
 * center markets, replacing seeded parcels. Owner name is NOT available in these
 * free geometry layers (counties split owner into paid/separate CAMA tables), so
 * owner_name is left null honestly; a paid parcel source (Regrid) would fill it.
 *
 * Covered: Loudoun County, VA (51107 — Data Center Alley) and Maricopa County,
 * AZ (04013). Config-driven, like the Socrata permit driver.
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchJson } from "./util.js";

const DAY = 24 * 3600 * 1000;
const MIN_ACRES = 20; // DC campuses need scale; ignore small residential lots
const MAX_ACRES = 5000; // above this it's parks / public / water, not a DC site
const CAP = 1500; // top-N largest parcels per county

interface ParcelSource {
  key: string;
  label: string;
  fips: string;
  base: string; // .../MapServer/5 or .../FeatureServer/0
  idField: string;
  acresField: string;
  zoningField?: string;
  pageSize: number;
}

const SOURCES: ParcelSource[] = [
  {
    key: "loudoun",
    label: "Loudoun County, VA",
    fips: "51107",
    base: "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5",
    idField: "PA_MCPI",
    acresField: "PA_LEGAL_ACRE",
    zoningField: "PA_TYPE",
    pageSize: 2000,
  },
  {
    key: "maricopa",
    label: "Maricopa County, AZ",
    fips: "04013",
    base: "https://services5.arcgis.com/Y8jwjGUWbRjuqpG5/arcgis/rest/services/Assessor_Parcels_Land_2025/FeatureServer/0",
    idField: "APN",
    acresField: "SHAPE_ACRE",
    pageSize: 2000,
  },
];

// DC-suitability by size: bigger parcel = better campus candidate (capped).
function parcelScore(acres: number): number {
  return Math.max(0, Math.min(100, Math.round(25 + acres * 0.5)));
}

async function fetchParcels(src: ParcelSource): Promise<Array<{ apn: string; acres: number; zoning: string | null }>> {
  const fields = [src.idField, src.acresField, src.zoningField].filter(Boolean).join(",");
  const out: Array<{ apn: string; acres: number; zoning: string | null }> = [];
  for (let offset = 0; offset < CAP; offset += src.pageSize) {
    const url =
      `${src.base}/query?where=${encodeURIComponent(`${src.acresField}>${MIN_ACRES}`)}` +
      `&outFields=${encodeURIComponent(fields)}&returnGeometry=false` +
      `&orderByFields=${encodeURIComponent(`${src.acresField} DESC`)}` +
      `&resultRecordCount=${src.pageSize}&resultOffset=${offset}&f=json`;
    const j = await fetchJson<any>(url, { cacheKey: `arcgis_parcels_${src.key}_${offset}.json`, maxAgeMs: 7 * DAY });
    const feats = j?.features ?? [];
    for (const f of feats) {
      const a = f.attributes ?? {};
      const acres = Number(a[src.acresField]);
      const apn = a[src.idField];
      if (!apn || !Number.isFinite(acres) || acres > MAX_ACRES) continue;
      out.push({ apn: String(apn), acres, zoning: src.zoningField ? (a[src.zoningField] ?? null) : null });
    }
    if (feats.length < src.pageSize) break; // last page
  }
  return out.slice(0, CAP);
}

export async function ingestArcgisParcels(): Promise<Record<string, number>> {
  const run = beginRun("arcgis_parcels", "Real large parcels (Loudoun VA + Maricopa AZ)");
  try {
    const ins = sqlite.prepare(
      `INSERT INTO parcels
        (county_fips, apn, acres, owner_name, owner_is_shell_llc, resolved_operator, substation_distance_mi, fiber_distance_mi, zoning, land_price, last_transfer_date, parcel_score, status)
       VALUES (@fips, @apn, @acres, NULL, 0, NULL, NULL, NULL, @zoning, NULL, NULL, @score, 'available')`,
    );
    const out: Record<string, number> = {};
    let total = 0;
    for (const src of SOURCES) {
      try {
        const parcels = await fetchParcels(src);
        const txn = sqlite.transaction(() => {
          sqlite.prepare("DELETE FROM parcels WHERE county_fips = ?").run(src.fips);
          for (const p of parcels) {
            ins.run({ fips: src.fips, apn: p.apn, acres: p.acres, zoning: p.zoning, score: parcelScore(p.acres) });
          }
        });
        txn();
        out[src.key] = parcels.length;
        total += parcels.length;
      } catch (e) {
        console.warn(`[arcgis_parcels] ${src.key} failed:`, (e as Error).message);
        out[src.key] = 0;
      }
    }
    run.complete(total, SOURCES.map((s) => `${s.key}:${out[s.key] ?? 0}`).join(" "));
    return out;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestArcgisParcels()
    .then((r) => { console.log("[arcgis_parcels]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
