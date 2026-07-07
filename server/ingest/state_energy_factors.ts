/**
 * State energy factors — carbon intensity + gas access.
 *
 * Curated state-level reference tables (same pattern as water_stress.ts /
 * state_incentives.ts), joined per-county:
 *  - carbon_intensity_score: from EPA eGRID state output CO2 rate (lb/MWh);
 *    hyperscalers weight grid carbon for 24/7-CFE goals. Lower CO2 = higher score.
 *  - gas_access_score: interstate-pipeline density + production + citygate cost;
 *    higher = easier behind-the-meter gas generation given the interconnection
 *    backlog. Sources: EPA eGRID 2023, EIA natural gas pipeline & citygate data.
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

// [state, grid CO2 lb/MWh (eGRID ~2023), gas access 0-100]
const STATE_ENERGY: Array<[string, number, number]> = [
  ["AL", 730, 75], ["AK", 1050, 40], ["AZ", 810, 55], ["AR", 1050, 80],
  ["CA", 460, 50], ["CO", 1180, 80], ["CT", 530, 40], ["DE", 720, 55],
  ["DC", 490, 55], ["FL", 880, 55], ["GA", 790, 65], ["HI", 1450, 10],
  ["ID", 90, 55], ["IL", 640, 75], ["IN", 1620, 70], ["IA", 780, 60],
  ["KS", 830, 80], ["KY", 1780, 70], ["LA", 880, 95], ["ME", 230, 40],
  ["MD", 560, 60], ["MA", 530, 40], ["MI", 950, 65], ["MN", 730, 60],
  ["MS", 880, 80], ["MO", 1680, 65], ["MT", 1190, 60], ["NE", 1100, 60],
  ["NV", 680, 50], ["NH", 110, 40], ["NJ", 510, 65], ["NM", 1100, 85],
  ["NY", 460, 55], ["NC", 640, 60], ["ND", 1560, 75], ["OH", 1000, 80],
  ["OK", 730, 90], ["OR", 150, 55], ["PA", 700, 90], ["RI", 840, 40],
  ["SC", 560, 55], ["SD", 250, 55], ["TN", 600, 65], ["TX", 790, 95],
  ["UT", 1480, 65], ["VT", 10, 35], ["VA", 660, 65], ["WA", 95, 55],
  ["WV", 1900, 90], ["WI", 1000, 60], ["WY", 1900, 80],
];

function clamp(v: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

export async function ingestStateEnergyFactors(): Promise<{ states: number; counties: number }> {
  const run = beginRun("state_energy_factors", "Carbon intensity + gas access (EPA eGRID / EIA)");
  try {
    const upd = sqlite.prepare(
      "UPDATE counties SET carbon_intensity_score = ?, gas_access_score = ?, updated_at = ? WHERE state = ?",
    );
    const now = new Date().toISOString();
    let counties = 0;
    const txn = sqlite.transaction(() => {
      for (const [state, co2, gas] of STATE_ENERGY) {
        // Cleaner grid = higher score; 2000 lb/MWh -> 0, 0 -> 100.
        const carbonScore = clamp(100 - co2 / 20);
        const r = upd.run(carbonScore, clamp(gas), now, state);
        counties += r.changes;
      }
    });
    txn();
    run.complete(counties, `${STATE_ENERGY.length} states -> ${counties} counties`);
    return { states: STATE_ENERGY.length, counties };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestStateEnergyFactors()
    .then((r) => { console.log("[state_energy_factors]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
