// PJM New Services Queue — public XML feed
// Source: https://www.pjm.com/pjmfiles/media/planning/queues-data/PlanningQueues.xml
// Discovered via PJM insidelines beta announcement (Nov 2025).
import { sqlite } from "../storage.js";
import { fetchText, beginRun } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";
import { XMLParser } from "fast-xml-parser";

const URL_PJM =
  "https://www.pjm.com/pjmfiles/media/planning/queues-data/PlanningQueues.xml";

interface PjmProject {
  ProjectNumber: string;
  Name?: string;
  CommercialName?: string;
  State?: string;
  County?: string;
  Status?: string;
  TransmissionOwner?: string;
  MaximumFacilityOutput?: string | number;
  MWEnergy?: string | number;
  MWCapacity?: string | number;
  Fuel?: string;
  ProjectType?: string;
  SubmittedDate?: string;
  ProjectedInServiceDate?: string;
  ActualInServiceDate?: string;
  WithdrawalDate?: string;
}

function parseMw(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDateAny(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Handle formats like "4/1/1997" or ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function ingestPjmQueue(): Promise<number> {
  const run = beginRun("pjm_queue", "PJM New Services Queue");
  try {
    const xml = await fetchText(URL_PJM, {
      cacheKey: "pjm_planning_queues.xml",
      timeoutMs: 120_000,
    });
    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
    });
    const parsed = parser.parse(xml);
    const raw = parsed?.Projects?.Project;
    const projects: PjmProject[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (projects.length === 0) throw new Error("PJM XML parsed 0 projects");

    // Replace previous PJM rows
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'PJM'").run();

    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('PJM', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    let inserted = 0;
    const insertMany = sqlite.transaction((data: PjmProject[]) => {
      for (const p of data) {
        const state = (p.State || "").trim().toUpperCase();
        const county = (p.County || "").trim();
        const fips =
          state && county
            ? lookupFips(state, normalizeCountyName(county))
            : null;
        const mw = parseMw(p.MWEnergy) ?? parseMw(p.MWCapacity) ?? parseMw(p.MaximumFacilityOutput);
        const name = (p.CommercialName || p.Name || "").trim() || null;
        stmt.run(
          String(p.ProjectNumber ?? ""),
          name,
          state || null,
          county || null,
          fips,
          mw,
          (p.Fuel || "").trim() || null,
          (p.Status || "").trim() || null,
          parseDateAny(p.SubmittedDate),
          parseDateAny(p.ProjectedInServiceDate ?? p.ActualInServiceDate),
          now,
          URL_PJM,
        );
        inserted++;
      }
    });
    insertMany(projects);
    run.complete(inserted, `${inserted} PJM queue rows`);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}
