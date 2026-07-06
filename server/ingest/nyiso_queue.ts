// NYISO Generator Interconnection Queue (public XLSX)
// Source page: https://www.nyiso.com/interconnections
// Direct XLSX: https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx
//
// The workbook has 10 sheets. We ingest the three ACTIVE sheets:
//   1. "Interconnection Queue"     — 344 large-facility generation projects (header row 0)
//   2. " Cluster Projects"          — 98  cluster-study projects (header row 0)
//   3. "Load Projects"              — 53  large-load projects, incl. data centers (header row 0)
//
// The Withdrawn / In Service sheets are intentionally skipped — they're not
// forward-looking landing signals for the data-center prospecting model.
//
// Generation Queue columns (header row 0):
//   0  Queue Pos.                     (queue_no)
//   1  Developer/Interconnection Customer
//   2  Project Name
//   3  Date of IR                     (Excel serial → submitted_date)
//   4  SP (MW)                        (mw)
//   5  WP (MW)
//   7  Type/ Fuel                     (fuel_type e.g. "S" solar, "W" wind, "ES" storage, "OSW" offshore wind)
//  10  County
//  11  State
//  16  S                              (numeric project-status code, treated as status)
//  23  Proposed COD                   (string "MM-YYYY" or "MM/YYYY" → expected_in_service)
//
// Cluster Projects columns (header row 0):
//   0  Queue Pos.                     (queue_no)
//   1  Interconnection Customer Name
//   2  Project Name
//   3  Date of IR                     (Excel serial)
//   4  SP (MW)
//   7  Type/ Fuel
//  10  County
//  11  State
//  16  S                              (project-status code)
//  22  Proposed COD                   (string MM-YYYY / MM/YYYY)
//
// Load Projects columns (header row 0):
//   0  Queue Number
//   1  Developer Name
//   2  Project: Project Name
//   3  IR Submission Date             (Excel serial)
//   4  Peak MW load
//   6  Type/Fuel                      (usually "L" for load — we keep it)
//   7  County
//   8  State
//  13  Project Status #               (numeric status code)
//  18  Proposed Initial Backfeed Date (string MM-YYYY)
//
// Fuel codes: S=Solar, W=Wind, ES=Energy Storage, OSW=Offshore Wind, NG=Natural Gas,
// H=Hydro, N=Nuclear, DR=Demand Response, L=Load, CT=Combustion Turbine.

import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { fetchBuffer, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_NYISO =
  "https://www.nyiso.com/documents/20142/1407078/NYISO-Interconnection-Queue.xlsx";

const GEN_COL = {
  QUEUE: 0,
  NAME: 2,
  IR_DATE: 3,
  MW: 4,
  FUEL: 7,
  COUNTY: 10,
  STATE: 11,
  STATUS: 16,
  COD: 23,
} as const;

const CLUSTER_COL = {
  QUEUE: 0,
  NAME: 2,
  IR_DATE: 3,
  MW: 4,
  FUEL: 7,
  COUNTY: 10,
  STATE: 11,
  STATUS: 16,
  COD: 22,
} as const;

const LOAD_COL = {
  QUEUE: 0,
  NAME: 2,
  IR_DATE: 3,
  MW: 4,
  FUEL: 6,
  COUNTY: 7,
  STATE: 8,
  STATUS: 13,
  COD: 18,
} as const;

const FUEL_MAP: Record<string, string> = {
  S: "Solar",
  W: "Wind",
  ES: "Energy Storage",
  OSW: "Offshore Wind",
  NG: "Natural Gas",
  H: "Hydro",
  N: "Nuclear",
  DR: "Demand Response",
  L: "Load",
  CT: "Combustion Turbine",
  ST: "Steam Turbine",
  DC: "DC Transmission",
  NG_ST: "Natural Gas / Steam",
};

// NYISO STATUS CODE decoder — from the sheet's own dropdown legend.
// Broadly: 1-6 = feasibility / SIS in progress, 7-11 = FS / IA in progress,
// 12 = in service, 0 = withdrawn.
function decodeStatus(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const n = typeof s === "number" ? s : parseInt(String(s), 10);
  if (!isFinite(n)) return typeof s === "string" ? s.trim() || null : null;
  switch (n) {
    case 0:
      return "Withdrawn";
    case 6:
      return "Scoping";
    case 7:
      return "FS Complete";
    case 9:
      return "SRIS Complete";
    case 10:
      return "IA Executed";
    case 11:
      return "Under Construction";
    case 12:
      return "In Service";
    default:
      return `Stage ${n}`;
  }
}

function excelSerialToIso(n: unknown): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Convert NYISO "MM-YYYY" / "MM/YYYY" text COD strings to ISO date on the 1st. */
function codToIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const mo = String(m[1]).padStart(2, "0");
    return `${m[2]}-${mo}-01`;
  }
  const y = s.match(/^(\d{4})$/);
  if (y) return `${y[1]}-01-01`;
  return null;
}

