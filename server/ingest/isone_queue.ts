// ISO-NE Interconnection Request Queue (public XLSX export)
//
// Access pattern (no auth required):
//   1. GET https://irtt.iso-ne.com/reports/external  (sets ASP.NET_SessionId)
//   2. GET https://irtt.iso-ne.com/reports/exportpublicqueue?
//          ReportDate=639187200000000000&Status=&Jurisdiction=
//        with the session cookie + Referer header → returns Excel XLSX (~220 KB)
//
// The exported workbook has a single sheet "Queue" laid out as:
//   Row 0-3: header/metadata banner ("Interconnection Requests for New England...")
//   Row 4:   column headers
//   Row 5+:  data (~1750 rows including active + withdrawn)
//
// Column layout (row 4):
//   0  Cluster
//   1  Position                (queue_no)
//   2  Updated                 (Excel serial)
//   3  Type                    ("G" gen / "T" transmission / "E" ETU)
//   4  Requested               (Excel serial → submitted_date)
//   5  Alternative Name
//   6  Unit                    (e.g. "WT" wind turbine, "PV" solar, "BAT" battery)
//   7  Fuel Type               (fuel_type e.g. WND, SUN, BAT, NG, GAS)
//   8  Net MW                  (mw)
//   9  Summer MW
//  10  Winter MW
//  11  County                  (may be "NA" — offshore/multi-county)
//  12  State                   (MA/CT/ME/NH/RI/VT + a few NY, NB)
//  13  Op Date                 (Excel serial → expected_in_service)
//  14  Sync Date               (Excel serial)
//  15  W/ D Date               (Excel serial — non-null == withdrawn)
//  16  Interconnection Location
//  17  Serv
//  22  Zone
//  27  IA (contract stage)
//  28  Project Status          (lifecycle text e.g. "Under Study", "In Service")
//
// Withdrawn signal: if col 15 (W/ D Date) is populated, project is withdrawn.
// We tag such rows status="Withdrawn" but keep them for provenance / audits.
// Rows missing State or with invalid state code are skipped.

