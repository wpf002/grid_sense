/**
 * REAL parcel ingest — county assessor ArcGIS FeatureServers.
 *
 * Pulls large (DC-relevant, 20-5,000 ac) parcels — APN, acreage, and owner where
 * the county publishes it — for 15 top data-center-market counties, replacing
 * seeded parcels. Where an owner name is present it's run through operator
 * attribution, so a parcel owned by a known hyperscaler shell LLC is flagged.
 * Config-driven: adding a county is one entry.
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchJson } from "./util.js";
import { attributeFiling, type OperatorDict } from "../edgar-attribution.js";

const DAY = 24 * 3600 * 1000;
const MIN_ACRES = 20;
const MAX_ACRES = 5000; // above this = parks / public / water, not a DC site
const CAP = 1200;
const SQFT_PER_ACRE = 43560;

interface ParcelSource {
  key: string;
  fips: string;
  base: string;        // .../FeatureServer/0 or .../MapServer/N
  idField: string;
  acresField: string;  // acreage OR square-feet (see sqft)
  ownerField?: string;
  zoningField?: string;
  sqft?: boolean;      // acresField is square feet (divide by 43560)
  extraWhere?: string; // e.g. COUNTY='DALLAS COUNTY'
  pageSize: number;
}

const SOURCES: ParcelSource[] = [
  { key: "loudoun", fips: "51107", base: "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5", idField: "PA_MCPI", acresField: "PA_LEGAL_ACRE", zoningField: "PA_TYPE", pageSize: 2000 },
  { key: "maricopa", fips: "04013", base: "https://services5.arcgis.com/Y8jwjGUWbRjuqpG5/arcgis/rest/services/Assessor_Parcels_Land_2025/FeatureServer/0", idField: "APN", acresField: "SHAPE_ACRE", pageSize: 2000 },
  { key: "prince_william", fips: "51153", base: "https://gisweb.pwcva.gov/arcgis/rest/services/GTS/Cadastral/MapServer/2", idField: "GPIN", acresField: "Acreage", pageSize: 2000 },
  { key: "bexar", fips: "48029", base: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0", idField: "PropID", acresField: "legal_acre", ownerField: "Owner_Name", pageSize: 2000 },
  { key: "dallas", fips: "48113", base: "https://gis.dallascityhall.com/arcgis/rest/services/Basemap/DallasTaxParcels/FeatureServer/0", idField: "GIS_ACCT", acresField: "AREA_FEET", sqft: true, ownerField: "TAXPANAME1", extraWhere: "COUNTY='DALLAS COUNTY'", pageSize: 2000 },
  { key: "williamson", fips: "48491", base: "https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0", idField: "PARCELID", acresField: "TotAcreDeed", ownerField: "OWNERNME1", pageSize: 2000 },
  { key: "franklin_oh", fips: "39049", base: "https://gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0", idField: "PARCELID", acresField: "STATEDAREA", ownerField: "OWNERNME1", pageSize: 2000 },
  { key: "licking", fips: "39089", base: "https://gis.lickingcounty.gov/server/rest/services/Auditor/Parcels/MapServer/0", idField: "Parcel", acresField: "TaxAcres", ownerField: "OwnerName", pageSize: 2000 },
  { key: "fulton", fips: "13121", base: "https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels_2025/FeatureServer/0", idField: "ParcelID", acresField: "LandAcres", ownerField: "Owner", pageSize: 2000 },
  { key: "mecklenburg", fips: "37119", base: "https://gis.charlottenc.gov/arcgis/rest/services/CLT_Ex/CLTEx_MoreInfo/MapServer/4", idField: "PID", acresField: "Total_Acreage", ownerField: "Owner_LastName", zoningField: "Zoning", pageSize: 1000 },
  { key: "wake", fips: "37183", base: "https://maps.wakegov.com/arcgis/rest/services/Property/Parcels/MapServer/0", idField: "PIN_NUM", acresField: "DEED_ACRES", ownerField: "OWNER", pageSize: 2000 },
  { key: "sarpy", fips: "31153", base: "https://geodata.sarpy.gov/arcgis/rest/services/Cadastral/LandRecordsSearch/MapServer/5", idField: "PARCELID", acresField: "ACREAGE", ownerField: "OWNERNME1", pageSize: 2000 },
  { key: "racine", fips: "55101", base: "https://arcgis.racinecounty.com/arcgis/rest/services/Mapbook/Mapbook/MapServer/0", idField: "PARCELID", acresField: "STATEDAREA", ownerField: "OWNERNME1", zoningField: "ZONING", pageSize: 2000 },
  { key: "elko", fips: "32007", base: "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0", idField: "APN", acresField: "Acres", extraWhere: "County='Elko'", pageSize: 2000 },
  { key: "storey", fips: "32029", base: "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0", idField: "APN", acresField: "Acres", extraWhere: "County='Storey'", pageSize: 2000 },
];

function parcelScore(acres: number): number {
  return Math.max(0, Math.min(100, Math.round(25 + acres * 0.5)));
}

function loadOperatorDicts(): OperatorDict[] {
  const rows = sqlite.prepare("SELECT name, shell_llcs, codenames FROM operators").all() as Array<{
    name: string; shell_llcs: string | null; codenames: string | null;
  }>;
  const parse = (s: string | null): string[] => {
    try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  return rows.map((r) => ({ name: r.name, shellLlcs: parse(r.shell_llcs), codenames: parse(r.codenames) }));
}

interface Row { apn: string; acres: number; zoning: string | null; owner: string | null }

async function fetchParcels(src: ParcelSource): Promise<Row[]> {
  const minVal = src.sqft ? MIN_ACRES * SQFT_PER_ACRE : MIN_ACRES;
  const maxVal = src.sqft ? MAX_ACRES * SQFT_PER_ACRE : MAX_ACRES;
  const fields = [src.idField, src.acresField, src.ownerField, src.zoningField].filter(Boolean).join(",");
  const where = [`${src.acresField}>${minVal}`, src.extraWhere].filter(Boolean).join(" AND ");
  const out: Row[] = [];
  for (let offset = 0; offset < CAP; offset += src.pageSize) {
    const q = (order: boolean) =>
      `${src.base}/query?where=${encodeURIComponent(where)}` +
      `&outFields=${encodeURIComponent(fields)}&returnGeometry=false` +
      (order ? `&orderByFields=${encodeURIComponent(`${src.acresField} DESC`)}` : "") +
      `&resultRecordCount=${src.pageSize}&resultOffset=${offset}&f=json`;
    let j = await fetchJson<any>(q(true), { cacheKey: `arcgis_parcels_${src.key}_${offset}.json`, maxAgeMs: 7 * DAY });
    // Some servers 400 on orderBy/offset combos — retry unordered.
    if (j?.error || !j?.features) {
      j = await fetchJson<any>(q(false), { cacheKey: `arcgis_parcels_${src.key}_${offset}_no.json`, maxAgeMs: 7 * DAY });
    }
    const feats = j?.features ?? [];
    for (const f of feats) {
      const a = f.attributes ?? {};
      let acres = Number(a[src.acresField]);
      if (src.sqft) acres = acres / SQFT_PER_ACRE;
      const apn = a[src.idField];
      if (!apn || !Number.isFinite(acres) || acres < MIN_ACRES || acres > MAX_ACRES) continue;
      out.push({
        apn: String(apn),
        acres: Math.round(acres * 100) / 100,
        zoning: src.zoningField ? (a[src.zoningField] ?? null) : null,
        owner: src.ownerField ? (a[src.ownerField] ?? null) : null,
      });
    }
    if (feats.length < src.pageSize) break;
  }
  return out.slice(0, CAP);
}

export async function ingestArcgisParcels(): Promise<Record<string, number>> {
  const run = beginRun("arcgis_parcels", `Real large parcels (${SOURCES.length} counties)`);
  try {
    const dicts = loadOperatorDicts();
    const ins = sqlite.prepare(
      `INSERT INTO parcels
        (county_fips, apn, acres, owner_name, owner_is_shell_llc, resolved_operator, substation_distance_mi, fiber_distance_mi, zoning, land_price, last_transfer_date, parcel_score, status)
       VALUES (@fips, @apn, @acres, @owner, @isShell, @op, NULL, NULL, @zoning, NULL, NULL, @score, 'available')`,
    );
    const out: Record<string, number> = {};
    let total = 0, attributed = 0;
    for (const src of SOURCES) {
      try {
        const parcels = await fetchParcels(src);
        const txn = sqlite.transaction(() => {
          sqlite.prepare("DELETE FROM parcels WHERE county_fips = ?").run(src.fips);
          for (const p of parcels) {
            const attr = p.owner ? attributeFiling(p.owner, dicts, { multiWordOnly: true }) : null;
            if (attr) attributed++;
            ins.run({
              fips: src.fips, apn: p.apn, acres: p.acres, owner: p.owner,
              isShell: attr ? 1 : 0, op: attr?.operator ?? null,
              zoning: p.zoning, score: parcelScore(p.acres),
            });
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
    run.complete(total, `${total} parcels across ${SOURCES.length} counties, ${attributed} operator-attributed`);
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
