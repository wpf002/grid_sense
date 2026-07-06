// USGS Estimated Use of Water in the United States — County-Level Data for 2015
// -----------------------------------------------------------------------------
// This is the last comprehensive county-level water-use compilation the USGS
// has published (2020 vintage was cancelled; 2025 vintage is still expected).
// Every water-use policy analyst uses this dataset. It ships one CSV row per
// US county with:
//   - Public supply withdrawals (PS-Wtotl)          Mgal/day
//   - Industrial withdrawals (IN-Wtotl)             Mgal/day
//   - Thermoelectric power withdrawals (TO-Wtotl)   Mgal/day  (data-center-relevant)
//   - Irrigation (IR-WFrTo)                         Mgal/day
//   - Aquaculture (AQ-Wtotl), Mining (MI-Wtotl), Livestock (LI-WFrTo) etc.
//
// Source page: https://water.usgs.gov/watuse/data/data2015.html
// DOI:         10.5066/F7TB15V5
// CSV file:    usco2015v2.0.csv (2.2 MB, ~3,142 county rows)
//
// The CSV is served via ScienceBase, which is cloud-IP-friendly. Values are
// stored as strings ("--" for missing, decimal numbers otherwise).
//
// GridSense water-availability score design:
//   For AI data-center siting, "water availability" is really "water-capacity
//   headroom for a very-large industrial user." We combine two things:
//
//   1. Proven industrial capacity — a county already withdrawing high
//      (industrial + thermoelectric) volumes has utility/permitting muscle
//      to serve another large water customer.
//        industrialCapacity = log10(1 + (IN + TO) Mgal/day) * 25         [0-100]
//
//   2. Stress penalty — if the county already runs a high fraction of its
//      combined non-agricultural withdrawals through public supply and
//      industrial use, headroom is thin.
//        stressBucket = clamp( totalWithdrawal / (population + 1) )
//        (roughly gpcd across all sectors)
//
//   Final water_stress_score (0-100, higher = more stressed) blends per-capita
//   demand (from USGS) with an aridity adjustment from state (interior
//   Southwest gets a base penalty). This lets `waterAvailability = 100 -
//   waterStressScore` work as before while now backed by real data.
//
// Only 626 tracked counties are updated. Missing counties (usually territory
// FIPS or aggregate rows) are left at their bootstrap value.

import { parse } from "csv-parse/sync";
import { fetchBuffer, nowIso, withRun, USER_AGENT } from "./util.js";
import { sqlite } from "../storage.js";

const USGS_CSV_URL =
  "https://www.sciencebase.gov/catalog/file/get/5af3311be4b0da30c1b245d8?f=__disk__eb%2F74%2Feb%2Feb74ebb41169c76aaf374990bd5a71cac82604c1";

// Interior-Southwest and other high-aridity states get a floor stress bump.
// Score is added AFTER the demand-driven calculation, so a low-population
// desert county still shows meaningful stress.
const ARIDITY_BASE: Record<string, number> = {
  AZ: 30, NM: 30, NV: 35, UT: 25, CA: 20, CO: 20, TX: 15, OK: 10, KS: 10,
  ID: 15, WY: 15, MT: 10, ND: 10, SD: 10, NE: 10,
};

interface CountyWater {
  fips: string;
  totPopThousands: number;   // TP-TotPop is in thousands
  psWtotl: number;           // Public supply, Mgal/day
  inWtotl: number;           // Industrial, Mgal/day
  toWtotl: number;           // Thermoelectric, Mgal/day
  irWFrTo: number;           // Irrigation freshwater, Mgal/day
  miWtotl: number;           // Mining
  liWFrTo: number;           // Livestock
  aqWtotl: number;           // Aquaculture
  state: string;
}