import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { fetchWithSession, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_ISONE_SEED = "https://irtt.iso-ne.com/reports/external";
const URL_ISONE_EXPORT =
  "https://irtt.iso-ne.com/reports/exportpublicqueue?ReportDate=639187200000000000&Status=&Jurisdiction=";

const COL = {
  CLUSTER: 0,
  POSITION: 1,
  REQUESTED: 4,
  UNIT: 6,
  FUEL: 7,
  NET_MW: 8,
  COUNTY: 11,
  STATE: 12,
  OP_DATE: 13,
  WD_DATE: 15,
  IA: 27,
  PROJECT_STATUS: 28,
} as const;

// ISO-NE fuel abbreviations → human-readable
const FUEL_MAP: Record<string, string> = {
  WND: "Wind",
  SUN: "Solar",
  SOL: "Solar",
  BAT: "Battery Storage",
  ESS: "Battery Storage",
  NG: "Natural Gas",
  GAS: "Natural Gas",
  OIL: "Oil",
  DFO: "Distillate Fuel Oil",
  WAT: "Hydro",
  HYD: "Hydro",
  NUC: "Nuclear",
  DR: "Demand Response",
  BIO: "Biomass",
  MWH: "Municipal Waste",
  WDS: "Wood Solids",
  H2: "Hydrogen",
};

// Unit-type abbreviations sometimes carry more info than fuel column
const UNIT_MAP: Record<string, string> = {
  WT: "Wind Turbine",
  PV: "Solar PV",
  BAT: "Battery Storage",
  GT: "Gas Turbine",
  CT: "Combustion Turbine",
  CC: "Combined Cycle",
  ST: "Steam Turbine",
  HY: "Hydro",
  RE: "Reciprocating Engine",
  FC: "Fuel Cell",
};

function excelSerialToIso(n: unknown): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normFuel(fuelRaw: unknown, unitRaw: unknown): string | null {
  const fuel = typeof fuelRaw === "string" ? fuelRaw.trim().toUpperCase() : "";
  const unit = typeof unitRaw === "string" ? unitRaw.trim().toUpperCase() : "";
  const mappedFuel = fuel ? FUEL_MAP[fuel] ?? fuel : null;
  const mappedUnit = unit ? UNIT_MAP[unit] ?? unit : null;
  if (mappedFuel && mappedUnit && mappedFuel !== mappedUnit) {
    return `${mappedFuel} / ${mappedUnit}`;
  }
  return mappedFuel ?? mappedUnit;
}

function normCounty(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw || raw.toUpperCase() === "NA") return null;
  const cleaned = raw.replace(/\s+County\s*$/i, "").trim();
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function ingestIsoneQueue(): Promise<number> {
  const run = beginRun(
    "isone_queue",
    "ISO-NE Interconnection Request Queue (public export)",
  );
  try {
    // Session-gated ASP.NET export: fetchWithSession primes the cookie on the
    // seed page and carries it through the redirect chain to the XLSX.
    const buf = await fetchWithSession(URL_ISONE_SEED, URL_ISONE_EXPORT, {
      cacheKey: "isone_queue.xlsx",
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = "Queue";
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
    });
    if (rows.length < 6) throw new Error("ISO-NE sheet has fewer than 6 rows");

    // Validate header row 4
    const header = rows[4];
    if (
      !Array.isArray(header) ||
      header[0] !== "Cluster" ||
      header[1] !== "Position"
    ) {
      throw new Error(
        `ISO-NE header mismatch — expected 'Cluster'/'Position' cols 0/1, got '${(header as any)?.[0]}'/'${(header as any)?.[1]}'`,
      );
    }

    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'ISONE'").run();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('ISONE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const seenKeys = new Set<string>();
    const insertMany = sqlite.transaction(() => {
      for (let i = 5; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !Array.isArray(r)) continue;

        const posRaw = r[COL.POSITION];
        if (posRaw === null || posRaw === undefined) continue;
        const position = String(posRaw).trim();
        if (!position) continue;

        const cluster = typeof r[COL.CLUSTER] === "string" ? (r[COL.CLUSTER] as string).trim() : "";
        // Position numbers are unique across the queue but we prefix with cluster
        // for readability (e.g. ISONE-TCS-1090, ISONE-1345 for legacy non-cluster).
        const queueNo = cluster ? `${cluster}-${position}` : position;
        const key = `ISONE-${queueNo}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const stRaw = r[COL.STATE];
        if (typeof stRaw !== "string") continue;
        const state = stRaw.trim().toUpperCase();
        if (!state || !STATE_FIPS[state]) continue;

        const county = normCounty(r[COL.COUNTY]);
        const fips = county ? lookupFips(state, normalizeCountyName(county)) : null;

        const mwRaw = r[COL.NET_MW];
        const mw =
          typeof mwRaw === "number" && isFinite(mwRaw) && mwRaw > 0 ? mwRaw : null;

        const fuel = normFuel(r[COL.FUEL], r[COL.UNIT]);

        const wdDate = excelSerialToIso(r[COL.WD_DATE]);
        const projectStatus =
          typeof r[COL.PROJECT_STATUS] === "string"
            ? (r[COL.PROJECT_STATUS] as string).trim() || null
            : null;
        const ia =
          typeof r[COL.IA] === "string"
            ? (r[COL.IA] as string).trim() || null
            : null;
        // If W/D Date populated → withdrawn. Otherwise combine IA stage + Project Status.
        const status = wdDate
          ? "Withdrawn"
          : ia && projectStatus && ia !== projectStatus
            ? `${ia} — ${projectStatus}`
            : projectStatus ?? ia ?? null;

        const submitted = excelSerialToIso(r[COL.REQUESTED]);
        const expected = excelSerialToIso(r[COL.OP_DATE]);

        // Project Name: ISO-NE workbook doesn't have a canonical name column;
        // "Alternative Name" (col 5) is populated for most projects. Fall back
        // to the interconnection location.
        const nameRaw = r[5];
        const locRaw = r[16];
        const projectName =
          typeof nameRaw === "string" && nameRaw.trim()
            ? nameRaw.trim()
            : typeof locRaw === "string" && locRaw.trim()
              ? locRaw.trim()
              : `ISO-NE Queue ${position}`;

        stmt.run(
          queueNo,
          projectName,
          state,
          county,
          fips,
          mw,
          fuel,
          status,
          submitted,
          expected,
          now,
          URL_ISONE_EXPORT,
        );
        inserted++;
      }
    });
    insertMany();

    run.complete(inserted, `${inserted} ISO-NE queue rows`);
    return inserted;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}
