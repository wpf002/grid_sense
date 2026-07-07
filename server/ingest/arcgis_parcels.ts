/**
 * REAL parcel ingest — county assessor ArcGIS FeatureServers.
 *
 * Pulls large (DC-relevant, 20-5,000 ac) parcels — APN, acreage, and owner where
 * the county publishes it — for ~45 data-center-market counties, replacing
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
// Divisor to convert an area field to acres.
const AREA_DIV: Record<string, number> = { sqft: 43560, sqm: 4046.86 };

interface ParcelSource {
  key: string;
  fips: string;
  base: string;        // .../FeatureServer/0 or .../MapServer/N
  idField: string;
  acresField: string;  // acreage OR square-feet (see sqft)
  ownerField?: string;
  zoningField?: string;
  areaUnit?: "sqft" | "sqm"; // acresField is an area, not acres
  extraWhere?: string; // e.g. COUNTY='DALLAS COUNTY'
  pageSize: number;
}

const SOURCES: ParcelSource[] = [
  { key: "loudoun", fips: "51107", base: "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5", idField: "PA_MCPI", acresField: "PA_LEGAL_ACRE", zoningField: "PA_TYPE", pageSize: 2000 },
  { key: "maricopa", fips: "04013", base: "https://services5.arcgis.com/Y8jwjGUWbRjuqpG5/arcgis/rest/services/Assessor_Parcels_Land_2025/FeatureServer/0", idField: "APN", acresField: "SHAPE_ACRE", pageSize: 2000 },
  { key: "prince_william", fips: "51153", base: "https://gisweb.pwcva.gov/arcgis/rest/services/GTS/Cadastral/MapServer/2", idField: "GPIN", acresField: "Acreage", pageSize: 2000 },
  { key: "bexar", fips: "48029", base: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0", idField: "PropID", acresField: "legal_acre", ownerField: "Owner_Name", pageSize: 2000 },
  { key: "dallas", fips: "48113", base: "https://gis.dallascityhall.com/arcgis/rest/services/Basemap/DallasTaxParcels/FeatureServer/0", idField: "GIS_ACCT", acresField: "AREA_FEET", areaUnit: "sqft", ownerField: "TAXPANAME1", extraWhere: "COUNTY='DALLAS COUNTY'", pageSize: 2000 },
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
  // TX appraisal districts (Hood/Hunt/Kaufman share a schema)
  { key: "hood", fips: "48221", base: "https://services.arcgis.com/n4964dyKb7h58xBo/arcgis/rest/services/HoodCADWebService/FeatureServer/0", idField: "prop_id", acresField: "legal_acreage", ownerField: "file_as_name", pageSize: 2000 },
  { key: "ellis", fips: "48139", base: "https://services7.arcgis.com/URKkSE6MsjA926qB/arcgis/rest/services/Ellis_County_Parcel_Ownership/FeatureServer/0", idField: "pid", acresField: "legalacre", ownerField: "fileasname", pageSize: 2000 },
  { key: "hunt", fips: "48231", base: "https://services3.arcgis.com/GIIiqmeq0npieHV9/arcgis/rest/services/HuntCADWebService/FeatureServer/0", idField: "prop_id", acresField: "legal_acreage", ownerField: "file_as_name", pageSize: 2000 },
  { key: "kaufman", fips: "48257", base: "https://services9.arcgis.com/26s7bQ5Q51Gt4J2Q/arcgis/rest/services/KaufmanCADWebService/FeatureServer/0", idField: "prop_id", acresField: "legal_acreage", ownerField: "file_as_name", pageSize: 2000 },
  { key: "tarrant", fips: "48439", base: "https://tad.newedgeservices.com/arcgis/rest/services/OD_TAD/OD_Parcels/MapServer/0", idField: "TAXPIN", acresField: "CALCULATED_ACREAGE", pageSize: 2000 },
  { key: "denton", fips: "48121", base: "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels_FC/MapServer/0", idField: "pid", acresField: "legalAcreage", ownerField: "name", zoningField: "cad_zoning", pageSize: 2000 },
  // UT LIR (per-county) + WY + ID
  { key: "weber", fips: "49057", base: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Weber_LIR/FeatureServer/0", idField: "PARCEL_ID", acresField: "PARCEL_ACRES", pageSize: 2000 },
  { key: "tooele", fips: "49045", base: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Tooele_LIR/FeatureServer/0", idField: "PARCEL_ID", acresField: "PARCEL_ACRES", pageSize: 2000 },
  { key: "utah_co", fips: "49049", base: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Utah_LIR/FeatureServer/0", idField: "PARCEL_ID", acresField: "PARCEL_ACRES", pageSize: 2000 },
  { key: "laramie", fips: "56021", base: "https://maps.laramiecounty.com/arcgis/rest/services/features/CountyBaseMapFeatures/MapServer/2", idField: "statepidn", acresField: "netacres", ownerField: "name1", pageSize: 2000 },
  { key: "ada", fips: "16001", base: "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services/Parcels/FeatureServer/5", idField: "PARCEL", acresField: "ACRES", zoningField: "ZONING", pageSize: 2000 },
  // OH (Franklin fixed: STATEDAREA not ACRES; + Delaware, Union)
  { key: "franklin_oh2", fips: "39049", base: "https://gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0", idField: "PARCELID", acresField: "STATEDAREA", ownerField: "OWNERNME1", pageSize: 2000 },
  { key: "delaware_oh", fips: "39041", base: "https://services2.arcgis.com/ziXVKVy3BiopMCCU/arcgis/rest/services/Parcel/FeatureServer/0", idField: "OBJECTID", acresField: "ACRES", ownerField: "OWNER1", pageSize: 2000 },
  { key: "union_oh", fips: "39159", base: "https://www7.co.union.oh.us/unioncountyohio/rest/services/parcel/MapServer/0", idField: "GISNO", acresField: "Acreage", ownerField: "Owner", pageSize: 2000 },
  // VA (Northern Virginia + exurbs)
  { key: "fairfax", fips: "51059", base: "https://services1.arcgis.com/ioennV6PpG5Xodq0/arcgis/rest/services/Parcels/FeatureServer/0", idField: "PIN", acresField: "Shape__Area", areaUnit: "sqm", pageSize: 2000 },
  { key: "fauquier", fips: "51061", base: "https://services.arcgis.com/oAoeYJ1kqmAwcEC2/arcgis/rest/services/PropertyLines_Hosted/FeatureServer/0", idField: "PARCELID", acresField: "ACREAGED", ownerField: "OWNERNME1", zoningField: "CNTZONECD", pageSize: 2000 },
  { key: "henrico", fips: "51087", base: "https://services.arcgis.com/LxWK4CxNTBBlLshT/arcgis/rest/services/Henrico_County_Tax_Parcels_0322/FeatureServer/0", idField: "GPIN", acresField: "PARCEL_ACREAGE", ownerField: "OWNER_CURRENT", pageSize: 2000 },
  { key: "chesterfield", fips: "51041", base: "https://services3.arcgis.com/TsynfzBSE6sXfoLq/arcgis/rest/services/Cadastral/FeatureServer/3", idField: "GPIN", acresField: "DeededAcres", ownerField: "OwnerName", pageSize: 2000 },
  { key: "spotsylvania", fips: "51177", base: "https://services1.arcgis.com/Fs0uoy8dWAYsVfXh/arcgis/rest/services/County_Parcels_WFL1/FeatureServer/0", idField: "GPIN", acresField: "Shape__Area", areaUnit: "sqft", ownerField: "FULLNAME", zoningField: "Zoning", pageSize: 2000 },
  { key: "culpeper", fips: "51047", base: "https://services1.arcgis.com/umAze4B28rywBpwB/arcgis/rest/services/TownParcelsData_GeneralView/FeatureServer/11", idField: "PIN", acresField: "AREA_Acres", ownerField: "Owner_Full_Name", zoningField: "ZONE", pageSize: 2000 },
  // OR (data-center corridor)
  { key: "umatilla", fips: "41059", base: "https://services3.arcgis.com/tNPgIZWOB0Efvm0g/arcgis/rest/services/Tax_Lots/FeatureServer/0", idField: "TLID", acresField: "SUM_OF_ACR", ownerField: "MAILING_NA", pageSize: 2000 },
  { key: "morrow", fips: "41049", base: "https://services6.arcgis.com/xEHq4N54Na2L3oyh/arcgis/rest/services/Columbia_River_Tax_Lots/FeatureServer/6", idField: "MapTaxlot", acresField: "ACRES", ownerField: "OWNER1", zoningField: "PLAN_ZONE", pageSize: 2000 },
  { key: "crook", fips: "41013", base: "https://gis.crookcountyor.gov/server/rest/services/OpenData/TaxlotandTables/MapServer/0", idField: "MapTaxlot", acresField: "TaxlotAcre", pageSize: 2000 },
  // IL + WI
  { key: "cook_il", fips: "17031", base: "https://gis.cookcountyil.gov/traditional/rest/services/cookVwrDynmc/MapServer/44", idField: "PIN14", acresField: "LandSqft", areaUnit: "sqft", pageSize: 2000 },
  { key: "kane", fips: "17089", base: "https://services1.arcgis.com/oRKmdBXD6EbdmVgJ/arcgis/rest/services/Kane_Parcels/FeatureServer/0", idField: "PIN", acresField: "Shape__Area", areaUnit: "sqft", ownerField: "TaxName", zoningField: "UseCode", pageSize: 2000 },
  { key: "dekalb_il", fips: "17037", base: "https://services7.arcgis.com/hEXJrPwm89CLXBYe/arcgis/rest/services/DeKalbIL_Parcels/FeatureServer/0", idField: "Parcel_Number", acresField: "gross_current_acres", ownerField: "Owner", zoningField: "Zone_Code", pageSize: 2000 },
  { key: "racine2", fips: "55101", base: "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0", idField: "PARCELID", acresField: "GISACRES", ownerField: "OWNERNME1", extraWhere: "CONAME='RACINE'", pageSize: 2000 },
  { key: "dane", fips: "55025", base: "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0", idField: "PARCELID", acresField: "DEEDACRES", ownerField: "OWNERNME1", extraWhere: "CONAME='DANE'", pageSize: 2000 },
  // GA (Atlanta exurbs)
  { key: "coweta", fips: "13077", base: "https://coweta-gis-web.coweta.ga.us/arcgis/rest/services/Hosted/ParcelPropertyValues/FeatureServer/0", idField: "parcel_id", acresField: "acres", ownerField: "ownername", pageSize: 2000 },
  { key: "walton_ga", fips: "13297", base: "https://services1.arcgis.com/TaXHPwWfIMuzJ7Ov/arcgis/rest/services/WaltonCountyPropeties/FeatureServer/3", idField: "PARCELNO", acresField: "GIS_ACRES", ownerField: "OWNER_NAME", pageSize: 2000 },
  { key: "bartow", fips: "13015", base: "https://www.bartowgis.org/arcgis/rest/services/AGOServices/BartowLand/FeatureServer/2", idField: "PARCELID", acresField: "TOTALACRES", ownerField: "Owner1", pageSize: 2000 },
  // TN + MS
  { key: "montgomery_tn", fips: "47125", base: "https://apnsgis4.apsu.edu/arcgis/rest/services/CMCGIS/Parcels/MapServer/0", idField: "parcelid", acresField: "calcacreage", ownerField: "owner", zoningField: "zoning", pageSize: 2000 },
  { key: "madison_ms", fips: "28089", base: "https://services7.arcgis.com/deoj2Y8l1tBr7P5X/arcgis/rest/services/Madison_Service/FeatureServer/5", idField: "PARCEL_ID", acresField: "TOTAL_AC", ownerField: "OWNERNAME", pageSize: 2000 },
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
  const div = src.areaUnit ? AREA_DIV[src.areaUnit] : 1;
  const minVal = MIN_ACRES * div;
  const maxVal = MAX_ACRES * div;
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
