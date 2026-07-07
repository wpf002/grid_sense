/**
 * REAL permit ingest — generic Socrata (SODA) driver.
 *
 * Each jurisdiction is a config block (domain + dataset + county FIPS + a field
 * mapper), so adding a new market is data, not code. Replaces seeded permits for
 * the covered counties with live open-data permits, and runs each applicant/
 * description through operator attribution (multi-word only — permit free-text
 * is noisy).
 *
 * Covered today:
 *   - City of Austin  → Travis County, TX (48453)
 *   - City of Chicago → Cook County, IL (17031)
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchJson } from "./util.js";
import { attributeFiling, type OperatorDict } from "../edgar-attribution.js";

const DAY = 24 * 3600 * 1000;

interface MappedPermit {
  permit_type: string;
  applicant: string | null;
  filed_date: string | null;
  status: string;
  description: string | null;
  source_url: string;
  attributionText: string;
}

interface SocrataSource {
  key: string;
  label: string;
  countyFips: string;
  url: string; // full SODA query URL returning JSON
  map: (row: any) => MappedPermit;
}

const clip = (s: unknown, n: number) => (s == null ? null : String(s).slice(0, n));
const date10 = (s: unknown) => (s ? String(s).slice(0, 10) : null);

export const JURISDICTIONS: SocrataSource[] = [
  {
    key: "austin",
    label: "City of Austin (Travis County, TX)",
    countyFips: "48453",
    url:
      "https://data.austintexas.gov/resource/3syk-w9eu.json?" +
      `$where=${encodeURIComponent("permit_class_mapped='Commercial' AND applieddate > '2024-01-01'")}` +
      "&$order=applieddate%20DESC&$limit=1000",
    map: (r) => {
      const applicant = r.contractor_company_name || r.contractor_full_name || null;
      const description = [r.permit_type_desc, r.work_class, r.description, r.permit_location]
        .filter(Boolean).join(" · ");
      return {
        permit_type: (r.work_class || r.permit_type_desc || "permit").slice(0, 60),
        applicant: clip(applicant, 200),
        filed_date: date10(r.applieddate),
        status: (r.status_current || "unknown").slice(0, 40),
        description: clip(description, 500),
        source_url: r.link?.url ?? "https://data.austintexas.gov/resource/3syk-w9eu",
        attributionText: `${applicant ?? ""} ${r.description ?? ""}`,
      };
    },
  },
  {
    key: "chicago",
    label: "City of Chicago (Cook County, IL)",
    countyFips: "17031",
    url:
      "https://data.cityofchicago.org/resource/ydr8-5enu.json?" +
      `$where=${encodeURIComponent("issue_date > '2024-06-01'")}` +
      "&$order=issue_date%20DESC&$limit=1000",
    map: (r) => {
      const applicant = r.contact_1_name || null;
      const addr = [r.street_number, r.street_direction, r.street_name].filter(Boolean).join(" ");
      const description = [r.permit_type, r.work_description, addr].filter(Boolean).join(" · ");
      return {
        permit_type: (r.work_type || r.permit_type || "permit").slice(0, 60),
        applicant: clip(applicant, 200),
        filed_date: date10(r.issue_date || r.application_start_date),
        status: (r.permit_status || "unknown").slice(0, 40),
        description: clip(description, 500),
        source_url: r.permit_
          ? `https://data.cityofchicago.org/resource/ydr8-5enu.json?permit_=${encodeURIComponent(r.permit_)}`
          : "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
        attributionText: `${applicant ?? ""} ${r.work_description ?? ""}`,
      };
    },
  },
];

function loadOperatorDicts(): OperatorDict[] {
  const rows = sqlite.prepare("SELECT name, shell_llcs, codenames FROM operators").all() as Array<{
    name: string; shell_llcs: string | null; codenames: string | null;
  }>;
  const parse = (s: string | null): string[] => {
    try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; }
    catch { return []; }
  };
  return rows.map((r) => ({ name: r.name, shellLlcs: parse(r.shell_llcs), codenames: parse(r.codenames) }));
}

async function ingestOne(src: SocrataSource, dicts: OperatorDict[]): Promise<{ inserted: number; attributed: number }> {
  const rows = await fetchJson<any[]>(src.url, { cacheKey: `socrata_${src.key}.json`, maxAgeMs: DAY });
  if (!Array.isArray(rows)) throw new Error(`${src.key}: unexpected Socrata response`);
  const ins = sqlite.prepare(
    `INSERT INTO permits
      (county_fips, permit_type, applicant, resolved_operator, parcel_apn, filed_date, status, megawatts, acres, description, source_url, created_at)
     VALUES (@county_fips, @permit_type, @applicant, @resolved_operator, NULL, @filed_date, @status, NULL, NULL, @description, @source_url, @created_at)`,
  );
  const now = Date.now();
  let inserted = 0, attributed = 0;
  const txn = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM permits WHERE county_fips = ?").run(src.countyFips);
    for (const raw of rows) {
      const m = src.map(raw);
      const attr = attributeFiling(m.attributionText, dicts, { multiWordOnly: true });
      if (attr) attributed++;
      ins.run({
        county_fips: src.countyFips,
        permit_type: m.permit_type, applicant: m.applicant, resolved_operator: attr?.operator ?? null,
        filed_date: m.filed_date, status: m.status, description: m.description,
        source_url: m.source_url, created_at: now,
      });
      inserted++;
    }
  });
  txn();
  return { inserted, attributed };
}

export async function ingestSocrataPermits(): Promise<Record<string, { inserted: number; attributed: number }>> {
  const run = beginRun("socrata_permits", "Real building permits (Austin + Chicago open data)");
  try {
    const dicts = loadOperatorDicts();
    const out: Record<string, { inserted: number; attributed: number }> = {};
    let total = 0;
    for (const src of JURISDICTIONS) {
      try {
        out[src.key] = await ingestOne(src, dicts);
        total += out[src.key].inserted;
      } catch (e) {
        console.warn(`[socrata_permits] ${src.key} failed:`, (e as Error).message);
        out[src.key] = { inserted: 0, attributed: 0 };
      }
    }
    run.complete(total, JURISDICTIONS.map((j) => `${j.key}:${out[j.key]?.inserted ?? 0}`).join(" "));
    return out;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestSocrataPermits()
    .then((r) => { console.log("[socrata_permits]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
