/**
 * REAL permit ingest — City of Austin (Travis County, TX / FIPS 48453).
 *
 * Replaces the seeded permit rows for Travis County with live commercial
 * construction permits from the City of Austin open-data portal (Socrata SODA
 * API — keyless, JSON). This is the first real site-intel source in GridSense
 * and the template for adding more jurisdictions.
 *
 * Each permit's applicant/description is run through the same operator
 * attribution used for SEC filings, so a permit filed by a known hyperscaler
 * shell LLC is flagged automatically.
 *
 * Source: https://data.austintexas.gov/resource/3syk-w9eu.json
 * Dataset: "Issued Construction Permits" (City of Austin).
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchJson } from "./util.js";
import { attributeFiling, type OperatorDict } from "../edgar-attribution.js";

const TRAVIS_FIPS = "48453";
const SODA = "https://data.austintexas.gov/resource/3syk-w9eu.json";
const DAY = 24 * 3600 * 1000;

interface AustinPermit {
  permit_type_desc?: string;
  permit_class_mapped?: string;
  work_class?: string;
  description?: string;
  permit_location?: string;
  applieddate?: string;
  status_current?: string;
  contractor_company_name?: string;
  contractor_full_name?: string;
  link?: { url?: string };
  permit_number?: string;
}

function loadOperatorDicts(): OperatorDict[] {
  const rows = sqlite
    .prepare("SELECT name, shell_llcs, codenames FROM operators")
    .all() as Array<{ name: string; shell_llcs: string | null; codenames: string | null }>;
  const parse = (s: string | null): string[] => {
    try {
      const v = JSON.parse(s || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  return rows.map((r) => ({ name: r.name, shellLlcs: parse(r.shell_llcs), codenames: parse(r.codenames) }));
}

export async function ingestAustinPermits(): Promise<{ inserted: number; attributed: number }> {
  const run = beginRun("austin_permits", "City of Austin issued construction permits (Travis County, real)");
  try {
    // Recent commercial construction permits, newest first.
    const where = `permit_class_mapped='Commercial' AND applieddate > '2024-01-01'`;
    const url =
      `${SODA}?$where=${encodeURIComponent(where)}` +
      `&$order=applieddate%20DESC&$limit=1000`;
    const rows = await fetchJson<AustinPermit[]>(url, {
      cacheKey: "austin_permits.json",
      maxAgeMs: DAY,
    });
    if (!Array.isArray(rows)) throw new Error("unexpected Socrata response");

    const dicts = loadOperatorDicts();
    const ins = sqlite.prepare(
      `INSERT INTO permits
        (county_fips, permit_type, applicant, resolved_operator, parcel_apn, filed_date, status, megawatts, acres, description, source_url, created_at)
       VALUES (@county_fips, @permit_type, @applicant, @resolved_operator, NULL, @filed_date, @status, NULL, NULL, @description, @source_url, @created_at)`,
    );
    const now = Date.now();

    let inserted = 0;
    let attributed = 0;
    const txn = sqlite.transaction(() => {
      // Clear prior rows for this county (seed or previous run) so Travis becomes
      // a clean real-data showcase and re-runs are idempotent.
      sqlite.prepare("DELETE FROM permits WHERE county_fips = ?").run(TRAVIS_FIPS);
      for (const p of rows) {
        const applicant = p.contractor_company_name || p.contractor_full_name || null;
        const desc = [p.permit_type_desc, p.work_class, p.description, p.permit_location]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 500);
        // Attribute on applicant + description. Permit free-text is noisy, so
        // require multi-word shell/codename matches to avoid a common word like
        // "gable" false-matching a local contractor.
        const attr = attributeFiling(`${applicant ?? ""} ${p.description ?? ""}`, dicts, { multiWordOnly: true });
        if (attr) attributed++;
        ins.run({
          county_fips: TRAVIS_FIPS,
          permit_type: (p.work_class || p.permit_type_desc || "permit").slice(0, 60),
          applicant: applicant?.slice(0, 200) ?? null,
          resolved_operator: attr?.operator ?? null,
          filed_date: p.applieddate ? p.applieddate.slice(0, 10) : null,
          status: (p.status_current || "unknown").slice(0, 40),
          description: desc || null,
          source_url: p.link?.url ?? SODA,
          created_at: now,
        });
        inserted++;
      }
    });
    txn();

    run.complete(inserted, `Travis County: ${inserted} real permits, ${attributed} operator-attributed`);
    return { inserted, attributed };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestAustinPermits()
    .then((r) => { console.log("[austin_permits]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
