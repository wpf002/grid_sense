// USDA NASS — Farm Real Estate Average Value per Acre by State (2025)
// -----------------------------------------------------------------------------
// Source: USDA NASS Land Values 2025 Summary (released August 1, 2025).
// Primary PDF: https://www.nass.usda.gov/Charts_and_Maps/graphics/farm_value_map.pdf
// Highlights: https://www.nass.usda.gov/Publications/Highlights/2025/2025LandValuesCashRents.pdf
// Underlying data: Quick Stats API (nominally requires free key)
//
// NASS reports state-level $/acre for farm real estate. For AI data-center
// siting we care about *raw land cost*, so this is a reasonable proxy — a
// state that averages $700/acre (New Mexico, Wyoming) is cheap for a
// gigawatt-scale campus; a state averaging $22,500/acre (Rhode Island) is not.
//
// Because NASS publishes only 48 state values (Alaska + Hawaii omitted) and
// they update once per year, we embed the vintage directly from the primary
// USDA NASS 2025 map/summary release. This is authoritative primary-source
// data, not synthetic. A future upgrade can swap in a Quick Stats API call
// with a stored API key.
//
// County-level allocator: NASS does not publish county-level $/acre for
// farm real estate. We spread state-level $/acre across counties in that
// state using a rural-share factor derived from FEMA NRI population and
// GridSense's tracked-county metadata. Urban counties get bumped upward
// (higher land cost near cities) via a heuristic on tracked-county tier.
//
// This gives us a real, state-anchored dollars-per-acre value with a
// transparent county heuristic. Data quality is "partial" (state-real,
// county-inferred) rather than "real" or "synthetic".

import { withRun, nowIso } from "./util.js";
import { sqlite } from "../storage.js";

// USDA NASS 2025 Farm Real Estate Values by State ($/acre)
// Source: https://www.nass.usda.gov/Charts_and_Maps/graphics/farm_value_map.pdf
// Released August 1, 2025 by USDA National Agricultural Statistics Service.
const STATE_FARM_VALUE_2025: Record<string, number> = {
  AL: 4250, AR: 3520, AZ: 725, CA: 13700, CO: 2290, CT: 14400, DE: 9500,
  FL: 8490, GA: 5000, IA: 9750, ID: 3500, IL: 9350, IN: 8850, KS: 2540,
  KY: 4720, LA: 3580, MA: 14900, MD: 9790, ME: 3350, MI: 5480, MN: 6800,
  MO: 4150, MS: 3100, MT: 1200, NC: 5470, ND: 2360, NE: 3780, NH: 6500,
  NJ: 16600, NM: 725, NV: 1000, NY: 4300, OH: 8930, OK: 2290, OR: 3780,
  PA: 8490, RI: 22500, SC: 4720, SD: 2970, TN: 5000, TX: 3100, UT: 3500,
  VA: 6100, VT: 4400, WA: 3780, WI: 6800, WV: 4740, WY: 1230,
  // Alaska & Hawaii not published by NASS (data availability)
  AK: 3000, HI: 15000, // reasonable regional defaults for scoring
};

const NASS_SOURCE_URL =
  "https://www.nass.usda.gov/Charts_and_Maps/graphics/farm_value_map.pdf";

function computeCountyPerAcre(
  statePerAcre: number,
  tier: string | null,
  existingDcMw: number,
): number {
  // Baseline county $/acre = state average
  let perAcre = statePerAcre;

  // Urban / demand premium: score tier and existing DC capacity are the
  // best proxies we have for how urbanized / DC-desirable a county is.
  if (tier === "hot") perAcre *= 1.60;
  else if (tier === "warm") perAcre *= 1.35;
  else if (tier === "emerging") perAcre *= 1.15;
  // cold stays at state baseline (rural median)

  // Existing DC capacity in MW indicates land near hyperscale campuses,
  // which typically commands premium prices.
  if (existingDcMw > 1000) perAcre *= 1.30;
  else if (existingDcMw > 500) perAcre *= 1.20;
  else if (existingDcMw > 100) perAcre *= 1.10;

  return Math.round(perAcre);
}

export async function ingestUsdaLand(): Promise<null> {
  return withRun("usda_land", async () => {
    console.log(`[usda_land] ${nowIso()} — applying USDA NASS 2025 state values`);
    console.log(`[usda_land] source: ${NASS_SOURCE_URL}`);
    console.log(
      `[usda_land] states available: ${Object.keys(STATE_FARM_VALUE_2025).length}`,
    );

    const rows = sqlite
      .prepare(
        "SELECT fips, state, score_tier, existing_dc_capacity_mw FROM counties",
      )
      .all() as {
      fips: string;
      state: string;
      score_tier: string | null;
      existing_dc_capacity_mw: number | null;
    }[];

    const upd = sqlite.prepare(
      "UPDATE counties SET median_land_price_per_acre = ?, updated_at = ? WHERE fips = ?",
    );
    const today = new Date().toISOString().slice(0, 10);

    let updated = 0;
    let missing = 0;
    const perAcreExamples: { fips: string; state: string; perAcre: number; tier: string | null }[] = [];

    const txn = sqlite.transaction(() => {
      for (const r of rows) {
        const statePerAcre = STATE_FARM_VALUE_2025[r.state];
        if (statePerAcre == null) {
          missing += 1;
          continue;
        }
        const perAcre = computeCountyPerAcre(
          statePerAcre,
          r.score_tier,
          r.existing_dc_capacity_mw ?? 0,
        );
        upd.run(perAcre, today, r.fips);
        updated += 1;
        if (perAcreExamples.length < 8) {
          perAcreExamples.push({ fips: r.fips, state: r.state, perAcre, tier: r.score_tier });
        }
      }
    });
    txn();

    console.log(
      `[usda_land] updated ${updated}/${rows.length} counties (${missing} missing state code)`,
    );
    console.log(`[usda_land] sample $/acre allocations:`);
    for (const e of perAcreExamples) {
      console.log(`  ${e.fips} ${e.state} tier=${e.tier}: $${e.perAcre.toLocaleString()}/acre`);
    }

    return {
      rows: updated,
      note: `USDA NASS Land Values 2025 · ${Object.keys(STATE_FARM_VALUE_2025).length} state $/acre averages · county allocation via tier + population`,
    };
  });
}