function parseNum(v: string | undefined | null): number {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s || s === "--" || s === "-" || s === "NA") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseUsgsCsv(buf: Buffer): CountyWater[] {
  // The CSV begins with a citation line, then a header row, then data.
  // csv-parse handles it if we skip the first row and take the second as header.
  const text = buf.toString("utf-8");
  const rows = parse(text, {
    from_line: 2, // skip citation
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const out: CountyWater[] = [];
  for (const r of rows) {
    const fips = (r.FIPS ?? "").trim();
    if (!/^\d{5}$/.test(fips)) continue;
    out.push({
      fips,
      state: (r.STATE ?? "").trim(),
      totPopThousands: parseNum(r["TP-TotPop"]),
      psWtotl: parseNum(r["PS-Wtotl"]),
      inWtotl: parseNum(r["IN-Wtotl"]),
      toWtotl: parseNum(r["TO-Wtotl"]),
      irWFrTo: parseNum(r["IR-WFrTo"]),
      miWtotl: parseNum(r["MI-Wtotl"]),
      liWFrTo: parseNum(r["LI-WFrTo"]),
      aqWtotl: parseNum(r["AQ-Wtotl"]),
    });
  }
  return out;
}

function computeStressScore(c: CountyWater): number {
  // Population in millions (TP-TotPop is in thousands per USGS docs)
  const popMil = c.totPopThousands / 1000;
  // Non-ag withdrawal in Mgal/day
  const nonAg = c.psWtotl + c.inWtotl + c.toWtotl + c.miWtotl;
  // Aridity floor
  const aridity = ARIDITY_BASE[c.state] ?? 5;

  if (popMil <= 0.001 && nonAg <= 0.1) {
    // Very small / no data: give the aridity floor plus a small penalty
    return Math.min(100, aridity + 20);
  }

  // gpcd (gallons per capita per day) across non-ag withdrawals (rough proxy)
  // Higher gpcd = more stress on shared supply
  const gpcdNonAg = popMil > 0 ? nonAg * 1000 / (popMil * 1000) : 0;
  // Convert 0-2000 gpcd range roughly to 0-40 stress points
  const demandStress = Math.min(40, gpcdNonAg / 50);

  // Irrigation dependence: high irrigation share of total means agriculture
  // competes for water. Cap at 25.
  const totalAll = nonAg + c.irWFrTo;
  const irShare = totalAll > 0 ? c.irWFrTo / totalAll : 0;
  const irStress = Math.min(25, irShare * 40);

  return Math.round(Math.min(100, aridity + demandStress + irStress) * 10) / 10;
}

export async function ingestUsgsWater(): Promise<null> {
  return withRun("usgs_water", async () => {
    console.log(`[usgs_water] ${nowIso()} — fetching USGS 2015 water use CSV`);
    console.log(`[usgs_water] source: ${USGS_CSV_URL}`);
    console.log(`[usgs_water] UA: ${USER_AGENT}`);

    const buf = await fetchBuffer(USGS_CSV_URL, {
      cacheKey: "usgs_usco2015v2.csv",
      timeoutMs: 90_000,
    });
    console.log(`[usgs_water] downloaded ${buf.length} bytes`);

    const rows = parseUsgsCsv(buf);
    console.log(`[usgs_water] parsed ${rows.length} county rows`);

    const byFips = new Map<string, CountyWater>();
    for (const r of rows) byFips.set(r.fips, r);

    // Update tracked counties only
    const tracked = (
      sqlite.prepare("SELECT fips FROM counties").all() as { fips: string }[]
    ).map((r) => r.fips);

    const upd = sqlite.prepare(
      "UPDATE counties SET water_stress_score = ?, updated_at = ? WHERE fips = ?",
    );
    const today = new Date().toISOString().slice(0, 10);

    let updated = 0;
    let missing = 0;
    let maxStress = 0;
    let maxFips = "";
    const scores: number[] = [];

    const txn = sqlite.transaction(() => {
      for (const fips of tracked) {
        const w = byFips.get(fips);
        if (!w) {
          missing += 1;
          continue;
        }
        const score = computeStressScore(w);
        upd.run(score, today, fips);
        updated += 1;
        scores.push(score);
        if (score > maxStress) {
          maxStress = score;
          maxFips = fips;
        }
      }
    });
    txn();

    // Distribution buckets
    const dist = { low: 0, mid: 0, high: 0, extreme: 0 };
    for (const s of scores) {
      if (s < 25) dist.low += 1;
      else if (s < 50) dist.mid += 1;
      else if (s < 75) dist.high += 1;
      else dist.extreme += 1;
    }

    console.log(
      `[usgs_water] updated ${updated}/${tracked.length} tracked counties (${missing} not found in USGS); max stress=${maxStress} @ FIPS ${maxFips}`,
    );
    console.log(
      `[usgs_water] stress distribution: <25=${dist.low} · 25-49=${dist.mid} · 50-74=${dist.high} · 75+=${dist.extreme}`,
    );

    return {
      rows: updated,
      note: `USGS 2015 water use · ${rows.length} US counties · updated ${updated}/${tracked.length} tracked · ${missing} unmatched`,
    };
  });
}
