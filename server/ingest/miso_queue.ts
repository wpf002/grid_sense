// MISO Generator Interconnection Queue — JSON API
// Source: https://www.misoenergy.org/api/giqueue/getprojects
// Note: MISO records don't always include county — we tag by state only where county is blank.
import { sqlite } from "../storage.js";
import { fetchJson, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_MISO = "https://www.misoenergy.org/api/giqueue/getprojects";

interface MisoProject {
  id: number;
  projectNumber: string;
  queueDate: string | null;
  inService: string | null;
  transmissionOwner: string | null;
  county: string;
  state: string;
  studyCycle: string;
  studyGroup: string;
  studyPhase: string;
  svcType: string;
  summerNetMW: number | null;
  winterNetMW: number | null;
  fuelType: string;
  applicationStatus: string;
}

export async function ingestMisoQueue(): Promise<number> {
  const run = beginRun("miso_queue", "MISO Generator Interconnection Queue");
  try {
    const rows = await fetchJson<MisoProject[]>(URL_MISO, {
      cacheKey: "miso_giqueue.json",
    });
    if (!Array.isArray(rows)) throw new Error("MISO API returned non-array");
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('MISO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Clear previous MISO rows so replacement is atomic
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'MISO'").run();
    let inserted = 0;
    const insertMany = sqlite.transaction((data: MisoProject[]) => {
      for (const p of data) {
        const stAbbr = (p.state || "").trim().toUpperCase();
        const stateFipsPrefix = STATE_FIPS[stAbbr];
        let fips: string | null = null;
        if (stateFipsPrefix && p.county) {
          fips = lookupFips(stAbbr, normalizeCountyName(p.county));
        }
        const mw = p.summerNetMW ?? p.winterNetMW ?? null;
        stmt.run(
          p.projectNumber,
          `${p.projectNumber} ${p.transmissionOwner ?? ""}`.trim(),
          stAbbr,
          p.county || null,
          fips,
          mw,
          p.fuelType || null,
          p.applicationStatus || null,
          p.queueDate,
          p.inService,
          now,
          URL_MISO,
        );
        inserted++;
      }
    });
    insertMany(rows);
    run.complete(inserted, `${inserted} MISO queue rows`);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}
