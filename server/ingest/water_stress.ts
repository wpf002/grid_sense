/**
 * Water rights / adjudicated basins overlay — Gap 3.
 *
 * For each state, we score water stress on a 0–1 scale (higher = worse) using
 * a combination of:
 *   1. USGS national assessment findings (adjudicated / over-allocated / rationed status)
 *   2. Interstate compact/Colorado River basin membership (indicates severe scarcity)
 *   3. Snake River / Ogallala aquifer decline flag
 *   4. State-level water permit moratoriums for large industrial users
 *
 * Then joined per-county to counties table for use in scoring.
 *
 * Sources:
 *  - USGS Circular 1524 (Estimated Use of Water in the US 2020, released 2024)
 *  - Congressional Research Service — "Interstate Water Compacts and the Supreme Court"
 *  - State PSC / DEQ / water resource dept moratorium notices
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

// Curated state water-stress index. 0-1 continuous.
// stress_score derived from: USGS 2020 water use + adjudication status + moratorium presence.
// Higher = worse for a data-center site (harder to get big new water rights).
// Sources cited in per-state notes; values fixed to be reproducible.
interface StateWater {
  state: string;
  stress_score: number; // 0-1
  adjudicated: boolean; // basin fully adjudicated (permitted water is capped)
  moratorium: boolean; // state or key basin has active new-use moratorium
  colorado_river_basin: boolean;
  ogallala_dependent: boolean;
  notes: string;
  source_url: string;
}

const STATE_WATER: StateWater[] = [
  // Extreme stress — Colorado River basin + adjudicated
  { state: "AZ", stress_score: 0.95, adjudicated: true, moratorium: true, colorado_river_basin: true, ogallala_dependent: false, notes: "General Stream Adjudication ongoing since 1974; Colorado River shortage; Buckeye/Queen Creek limits", source_url: "https://new.azwater.gov/adjudications" },
  { state: "NV", stress_score: 0.95, adjudicated: true, moratorium: true, colorado_river_basin: true, ogallala_dependent: false, notes: "Southern Nevada — Colorado River allocation cut; Clark County water restrictions", source_url: "https://water.nv.gov/" },
  { state: "CA", stress_score: 0.9, adjudicated: true, moratorium: false, colorado_river_basin: true, ogallala_dependent: false, notes: "SGMA (2014) triggered basin adjudications statewide; Colorado River user", source_url: "https://water.ca.gov/programs/groundwater-management/sgma-groundwater-management" },
  { state: "UT", stress_score: 0.85, adjudicated: true, moratorium: false, colorado_river_basin: true, ogallala_dependent: false, notes: "Prior appropriation; Colorado River basin; Great Salt Lake collapse", source_url: "https://waterrights.utah.gov/" },
  { state: "CO", stress_score: 0.85, adjudicated: true, moratorium: false, colorado_river_basin: true, ogallala_dependent: false, notes: "Prior appropriation; Colorado River compact obligations; Front Range demand", source_url: "https://dwr.colorado.gov/" },
  { state: "NM", stress_score: 0.85, adjudicated: true, moratorium: false, colorado_river_basin: true, ogallala_dependent: true, notes: "General stream adjudications; Rio Grande compact; Ogallala decline", source_url: "https://www.ose.state.nm.us/" },
  { state: "WY", stress_score: 0.7, adjudicated: true, moratorium: false, colorado_river_basin: true, ogallala_dependent: false, notes: "Colorado River basin; low absolute usage but strict prior appropriation", source_url: "https://sites.google.com/wyo.gov/wyoseo/" },

  // High stress — Ogallala aquifer states
  { state: "TX", stress_score: 0.75, adjudicated: false, moratorium: true, colorado_river_basin: false, ogallala_dependent: true, notes: "Ogallala decline; Rio Grande compact; Groundwater Conservation District permit caps in Panhandle & Central TX; ERCOT drought curtailments", source_url: "https://www.twdb.texas.gov/" },
  { state: "OK", stress_score: 0.7, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: true, notes: "Ogallala decline in Panhandle; OWRB manages", source_url: "https://oklahoma.gov/owrb.html" },
  { state: "KS", stress_score: 0.75, adjudicated: false, moratorium: true, colorado_river_basin: false, ogallala_dependent: true, notes: "Ogallala critical; several GMDs have voluntary + mandatory pump-back rules", source_url: "https://agriculture.ks.gov/divisions-programs/dwr" },
  { state: "NE", stress_score: 0.6, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: true, notes: "Ogallala; Republican River compact", source_url: "https://dnr.nebraska.gov/water/" },
  { state: "SD", stress_score: 0.55, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: true, notes: "Ogallala partial; general moderate stress", source_url: "https://danr.sd.gov/" },

  // High stress — arid non-Colorado states
  { state: "ID", stress_score: 0.65, adjudicated: true, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Snake River Basin Adjudication (SRBA) completed 2014; aquifer decline", source_url: "https://idwr.idaho.gov/" },
  { state: "OR", stress_score: 0.55, adjudicated: false, moratorium: true, colorado_river_basin: false, ogallala_dependent: false, notes: "Eastern OR moratoriums on new groundwater; Klamath basin conflict", source_url: "https://www.oregon.gov/owrd/" },
  { state: "WA", stress_score: 0.45, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Prior appropriation; Yakima basin restrictions; Puget Sound rural moratoriums", source_url: "https://ecology.wa.gov/water-shorelines" },
  { state: "MT", stress_score: 0.5, adjudicated: true, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Statewide general adjudication ongoing since 1979; Yellowstone compact", source_url: "https://dnrc.mt.gov/Water-Resources/" },

  // Moderate stress — Southwest / south-central
  { state: "FL", stress_score: 0.55, adjudicated: false, moratorium: true, colorado_river_basin: false, ogallala_dependent: false, notes: "Water Management Districts limit CUP renewals; SW FL & Tampa Bay tight", source_url: "https://floridadep.gov/water" },
  { state: "GA", stress_score: 0.45, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "ACF basin litigation with AL/FL; metro ATL constrained", source_url: "https://epd.georgia.gov/watershed-protection-branch" },
  { state: "AL", stress_score: 0.35, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "ACF/ACT basin issues but relatively wet", source_url: "https://www.adem.alabama.gov/" },
  { state: "SC", stress_score: 0.3, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Modest stress in Coastal Plain aquifer", source_url: "https://scdhec.gov/" },
  { state: "NC", stress_score: 0.3, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Central Coastal Capacity Use Area; otherwise fine", source_url: "https://www.deq.nc.gov/" },
  { state: "VA", stress_score: 0.3, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Eastern VA Groundwater Management Area permit caps (matters for Loudoun/PWC hyperscalers)", source_url: "https://www.deq.virginia.gov/water" },
  { state: "MD", stress_score: 0.25, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Some Piedmont aquifer stress", source_url: "https://mde.maryland.gov/programs/water/" },

  // Water-rich states
  { state: "OH", stress_score: 0.15, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Great Lakes; Compact restricts large diversions but plenty for in-basin DC use", source_url: "https://ohiodnr.gov/discover-and-learn/land-water/water" },
  { state: "IN", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Riparian; SW Indiana carbonate aquifer OK", source_url: "https://www.in.gov/dnr/water/" },
  { state: "IL", stress_score: 0.25, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Cambrian-Ordovician aquifer decline in NE IL — Lake Michigan mitigates", source_url: "https://www2.illinois.gov/dnr/WaterResources/" },
  { state: "MI", stress_score: 0.1, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Great Lakes basin — abundant", source_url: "https://www.michigan.gov/egle/about/organization/water-resources" },
  { state: "WI", stress_score: 0.15, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Great Lakes basin; some SE WI arsenic issues", source_url: "https://dnr.wisconsin.gov/topic/Water" },
  { state: "MN", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Great Lakes + prairie aquifers; White Bear Lake stress", source_url: "https://www.dnr.state.mn.us/waters/index.html" },
  { state: "PA", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Susquehanna River Basin Commission permit required", source_url: "https://www.srbc.gov/" },
  { state: "NY", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Riparian; upstate abundant, NYC watershed protected", source_url: "https://www.dec.ny.gov/lands/26561.html" },
  { state: "TN", stress_score: 0.25, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Middle TN karst; western Memphis aquifer OK", source_url: "https://www.tn.gov/environment.html" },
  { state: "KY", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Ohio River + karst; abundant", source_url: "https://eec.ky.gov/Environmental-Protection/Water" },
  { state: "IA", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Alluvial + Jordan aquifers; permit required over 25k gpd", source_url: "https://www.iowadnr.gov/" },
  { state: "MO", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Riparian in E MO; more strict in W (Ozark aquifer)", source_url: "https://dnr.mo.gov/water" },
  { state: "AR", stress_score: 0.35, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Alluvial aquifer decline in ag areas; permit needed", source_url: "https://www.agriculture.arkansas.gov/natural-resources/" },
  { state: "LA", stress_score: 0.3, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Sparta aquifer decline; otherwise abundant surface water", source_url: "https://www.doa.la.gov/doa/dnr/" },
  { state: "MS", stress_score: 0.35, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "MS River alluvial aquifer; ongoing MS v TN groundwater dispute", source_url: "https://www.mdeq.ms.gov/" },
  { state: "WV", stress_score: 0.15, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Abundant surface water", source_url: "https://dep.wv.gov/WWE/Pages/default.htm" },
  { state: "ND", stress_score: 0.4, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Missouri basin; growing oil & ag competition", source_url: "https://www.swc.nd.gov/" },
  { state: "MA", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Riparian; DCR sub-basin balances", source_url: "https://www.mass.gov/orgs/massachusetts-department-of-environmental-protection" },
  { state: "CT", stress_score: 0.2, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Riparian; some fully allocated basins", source_url: "https://portal.ct.gov/DEEP" },
  { state: "NJ", stress_score: 0.35, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Coastal Plain aquifer allocation issues", source_url: "https://www.nj.gov/dep/watersupply/" },
  { state: "DE", stress_score: 0.3, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Piedmont/Coastal Plain aquifer stress", source_url: "https://dnrec.delaware.gov/water/" },
  { state: "ME", stress_score: 0.1, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Abundant", source_url: "https://www.maine.gov/dep/water/" },
  { state: "VT", stress_score: 0.1, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Abundant", source_url: "https://dec.vermont.gov/watershed" },
  { state: "NH", stress_score: 0.1, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Abundant", source_url: "https://www.des.nh.gov/water" },
  { state: "RI", stress_score: 0.15, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Small state; Providence area regulated", source_url: "https://dem.ri.gov/" },
  { state: "AK", stress_score: 0.05, adjudicated: false, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Effectively unlimited surface water outside urban core", source_url: "https://dnr.alaska.gov/mlw/water/" },
  { state: "HI", stress_score: 0.6, adjudicated: true, moratorium: false, colorado_river_basin: false, ogallala_dependent: false, notes: "Public trust water code; islands' aquifers over-allocated", source_url: "https://dlnr.hawaii.gov/cwrm/" },
];

export async function ingestWaterStress(): Promise<{ inserted: number }> {
  const run = beginRun("water_stress");
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS state_water_stress (
        state TEXT PRIMARY KEY,
        stress_score REAL NOT NULL,
        adjudicated INTEGER NOT NULL,
        moratorium INTEGER NOT NULL,
        colorado_river_basin INTEGER NOT NULL,
        ogallala_dependent INTEGER NOT NULL,
        notes TEXT NOT NULL,
        source_url TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM state_water_stress").run();
    const stmt = sqlite.prepare(`
      INSERT INTO state_water_stress
        (state, stress_score, adjudicated, moratorium, colorado_river_basin, ogallala_dependent, notes, source_url, updated_at)
      VALUES (@state, @stress_score, @adjudicated, @moratorium, @colorado_river_basin, @ogallala_dependent, @notes, @source_url, @updated_at)
    `);

    let inserted = 0;
    const tx = sqlite.transaction(() => {
      for (const s of STATE_WATER) {
        stmt.run({
          ...s,
          adjudicated: s.adjudicated ? 1 : 0,
          moratorium: s.moratorium ? 1 : 0,
          colorado_river_basin: s.colorado_river_basin ? 1 : 0,
          ogallala_dependent: s.ogallala_dependent ? 1 : 0,
          updated_at: now,
        });
        inserted++;
      }
    });
    tx();

    run.complete(inserted, `${inserted} states loaded`);
    return { inserted };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

export function waterStressForState(state: string) {
  const row = sqlite.prepare(`SELECT * FROM state_water_stress WHERE state = ?`).get(state) as any;
  if (!row) return null;
  return {
    state: row.state,
    stressScore: row.stress_score,
    adjudicated: !!row.adjudicated,
    moratorium: !!row.moratorium,
    coloradoRiverBasin: !!row.colorado_river_basin,
    ogallalaDependent: !!row.ogallala_dependent,
    notes: row.notes,
    sourceUrl: row.source_url,
    updatedAt: row.updated_at,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestWaterStress().then((r) => {
    console.log(`[water_stress] wrote ${r.inserted} rows`);
    process.exit(0);
  });
}
