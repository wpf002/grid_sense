// LBNL "Queued Up" interconnection-queue ingest — extends queue coverage past
// the 7 RTOs into non-RTO regions (Southeast / Southern Co, Arizona / APS+SRP,
// the Carolinas / Duke, the Northwest / BPA), which are real data-center markets
// with no public RTO queue.
//
// SOURCE: Lawrence Berkeley National Lab, "Queued Up" (updated annually).
//   https://emp.lbl.gov/queues  ->  "Data File XLSX" link at the bottom.
//
// LBNL's site is JS-rendered and blocks automated download, so this ingest reads
// a LOCALLY-PLACED file. Download the workbook once and either:
//   - drop it at   data/lbnl_queue.xlsx   (default), or
//   - set          LBNL_QUEUE_FILE=/abs/path.xlsx
// If the file isn't present the run is a graceful no-op (not an error).
//
// The parser is column-name agnostic (LBNL renames columns between editions):
// it fuzzy-matches the header row, resolves each project to a county, and only
// adds rows for counties NOT already covered by an RTO queue — so it extends
// coverage without double-counting, and never fans a state across all counties.

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";
import { lookupFips } from "./counties_ref.js";

const DEFAULT_FILE = path.resolve(process.cwd(), "data", "lbnl_queue.xlsx");

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function toAbbr(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] ?? null;
}

// Find the first header cell whose name matches `re`, excluding any that match `not`.
function findCol(header: string[], re: RegExp, not?: RegExp): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (re.test(h) && (!not || !not.test(h))) return i;
  }
  return -1;
}
function findCols(header: string[], re: RegExp, not?: RegExp): number[] {
  const out: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (re.test(header[i]) && (!not || !not.test(header[i]))) out.push(i);
  }
  return out;
}

type Detected = {
  header: string[];
  headerRow: number;
  rows: unknown[][];
  cCounty: number;
  cState: number;
  cMw: number[];
  cStatus: number;
  cType: number;
  cId: number;
  cName: number;
};

// Scan a sheet for the header row (LBNL sheets can have title rows first) and
// map the columns we need. Returns null if the sheet isn't the project dataset.
function detectSheet(ws: XLSX.WorkSheet): Detected | null {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const header = row.map((c) => String(c ?? "").trim());
    const cCounty = findCol(header, /county/i);
    const cState = findCol(header, /state/i, /status|estate/i);
    const cMw = findCols(header, /(^|_)mw\d?$|capacity|nameplate/i);
    const cStatus = findCol(header, /status/i);
    // Require the columns that make county-level scoring possible.
    if (cCounty >= 0 && cState >= 0 && cMw.length > 0) {
      return {
        header,
        headerRow: r,
        rows: grid.slice(r + 1),
        cCounty,
        cState,
        cMw,
        cStatus,
        cType: findCol(header, /type|resource|fuel|technolog/i),
        cId: findCol(header, /queue|q_id|q_no|request/i),
        cName: findCol(header, /project|proj.*name|^name$/i),
      };
    }
  }
  return null;
}

function isActive(status: string): boolean {
  const s = status.toLowerCase();
  if (!s) return true; // unknown -> treat as still queued
  return !/(withdraw|operational|in service|online|suspend|complete)/.test(s);
}

export async function ingestLbnlQueue(): Promise<number> {
  const run = beginRun("lbnl_queue", "LBNL Queued Up — non-RTO interconnection queue");
  try {
    const file = process.env.LBNL_QUEUE_FILE || DEFAULT_FILE;
    if (!fs.existsSync(file)) {
      const msg = `LBNL workbook not found at ${file}. Download the "Data File XLSX" from https://emp.lbl.gov/queues and place it there (or set LBNL_QUEUE_FILE).`;
      console.warn(`[lbnl_queue] ${msg}`);
      run.complete(0, msg);
      return 0;
    }

    const wb = XLSX.readFile(file);
    // Pick the sheet that parses as the project-level dataset with the most rows.
    let best: Detected | null = null;
    for (const name of wb.SheetNames) {
      const d = detectSheet(wb.Sheets[name]);
      if (d && (!best || d.rows.length > best.rows.length)) best = d;
    }
    if (!best) {
      const msg = "No sheet with county+state+MW columns found — LBNL schema may have changed.";
      console.warn(`[lbnl_queue] ${msg}`);
      run.complete(0, msg);
      return 0;
    }
    console.log(`[lbnl_queue] using columns: county="${best.header[best.cCounty]}" state="${best.header[best.cState]}" mw=${best.cMw.map((i) => best.header[i]).join("/")} status="${best.header[best.cStatus] ?? "-"}"`);

    // Counties already covered by an RTO queue — never double-count or overwrite.
    const covered = new Set<string>(
      (sqlite.prepare("SELECT DISTINCT fips FROM raw_iso_queue WHERE fips IS NOT NULL AND iso != 'LBNL'").all() as { fips: string }[]).map((r) => r.fips),
    );

    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'LBNL'").run();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('LBNL', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `);

    let inserted = 0, skippedCovered = 0, unresolved = 0;
    const seen = new Set<string>();
    const insertMany = sqlite.transaction(() => {
      for (const row of best!.rows) {
        if (!Array.isArray(row)) continue;
        const stateAbbr = toAbbr(row[best!.cState]);
        const countyRaw = String(row[best!.cCounty] ?? "").trim();
        if (!stateAbbr || !countyRaw) { unresolved++; continue; }
        const county = countyRaw.replace(/\s+county$/i, "").trim();
        const fips = lookupFips(stateAbbr, county);
        if (!fips) { unresolved++; continue; }
        if (covered.has(fips)) { skippedCovered++; continue; }

        const status = best!.cStatus >= 0 ? String(row[best!.cStatus] ?? "").trim() : "";
        if (!isActive(status)) continue;

        const mw = Math.max(0, ...best!.cMw.map((i) => Number(row[i]) || 0));
        const qno = best!.cId >= 0 ? String(row[best!.cId] ?? "").trim() : "";
        const dedupeKey = `${fips}|${qno}|${mw}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        stmt.run(
          qno || null,
          best!.cName >= 0 ? String(row[best!.cName] ?? "").trim() || null : null,
          stateAbbr,
          county,
          fips,
          mw || null,
          best!.cType >= 0 ? String(row[best!.cType] ?? "").trim() || null : null,
          status || null,
          now,
          "https://emp.lbl.gov/queues",
        );
        inserted++;
      }
    });
    insertMany();

    const note = `${inserted} non-RTO queue rows added (skipped ${skippedCovered} already-RTO-covered, ${unresolved} without a resolvable county)`;
    console.log(`[lbnl_queue] ${note}`);
    run.complete(inserted, note);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestLbnlQueue()
    .then((n) => { console.log("Done:", n); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
