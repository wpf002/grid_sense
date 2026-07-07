/**
 * REAL permit ingest — county/city ArcGIS FeatureServers (complements the
 * Socrata driver). Handles ArcGIS's epoch-millisecond date fields. Config-driven.
 *
 * Includes Fairfax County VA's native DATA CENTER development layer — actual
 * hyperscaler DC projects (e.g. "AVION DATA CENTER (AMAZON)") — the most
 * directly relevant permit source in the product.
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchJson } from "./util.js";
import { attributeFiling, type OperatorDict } from "../edgar-attribution.js";

const DAY = 24 * 3600 * 1000;

interface ArcgisPermitSource {
  key: string;
  fips: string;
  base: string;         // .../FeatureServer/0 or .../MapServer/N
  typeField: string;
  dateField: string;    // epoch ms
  applicantField?: string;
  statusField?: string;
  descField?: string;
  where?: string;       // extra filter (e.g. DATA_CENTER='Yes')
  limit: number;
}

const SOURCES: ArcgisPermitSource[] = [
  { key: "fairfax_dc", fips: "51059", base: "https://www.fairfaxcounty.gov/gispub1/rest/services/LDS/DevelopmentTracker/MapServer/0", typeField: "PROJECT_NAME", dateField: "SUBMITTED_DATE", statusField: "RECORD_STATUS", descField: "PROJECT_NAME", where: "DATA_CENTER='Yes'", limit: 500 },
  { key: "fairfax", fips: "51059", base: "https://www.fairfaxcounty.gov/gispub1/rest/services/LDS/DevelopmentTracker/MapServer/4", typeField: "APPTYPEALIAS", dateField: "ISSUED_DATE", statusField: "RECORD_STATUS", descField: "APPTYPEALIAS", limit: 1000 },
  { key: "nashville", fips: "47037", base: "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0", typeField: "Permit_Type_Description", dateField: "Date_Issued", applicantField: "Contact", descField: "Purpose", where: "Permit_Type_Description LIKE '%Commercial%'", limit: 1000 },
  { key: "wake", fips: "37183", base: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits_Issued_Past_180_Days/FeatureServer/0", typeField: "permittype", dateField: "issueddate", applicantField: "contractorcompanyname", statusField: "statuscurrent", descField: "proposedworkdescription", limit: 1000 },
  { key: "columbus", fips: "39049", base: "https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0", typeField: "B1_PER_TYPE", dateField: "ISSUED_DT", applicantField: "APPLICANT_BUS_NAME", statusField: "PERMIT_STATUS", descField: "B1_PER_SUB_TYPE", limit: 1000 },
  { key: "fulton", fips: "13121", base: "https://services1.arcgis.com/bqfNVPUK3HOnCFmA/arcgis/rest/services/Building_Permits_Issued/FeatureServer/0", typeField: "JobTypeDescription", dateField: "ISSUE_DATE", statusField: "JobStatus", descField: "JobTypeDescription", limit: 1000 },
  { key: "mecklenburg", fips: "37119", base: "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0", typeField: "permittype", dateField: "issuedate", applicantField: "ownname", statusField: "permitstat", descField: "workdesc", limit: 1000 },
  { key: "minneapolis", fips: "27053", base: "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0", typeField: "permitType", dateField: "issueDate", applicantField: "applicantName", statusField: "status", descField: "comments", limit: 1000 },
  { key: "denver", fips: "08031", base: "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_COMMERCIALCONSTPERMIT_P/FeatureServer/317", typeField: "CLASS", dateField: "DATE_ISSUED", applicantField: "CONTRACTOR_NAME", statusField: "STAT_CODE_1", descField: "CLASS", limit: 1000 },
  { key: "fort_worth", fips: "48439", base: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0", typeField: "Permit_Type", dateField: "File_Date", applicantField: "Owner_Full_Name", statusField: "Current_Status", descField: "B1_WORK_DESC", limit: 1000 },
  { key: "portland", fips: "41051", base: "https://www.portlandmaps.com/arcgis/rest/services/Public/BDS_Permit_Commercial_Construction/MapServer/15", typeField: "TYPE", dateField: "ISSUED", statusField: "STATUS", descField: "DESCRIPTION", limit: 1000 },
];

function loadOperatorDicts(): OperatorDict[] {
  const rows = sqlite.prepare("SELECT name, shell_llcs, codenames FROM operators").all() as Array<{
    name: string; shell_llcs: string | null; codenames: string | null;
  }>;
  const parse = (s: string | null): string[] => {
    try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  return rows.map((r) => ({ name: r.name, shellLlcs: parse(r.shell_llcs), codenames: parse(r.codenames) }));
}

function epochToDate(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

export async function ingestArcgisPermits(): Promise<Record<string, number>> {
  const run = beginRun("arcgis_permits", `Real permits (ArcGIS: ${SOURCES.length} sources incl. Fairfax DC layer)`);
  try {
    const dicts = loadOperatorDicts();
    const ins = sqlite.prepare(
      `INSERT INTO permits
        (county_fips, permit_type, applicant, resolved_operator, parcel_apn, filed_date, status, megawatts, acres, description, source_url, created_at)
       VALUES (@fips, @type, @applicant, @op, NULL, @date, @status, NULL, NULL, @desc, @src, @now)`,
    );
    const out: Record<string, number> = {};
    const now = Date.now();
    let attributed = 0;
    // Fairfax has two sources for the same county; clear once.
    const clearedCounties = new Set<string>();
    for (const s of SOURCES) {
      try {
        const fields = [s.typeField, s.dateField, s.applicantField, s.statusField, s.descField].filter(Boolean).join(",");
        const url =
          `${s.base}/query?where=${encodeURIComponent(s.where ?? "1=1")}` +
          `&outFields=${encodeURIComponent(fields)}&returnGeometry=false` +
          `&orderByFields=${encodeURIComponent(`${s.dateField} DESC`)}` +
          `&resultRecordCount=${s.limit}&f=json`;
        let j = await fetchJson<any>(url, { cacheKey: `arcgis_permits_${s.key}.json`, maxAgeMs: DAY });
        if (j?.error) {
          // retry without orderBy
          j = await fetchJson<any>(url.replace(/&orderByFields=[^&]*/, ""), { cacheKey: `arcgis_permits_${s.key}_no.json`, maxAgeMs: DAY });
        }
        const feats = j?.features ?? [];
        const txn = sqlite.transaction(() => {
          if (!clearedCounties.has(s.fips)) {
            sqlite.prepare("DELETE FROM permits WHERE county_fips = ?").run(s.fips);
            clearedCounties.add(s.fips);
          }
          for (const f of feats) {
            const a = f.attributes ?? {};
            const applicant = s.applicantField ? (a[s.applicantField] ?? null) : null;
            const type = String(a[s.typeField] ?? "permit").slice(0, 80);
            const desc = String(a[s.descField ?? s.typeField] ?? "").slice(0, 500) || null;
            const attr = attributeFiling(`${applicant ?? ""} ${desc ?? ""} ${type}`, dicts, { multiWordOnly: true });
            if (attr) attributed++;
            ins.run({
              fips: s.fips, type, applicant: applicant ? String(applicant).slice(0, 200) : null,
              op: attr?.operator ?? null, date: epochToDate(a[s.dateField]),
              status: s.statusField ? String(a[s.statusField] ?? "unknown").slice(0, 40) : "issued",
              desc, src: s.base, now,
            });
          }
        });
        txn();
        out[s.key] = feats.length;
      } catch (e) {
        console.warn(`[arcgis_permits] ${s.key} failed:`, (e as Error).message);
        out[s.key] = 0;
      }
    }
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    run.complete(total, `${total} permits; ${attributed} attributed; ${SOURCES.map((s) => `${s.key}:${out[s.key] ?? 0}`).join(" ")}`);
    return out;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestArcgisPermits()
    .then((r) => { console.log("[arcgis_permits]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
