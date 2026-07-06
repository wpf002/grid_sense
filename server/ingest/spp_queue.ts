// SPP Generator Interconnection Queue — Active Studies CSV export
// Source page: https://opsportal.spp.org/Studies/GIActive
// CSV export:  https://opsportal.spp.org/Studies/GenerateActiveCSV
//
// CSV layout (row 0 = "Last Updated On, <date>"; row 1 = header; row 2+ = data):
//  0  Generation Interconnection Number  (queue_no, e.g. TI-18-0827 / GEN-2025-xxx)
//  1  IFS Queue Number
//  2  Current Cluster
//  3  Cluster Group
//  4  Nearest Town or County
//  5  State
//  6  TO at POI
//  7  In-Service Date
//  8  Commercial Operation Date
//  9  Cessation Date
// 10  Original Generator Commercial Op Date
// 11  Capacity                                (mw)
// 12  MAX Summer MW
// 13  MAX Winter MW
// 14  Service Type
// 15  Requested Max Injection (MW)
// 16  Requested Network Resource Deliverability (MW)
// 17  Nameplate Capacity
// 18  Generation Type
// 19  Fuel Type
// 20  Substation or Line
// 21  Request Received                        (submitted_date, m/d/yyyy)
// 22  Date Withdrawn
// 23  Status                                  (e.g. IA FULLY EXECUTED/ON SCHEDULE)
// 24  JTIQ Participant
// 25  JTIQ Commitment
// 26  Cause of Delay
//
// SPP footprint states: TX, OK, KS, NE, SD, ND, MT, WY, CO, NM, IA, MN, MO, AR, LA.
// The "Nearest Town or County" column mixes county names ("Weld County") and
// town names ("Amarillo"). We try county-lookup first, then fall through.

import { sqlite } from "../storage.js";
import { fetchText, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_SPP = "https://opsportal.spp.org/Studies/GenerateActiveCSV";

const COL = {
  QUEUE_NO: 0,
  TOWN_OR_COUNTY: 4,
  STATE: 5,
  IN_SERVICE_DATE: 7,
  CAPACITY_MW: 11,
  GEN_TYPE: 18,
  FUEL_TYPE: 19,
  REQUEST_RECEIVED: 21,
  STATUS: 23,
};

/** Parse a CSV line handling quoted fields with commas inside. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/** Parse a full CSV document. Handles quoted newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let inQ = false;
  const raw = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQ && raw[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        cur += '"';
        inQ = !inQ;
      }
    } else if (ch === "\n" && !inQ) {
      rows.push(parseCsvLine(cur));
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length) rows.push(parseCsvLine(cur));
  return rows;
}

/** "6/24/2022" -> "2022-06-24". Returns null for empty / unparseable input. */
function usDateToIso(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * SPP "Nearest Town or County" values include:
 *   "Weld County"     → strip suffix → "Weld"
 *   "Grady"           → treat as county
 *   "Amarillo"        → likely a town, no direct FIPS hit; we return null
 *   "Panhandle Wind Farm 1"  → project location text, no hit
 * We rely on lookupFips being conservative (returns null on no match) and
 * accept that ~30-40% of SPP rows won't get a FIPS. State-level attribution
 * still lands correctly, and expand_counties adds the top counties we care
 * about anyway.
 */
function guessFipsFromTownOrCounty(state: string, raw: string | null): string | null {
  if (!raw || !state) return null;
  const cleaned = raw.replace(/\s+county$/i, "").trim();
  if (!cleaned) return null;
  // Try direct as-if county
  const direct = lookupFips(state, normalizeCountyName(cleaned));
  return direct;
}

export async function ingestSppQueue(): Promise<number> {
  const run = beginRun("spp_queue", "SPP Generator Interconnection Queue (Active)");
  try {
    const text = await fetchText(URL_SPP, { cacheKey: "spp_gi_active.csv" });
    const rows = parseCsv(text);
    if (rows.length < 3) throw new Error("SPP CSV had fewer than 3 rows");

    const header = rows[1];
    if (!header || header[0] !== "Generation Interconnection Number") {
      throw new Error(
        `SPP CSV header mismatch — expected 'Generation Interconnection Number' in col 0, got '${header?.[0]}'`,
      );
    }

    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'SPP'").run();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('SPP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const insertMany = sqlite.transaction(() => {
      for (let i = 2; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 24) continue;
        const queueNo = (r[COL.QUEUE_NO] ?? "").trim();
        if (!queueNo) continue;
        const state = (r[COL.STATE] ?? "").trim().toUpperCase();
        if (!state || !STATE_FIPS[state]) continue;

        const townOrCounty = (r[COL.TOWN_OR_COUNTY] ?? "").trim() || null;
        const fips = guessFipsFromTownOrCounty(state, townOrCounty);
        const mwStr = (r[COL.CAPACITY_MW] ?? "").trim();
        const mw = mwStr ? Number(mwStr) : null;
        const genType = (r[COL.GEN_TYPE] ?? "").trim();
        const fuel = (r[COL.FUEL_TYPE] ?? "").trim();
        const fuelType = genType && fuel && genType !== fuel ? `${fuel}/${genType}` : (fuel || genType || null);
        const status = (r[COL.STATUS] ?? "").trim() || null;
        const submitted = usDateToIso(r[COL.REQUEST_RECEIVED]);
        const expected = usDateToIso(r[COL.IN_SERVICE_DATE]);

        stmt.run(
          queueNo,
          `${queueNo} SPP ${townOrCounty ?? ""}`.trim(),
          state,
          townOrCounty,
          fips,
          isFinite(mw as number) ? mw : null,
          fuelType,
          status,
          submitted,
          expected,
          now,
          URL_SPP,
        );
        inserted++;
      }
    });
    insertMany();
    run.complete(inserted, `${inserted} SPP GI queue rows`);
    return inserted;
  } catch (e) {
    run.fail(e);
    throw e;
  }
}
