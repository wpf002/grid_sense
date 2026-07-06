// server/ingest/state_incentives.ts
//
// State-level data-center tax-incentive matrix.
//
// Score 0-100 per state, reflecting how attractive the tax code is for a
// hyperscale / colo campus. Weighted rubric:
//   * Sales & use tax exemption on IT equipment  (0-40)
//   * Sales & use tax exemption on electricity   (0-20)
//   * Property tax abatement / MRO / freeport    (0-20)
//   * Job / capex threshold friendliness         (0-10)
//   * Statutory permanence / bipartisan support  (0-10)
//
// Sources (primary):
//   - state revenue-department statutes and fact sheets
//   - Tax Foundation state DC survey (2024)
//     https://taxfoundation.org/data/all/state/state-tax-data-centers/
//   - Site Selection Group "State DC Tax Incentives Comparison"
//   - AFCOM State of the DC Industry 2024
//
// Every state without a specific program still gets a floor of 10 (baseline
// business climate) so that the resulting factor value is real for all counties.

import { sqlite } from "../storage.js";

// (abbrev) -> {score, program}
const STATE_INCENTIVES: Record<string, { score: number; program: string }> = {
  // ---------- Tier 1: aggressive, mature, hyperscale-magnet programs ----------
  VA: { score: 95, program: "Va. Code § 58.1-609.3(18): full sales/use tax exemption on servers, generators, chillers; extended to 2035; 50 jobs / $150M capex" },
  TX: { score: 90, program: "Texas Tax Code § 151.359: Qualifying Data Center sales-tax exemption on IT equipment + electricity; 20 jobs / $200M capex" },
  OH: { score: 88, program: "Ohio Rev. Code § 122.175: sales/use tax exemption on DC equipment; 15-year term; JobsOhio grants" },
  GA: { score: 85, program: "O.C.G.A. § 48-8-3(68.1): sales-tax exemption on high-tech DC equipment; $100-250M capex tiers" },
  IA: { score: 90, program: "Iowa Code § 423.3(95): sales-tax exemption on servers + racks + power infrastructure; no jobs floor" },
  NC: { score: 85, program: "N.C.G.S. § 105-164.13(55a): sales-tax exemption on DC equipment + electricity; $75M capex" },
  IL: { score: 82, program: "35 ILCS 405: Data Centers Investment Act — sales-tax exemption + income-tax credits; $250M capex / 20 jobs" },
  AZ: { score: 80, program: "A.R.S. § 42-5061(B)(29): TPT exemption on DC equipment; 10-year (or 20 with sustainable-design)" },
  NE: { score: 78, program: "Nebraska ImagiNE Act: sales-tax refund on qualifying DC investment; property-tax exemption" },
  MI: { score: 75, program: "MCL 205.94q: sales-tax exemption on DC equipment (extended 2035); PA 108 of 2015" },

  // ---------- Tier 2: solid programs, growing hyperscale activity ----------
  UT: { score: 72, program: "Utah Code § 63N-2-106: EDTIF refundable tax credit; DC-specific sales-tax exemption on cooling" },
  OK: { score: 70, program: "68 O.S. § 1357.10: sales-tax exemption on servers + generators; 5-year renewable" },
  WY: { score: 72, program: "W.S. 39-15-105(a)(viii)(P): sales-tax exemption on DC equipment; low-tax state baseline" },
  MN: { score: 68, program: "Minn. Stat. § 297A.68 Subd. 42: sales-tax exemption on DC equipment; 20 jobs / $30M capex" },
  MO: { score: 65, program: "R.S.Mo. § 144.810: state + local sales-tax exemption on DC equipment; $25M capex" },
  KY: { score: 65, program: "KRS 154.20-036: KBI + sales-tax refund for DC investments" },
  TN: { score: 68, program: "Tenn. Code § 67-6-102(85): sales-tax exemption on qualifying DC equipment; $250M capex / 15 jobs" },
  ND: { score: 68, program: "N.D.C.C. 57-39.2-04.14: sales-tax exemption on DC equipment; low-tax state" },
  MS: { score: 65, program: "Miss. Code § 27-65-101: sales-tax exemption on DC equipment; MDA discretionary grants" },
  AL: { score: 62, program: "Ala. Code § 40-9B-3: abatement of state/local sales & use, non-educational property taxes" },
  SC: { score: 62, program: "S.C. Code § 12-36-2120(65): sales-tax exemption on DC equipment; $50M capex / 25 jobs" },
  WI: { score: 68, program: "Wis. Stat. § 77.54(70): sales-tax exemption on DC equipment (2023); $50-100M capex tiers" },
  IN: { score: 65, program: "IC 6-2.5-15: sales-tax exemption on DC equipment; $150M / $250M tiers; 25-year term" },

  // ---------- Tier 3: partial or older programs ----------
  PA: { score: 55, program: "72 P.S. § 7204(65): sales-tax exemption on DC equipment (2016); $75M capex / 25 jobs" },
  NY: { score: 45, program: "Excelsior Jobs Program: DC-eligible credits; no dedicated sales-tax exemption" },
  NJ: { score: 40, program: "Grow NJ Assistance Program: limited DC-specific credits" },
  MD: { score: 55, program: "Md. Code Tax-Gen § 11-239: sales-tax exemption on DC equipment (2020); $2-5M capex tiers" },
  FL: { score: 55, program: "Fla. Stat. § 212.08(5)(s): sales-tax exemption on DC equipment; $150M capex / 15 jobs" },
  CO: { score: 50, program: "C.R.S. § 39-30-105.1: Enterprise Zone investment credit; no dedicated DC sales-tax break" },
  WA: { score: 60, program: "RCW 82.08.986: sales-tax exemption on DC equipment in rural/urban EZ counties" },
  OR: { score: 65, program: "ORS 285C.409: Strategic Investment Program (SIP) 15-year property-tax abatement" },
  NM: { score: 55, program: "NMSA § 7-9-114: gross-receipts deduction on DC equipment; H2B site incentives" },
  ID: { score: 55, program: "Idaho Code § 63-4402: Business Advantage — refund on sales tax for large capex" },
  MT: { score: 45, program: "Mont. Code § 15-6-135: abatement on Class 8 property tax" },
  KS: { score: 52, program: "K.S.A. 74-50,212: HPIP + IMPACT program; DC-eligible" },
  AR: { score: 45, program: "Ark. Code § 26-52-447: sales-tax refund on DC equipment; ADFA discretionary" },
  LA: { score: 55, program: "La. R.S. 47:6035: Digital Interactive Media & Software credit; Quality Jobs Program" },
  NH: { score: 40, program: "No sales tax (structural benefit); no dedicated DC program" },
  NV: { score: 60, program: "NRS 360.754: 75% abatement of sales & personal property taxes for qualifying DCs" },

  // ---------- Tier 4: little to no DC-specific tax code ----------
  CA: { score: 30, program: "No dedicated DC exemption; California Competes credit; energy costs high" },
  ME: { score: 35, program: "Pine Tree Development Zones; no dedicated DC program" },
  MA: { score: 30, program: "Economic Development Incentive Program (EDIP); no dedicated DC exemption" },
  CT: { score: 55, program: "Conn. Gen. Stat. § 12-217oo: DC sales-tax exemption + property-tax deal (2021)" },
  RI: { score: 30, program: "Qualified Jobs Incentive; no dedicated DC exemption" },
  VT: { score: 30, program: "No dedicated DC program; small-market state" },
  SD: { score: 55, program: "No corporate income tax (structural benefit); no dedicated DC exemption" },
  DE: { score: 35, program: "No sales tax (structural benefit); no dedicated DC program" },
  WV: { score: 45, program: "W.Va. Code § 11-15-9m: DC sales-tax exemption (2022); $2M capex" },
  HI: { score: 25, program: "No DC-specific program; energy costs high" },
  AK: { score: 25, program: "No DC-specific program; remote market" },
  DC: { score: 30, program: "Data Centers Investment Act (2020) — but very limited land supply" },
};

const FLOOR_SCORE = 10; // states not listed still receive baseline business-climate score

export async function ingestStateIncentives(): Promise<{ countiesUpdated: number; statesMapped: number }> {
  const rows = sqlite
    .prepare("SELECT fips, state FROM counties")
    .all() as { fips: string; state: string }[];

  const stmt = sqlite.prepare(
    "UPDATE counties SET tax_incentive_score = ? WHERE fips = ?",
  );

  let updated = 0;
  const seenStates = new Set<string>();
  const tx = sqlite.transaction((records: { fips: string; state: string }[]) => {
    for (const r of records) {
      const meta = STATE_INCENTIVES[r.state];
      const score = meta ? meta.score : FLOOR_SCORE;
      seenStates.add(r.state);
      stmt.run(Math.round(score), r.fips);
      updated++;
    }
  });
  tx(rows);

  return { countiesUpdated: updated, statesMapped: seenStates.size };
}

// Export program metadata for downstream sourceHint building.
export function getStateProgram(state: string): { score: number; program: string } | undefined {
  return STATE_INCENTIVES[state];
}
