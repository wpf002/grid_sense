// CAISO Generator Interconnection Queue — Public Queue Report XLSX
// Source page: https://www.caiso.com/library/interconnection-queue-reports
// Direct XLSX: https://www.caiso.com/documents/publicqueuereport.xlsx
//
// Workbook has three sheets. We ingest only "Grid GenerationQueue" (ACTIVE):
//   - Row 3 is the header
//   - Data starts at row 4
//
// Header columns (row 3):
//   0  Project Name
//   1  Queue Position                    (queue_no)
//   2  Interconnection Request Receive Date (Excel serial → submitted_date)
//   3  Queue Date
//   4  Application Status                (status)
//   5  Study Process
//   6  Type-1
//   7  Type-2
//   8  Type-3
//   9  Fuel-1                            (fuel_type)
//  10  Fuel-2
//  11  Fuel-3
//  12  MW-1
//  13  MW-2
//  14  MW-3
//  15  Net MWs to Grid                   (mw)
//  16  Full Capacity, Partial or Energy Only (FC/P/EO)
//  17  TPD Allocation Percentage
//  18  Off-Peak Deliverability and Economic Only
//  19  TPD Allocation Group
//  20  County                            (county, all caps e.g. "SOLANO")
//  21  State                             ("CA" always)
//  22  Utility
//  23  PTO Study Region
//  24  Station or Transmission Line
//  25  Proposed On-line Date (Excel serial)
//  26  Current On-line Date  (Excel serial → expected_in_service)
//
// Nearly every project is in California (state FIPS "06"). A handful of
// out-of-state projects (NV, AZ) do appear — we honor whatever state the
// sheet reports rather than force CA.

import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { fetchBuffer, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_CAISO = "https://www.caiso.com/documents/publicqueuereport.xlsx";

const COL = {
  NAME: 0,
  QUEUE_POS: 1,
  RECEIVE_DATE: 2,
  APP_STATUS: 4,
  TYPE_1: 6,
  FUEL_1: 9,
  NET_MW: 15,
  COUNTY: 20,
  STATE: 21,
  UTILITY: 22,
  CURRENT_ONLINE: 26,
};

function excelSerialToIso(n: unknown): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** CAISO county cells are ALL CAPS. Convert to title case for our lookup table. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function ingestCaisoQueue(): Promise<number> {
  const run = beginRun("caiso_queue", "CAISO Generator Interconnection Queue (Active)");
  try {
    const buf = await fetchBuffer(URL_CAISO, { cacheKey: "caiso_public_queue.xlsx" });
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = "Grid GenerationQueue";
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    if (rows.length < 5) throw new Error("CAISO sheet has fewer than 5 rows");

    // Validate header row 3
    const header = rows[3];
    if (!Array.isArray(header) || header[0] !== "Project Name" || header[20] !== "County") {
      throw new Error(
        `CAISO header mismatch — expected 'Project Name' col 0 + 'County' col 20; got '${(header as any)?.[0]}' / '${(header as any)?.[20]}'`,
      );
    }

    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'CAISO'").run();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('CAISO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const insertMany = sqlite.transaction(() => {
      for (let i = 4; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !Array.isArray(r)) continue;
        const nameCell = r[COL.NAME];
        if (!nameCell || typeof nameCell !== "string" || !nameCell.trim()) continue;
        const name = nameCell.trim();

        const queuePosCell = r[COL.QUEUE_POS];
        const queueNo =
          queuePosCell === null || queuePosCell === undefined ? "" : String(queuePosCell).trim();
        if (!queueNo) continue;

        const stateRaw = r[COL.STATE];
        const state = typeof stateRaw === "string" ? stateRaw.trim().toUpperCase() : "CA";
        if (!STATE_FIPS[state]) continue;

        const countyRaw = r[COL.COUNTY];
        const county =
          typeof countyRaw === "string" && countyRaw.trim()
            ? titleCase(countyRaw.trim())
            : null;
        const fips = county ? lookupFips(state, normalizeCountyName(county)) : null;

        const mwRaw = r[COL.NET_MW];
        const mw = typeof mwRaw === "number" ? mwRaw : null;

        const fuel = r[COL.FUEL_1];
        const type1 = r[COL.TYPE_1];
        const fuelType =
          typeof fuel === "string" && fuel.trim()
            ? typeof type1 === "string" && type1.trim() && type1.trim() !== fuel.trim()
              ? `${fuel.trim()}/${type1.trim()}`
              : fuel.trim()
            : typeof type1 === "string" && type1.trim()
              ? type1.trim()
              : null;

        const status =
          typeof r[COL.APP_STATUS] === "string" ? (r[COL.APP_STATUS] as string).trim() || null : null;
        const submitted = excelSerialToIso(r[COL.RECEIVE_DATE]);
        const expected = excelSerialToIso(r[COL.CURRENT_ONLINE]);

        stmt.run(
          `CAISO-${queueNo}`,
          name,
          state,
          county,
          fips,
          mw,
          fuelType,
          status,
          submitted,
          expected,
          now,
          URL_CAISO,
        );
        inserted++;
      }
    });
    insertMany();
    run.complete(inserted, `${inserted} CAISO GI queue rows`);
    return inserted;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}
