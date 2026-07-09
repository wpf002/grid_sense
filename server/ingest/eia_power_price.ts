// EIA Electric Power Monthly - Table 5.6.A - Average Price of Electricity to
// Ultimate Customers by End-Use Sector, by State.
//
// This is a FREE proxy for nodal LMP. True nodal LMP is only available via ISO
// paid data feeds (~$5-25K/yr). But the state-level industrial retail price
// captures the same signal a data-center developer cares about: what will my
// electricity actually cost per MWh once I hook up. It's what utilities charge
// large customers on the specific tariffs a hyperscaler would negotiate against.
//
// Source: https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx
// Refresh: monthly (EIA publishes ~2 months in arrears).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../storage.js";
import { fetchBuffer, nowIso, USER_AGENT, RAW_DIR, beginRun } from "./util.js";

const EIA_URL = "https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx";

// Map state names to 2-letter codes.
const STATE_NAME_TO_CODE: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
  "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
  "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
  "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
  "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
  "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
  "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
  "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
};

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS state_power_price (
      state TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      industrial_cents_per_kwh REAL NOT NULL,
      commercial_cents_per_kwh REAL,
      industrial_yoy_pct REAL,
      updated_at TEXT NOT NULL
    )
  `);
}

export async function ingestEiaPowerPrice(): Promise<{
  statesLoaded: number;
  period: string;
  medianCentsPerKwh: number;
}> {
  const run = beginRun("eia_power_price", "EIA state industrial electricity price (Table 5.6.A)");
  try {
  ensureTable();

  const buf = await fetchBuffer(EIA_URL, {
    cacheKey: "eia_table_5_06_a.xlsx",
    forceRefresh: true,
  });
  writeFileSync(join(RAW_DIR, "eia_table_5_06_a.xlsx"), buf);

  // Use ExcelJS since we already have it available via openpyxl in Python...
  // Actually we should stay in Node. Use exceljs. Check if it's installed.
  // Fallback: use built-in xlsx-populate or a manual parse via unzip.
  //
  // Simplest robust path in Node: use a lightweight XLSX reader. Let's write
  // a minimal one using the "xlsx" package which may already be installed.

  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null }) as any[][];

  // Parse period from row 1 (e.g. "by State, April 2026 and 2025 (Cents per Kilowatthour)")
  const periodText = String(rows[1]?.[0] ?? "");
  const monthYearMatch = periodText.match(/([A-Z][a-z]+ \d{4})/);
  const period = monthYearMatch ? monthYearMatch[1] : nowIso().slice(0, 7);

  // Data starts around row 4 (0-indexed). Columns per header row 3:
  //   0: state name (may include "Census Division..." labels)
  //   1: Residential current, 2: Residential yr-ago
  //   3: Commercial current, 4: Commercial yr-ago
  //   5: Industrial current, 6: Industrial yr-ago
  //   7: Transportation current

  const upsert = sqlite.prepare(`
    INSERT INTO state_power_price
      (state, period, industrial_cents_per_kwh, commercial_cents_per_kwh, industrial_yoy_pct, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(state) DO UPDATE SET
      period = excluded.period,
      industrial_cents_per_kwh = excluded.industrial_cents_per_kwh,
      commercial_cents_per_kwh = excluded.commercial_cents_per_kwh,
      industrial_yoy_pct = excluded.industrial_yoy_pct,
      updated_at = excluded.updated_at
  `);

  const ts = nowIso();
  const values: number[] = [];
  let loaded = 0;

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = String(row[0] ?? "").trim();
    if (!label) continue;
    const code = STATE_NAME_TO_CODE[label];
    if (!code) continue; // Skip census-division and total rows
    const commercial = Number(row[3]);
    const industrial = Number(row[5]);
    const industrialYa = Number(row[6]);
    if (!Number.isFinite(industrial)) continue;
    const yoy = Number.isFinite(industrialYa) && industrialYa > 0
      ? ((industrial - industrialYa) / industrialYa) * 100
      : null;
    upsert.run(code, period, industrial, Number.isFinite(commercial) ? commercial : null, yoy, ts);
    values.push(industrial);
    loaded++;
  }

  values.sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;

  console.log(`[eia_power_price] Loaded ${loaded} states for ${period}. Median industrial rate ${median.toFixed(2)} ¢/kWh`);
    run.complete(loaded, `${period} · median ${median.toFixed(2)} ¢/kWh`);
    return { statesLoaded: loaded, period, medianCentsPerKwh: median };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

/** Look up the state industrial retail electricity price for a county. */
export function statePriceForCounty(state: string): { industrialCentsPerKwh: number; period: string; yoyPct: number | null } | null {
  try {
    const row = sqlite.prepare(
      "SELECT industrial_cents_per_kwh, period, industrial_yoy_pct FROM state_power_price WHERE state = ?"
    ).get(state) as any;
    if (!row) return null;
    return {
      industrialCentsPerKwh: row.industrial_cents_per_kwh,
      period: row.period,
      yoyPct: row.industrial_yoy_pct,
    };
  } catch {
    return null;
  }
}