function normFuel(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return FUEL_MAP[s.toUpperCase()] ?? s;
}

function normCounty(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;
  // NYISO sometimes writes "Nassau County", "kings county", "St. Lawrence".
  // Strip trailing " County", lower-then-title-case, and let counties_ref do the rest.
  const cleaned = raw.replace(/\s+County\s*$/i, "").trim();
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SheetSpec {
  name: string;
  cols: typeof GEN_COL | typeof CLUSTER_COL | typeof LOAD_COL;
  prefix: string; // "NYISO-G", "NYISO-C", "NYISO-L"
}

const SHEETS: SheetSpec[] = [
  { name: "Interconnection Queue", cols: GEN_COL, prefix: "NYISO-G" },
  { name: " Cluster Projects", cols: CLUSTER_COL, prefix: "NYISO-C" },
  { name: "Load Projects", cols: LOAD_COL, prefix: "NYISO-L" },
];

export async function ingestNyisoQueue(): Promise<number> {
  const run = beginRun(
    "nyiso_queue",
    "NYISO Generator + Load Interconnection Queue",
  );
  try {
    const buf = await fetchBuffer(URL_NYISO, { cacheKey: "nyiso_queue.xlsx" });
    const wb = XLSX.read(buf, { type: "buffer" });
    const now = new Date().toISOString();

    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'NYISO'").run();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('NYISO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const insertAll = sqlite.transaction(() => {
      for (const spec of SHEETS) {
        const ws = wb.Sheets[spec.name];
        if (!ws) {
          console.warn(`[nyiso] sheet missing: ${spec.name}`);
          continue;
        }
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: null,
        });
        if (rows.length < 2) continue;

        // Row 0 is header on all three active sheets.
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !Array.isArray(r)) continue;

          const qRaw = r[spec.cols.QUEUE];
          if (qRaw === null || qRaw === undefined || String(qRaw).trim() === "")
            continue;
          const queueNo = String(qRaw).trim();

          const nameRaw = r[spec.cols.NAME];
          if (typeof nameRaw !== "string" || !nameRaw.trim()) continue;
          const name = nameRaw.trim();

          const stRaw = r[spec.cols.STATE];
          const state =
            typeof stRaw === "string" && stRaw.trim()
              ? stRaw.trim().toUpperCase()
              : "NY";
          if (!STATE_FIPS[state]) continue;

          const county = normCounty(r[spec.cols.COUNTY]);
          const fips = county
            ? lookupFips(state, normalizeCountyName(county))
            : null;

          const mwRaw = r[spec.cols.MW];
          const mw = typeof mwRaw === "number" && isFinite(mwRaw) ? mwRaw : null;

          const fuel = normFuel(r[spec.cols.FUEL]);
          const status = decodeStatus(r[spec.cols.STATUS]);
          const submitted = excelSerialToIso(r[spec.cols.IR_DATE]);
          const expected = codToIso(r[spec.cols.COD]);

          stmt.run(
            `${spec.prefix}-${queueNo}`,
            name,
            state,
            county,
            fips,
            mw,
            fuel,
            status,
            submitted,
            expected,
            now,
            URL_NYISO,
          );
          inserted++;
        }
      }
    });
    insertAll();

    run.complete(
      inserted,
      `${inserted} NYISO queue rows across ${SHEETS.length} sheets`,
    );
    return inserted;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}
