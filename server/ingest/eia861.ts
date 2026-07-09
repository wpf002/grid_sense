// EIA-861 utility service territory pipeline.
// Downloads the annual EIA-861 zip, extracts Service_Territory_YYYY.xlsx,
// and builds a (fips -> [utilities]) map. This lets GridSense sanity-check
// which distribution utility actually serves each tracked county, so a
// user reading a county detail page can see the real electric provider(s)
// alongside the ISO-queue "utility" field (which is usually the transmission
// owner, not the retail distribution utility).
//
// Source: https://www.eia.gov/electricity/data/eia861/
// License: public data (US government, no copyright).
//
// v1.1 - initial implementation, US 50 states + DC.

import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { sqlite } from "../storage.js";
import { fetchBuffer, nowIso, beginRun } from "./util.js";
import { lookupFips } from "./counties_ref.js";

const EIA861_URL = "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip";
const EIA861_VINTAGE = "2024";
const SERVICE_TERRITORY_FILE = "Service_Territory_2024.xlsx";

type TerritoryRow = {
  utilityNumber: number;
  utilityName: string;
  state: string;
  countyName: string;
};

function parseServiceTerritorySheet(buf: Buffer): TerritoryRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  // Two sheets: Counties_States (50 states + DC) and Counties_Territories (PR, VI, etc.)
  // We only care about the 50 states + DC sheet.
  const sheetName = wb.SheetNames.find((n) => /counties_states/i.test(n)) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: null,
    raw: true,
  });

  const out: TerritoryRow[] = [];
  for (const r of rows) {
    const utilityNumberRaw = r["Utility Number"];
    const utilityNumber =
      typeof utilityNumberRaw === "number"
        ? utilityNumberRaw
        : parseInt(String(utilityNumberRaw ?? ""), 10);
    if (!utilityNumber || Number.isNaN(utilityNumber)) continue;
    const utilityName = String(r["Utility Name"] ?? "").trim();
    const state = String(r["State"] ?? "").trim();
    const county = String(r["County"] ?? "").trim();
    if (!utilityName || !state || !county) continue;
    out.push({ utilityNumber, utilityName, state, countyName: county });
  }
  return out;
}

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS utility_service_territory (
      fips TEXT NOT NULL,
      utility_number INTEGER NOT NULL,
      utility_name TEXT NOT NULL,
      state TEXT NOT NULL,
      county_name TEXT NOT NULL,
      vintage TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (fips, utility_number)
    )
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_utility_service_territory_fips
      ON utility_service_territory (fips)
  `);
}

export async function ingestEia861(): Promise<{
  rowsParsed: number;
  inserted: number;
  countiesTouched: number;
  fipsUnmatched: number;
}> {
  const run = beginRun("eia861", "EIA-861 utility service territories");
  try {
  console.log("[eia861] Fetching", EIA861_URL);
  const zipBuf = await fetchBuffer(EIA861_URL, {
    cacheKey: `eia861_${EIA861_VINTAGE}.zip`,
    maxAgeMs: 1000 * 60 * 60 * 24 * 30, // 30 day cache
  });
  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntry(SERVICE_TERRITORY_FILE);
  if (!entry) {
    const names = zip.getEntries().map((e) => e.entryName).join(", ");
    throw new Error(`Could not find ${SERVICE_TERRITORY_FILE} in EIA-861 zip. Contents: ${names}`);
  }
  const xlsxBuf = entry.getData();
  const rows = parseServiceTerritorySheet(xlsxBuf);
  console.log(`[eia861] Parsed ${rows.length} territory rows`);

  ensureTable();

  const upsert = sqlite.prepare(`
    INSERT INTO utility_service_territory
      (fips, utility_number, utility_name, state, county_name, vintage, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fips, utility_number) DO UPDATE SET
      utility_name = excluded.utility_name,
      state = excluded.state,
      county_name = excluded.county_name,
      vintage = excluded.vintage,
      updated_at = excluded.updated_at
  `);
  const clear = sqlite.prepare(`DELETE FROM utility_service_territory WHERE vintage = ?`);
  const ts = nowIso();

  let inserted = 0;
  let unmatched = 0;
  const countiesSeen = new Set<string>();

  const txn = sqlite.transaction((batch: TerritoryRow[]) => {
    clear.run(EIA861_VINTAGE);
    for (const r of batch) {
      const fips = lookupFips(r.state, r.countyName);
      if (!fips) {
        unmatched++;
        continue;
      }
      upsert.run(fips, r.utilityNumber, r.utilityName, r.state, r.countyName, EIA861_VINTAGE, ts);
      inserted++;
      countiesSeen.add(fips);
    }
  });
  txn(rows);

  console.log(
    `[eia861] Inserted ${inserted} utility-county rows across ${countiesSeen.size} counties (${unmatched} FIPS unmatched)`
  );

  run.complete(inserted, `${countiesSeen.size} counties · ${unmatched} FIPS unmatched`);
  return {
    rowsParsed: rows.length,
    inserted,
    countiesTouched: countiesSeen.size,
    fipsUnmatched: unmatched,
  };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

/**
 * List retail-distribution utilities that serve a given FIPS county.
 * Returned in stable alphabetical order.
 */
export function utilitiesForCounty(fips: string): { utilityNumber: number; utilityName: string }[] {
  try {
    const rows = sqlite
      .prepare(
        `SELECT utility_number, utility_name FROM utility_service_territory
         WHERE fips = ?
         ORDER BY utility_name ASC`
      )
      .all(fips) as any[];
    return rows.map((r) => ({ utilityNumber: r.utility_number, utilityName: r.utility_name }));
  } catch {
    return [];
  }
}
