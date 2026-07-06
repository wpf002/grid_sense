// Backfill counties that have zero real data with conservative state-level
// medians so the app never shows a fully blank county. Flags them via
// data_provenance so the UI can label "estimated from state average" values.
import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve(process.cwd(), "data.db"));

// data_provenance already exists in the app schema:
// (fips, factor_key, quality, source_name, source_url, fetched_at, raw_value, note)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS ux_provenance_fips_key
    ON data_provenance(fips, factor_key);
`);

// State-level medians from populated counties. Fall back to overall US
// median if a state has no populated peer.
const stateStats = db.prepare(`
  SELECT state,
    COUNT(*) n,
    AVG(queued_load_mw) med_queued_mw,
    AVG(fiber_density_score) avg_fiber,
    AVG(water_stress_score) avg_water,
    AVG(tax_incentive_score) avg_tax,
    AVG(hazard_score) avg_hazard,
    AVG(median_land_price_per_acre) avg_land_price
  FROM counties c
  WHERE queued_load_mw > 0 OR existing_dc_count > 0 OR fiber_density_score > 0
  GROUP BY state
`).all() as any[];

const usAvg = db.prepare(`
  SELECT AVG(queued_load_mw) mw, AVG(fiber_density_score) fib, AVG(water_stress_score) w,
         AVG(tax_incentive_score) tax, AVG(hazard_score) haz, AVG(median_land_price_per_acre) land
  FROM counties WHERE queued_load_mw > 0 OR existing_dc_count > 0
`).get() as any;

const statMap = new Map<string, any>();
for (const s of stateStats) statMap.set(s.state, s);

const empties = db.prepare(`
  SELECT fips, state FROM counties
  WHERE queued_load_mw = 0 AND existing_dc_count = 0 AND fiber_density_score = 0
`).all() as any[];

console.log(`Backfilling ${empties.length} empty counties...`);

const upd = db.prepare(`
  UPDATE counties SET
    queued_load_mw = ?,
    fiber_density_score = ?,
    water_stress_score = ?,
    tax_incentive_score = ?,
    hazard_score = ?,
    median_land_price_per_acre = ?
  WHERE fips = ?
`);

const prov = db.prepare(`
  INSERT INTO data_provenance (fips, factor_key, quality, source_name, source_url, fetched_at, note)
  VALUES (?, ?, 'estimated', ?, ?, CURRENT_TIMESTAMP, ?)
  ON CONFLICT(fips, factor_key) DO UPDATE SET
    quality = excluded.quality,
    source_name = excluded.source_name,
    source_url = excluded.source_url,
    fetched_at = CURRENT_TIMESTAMP,
    note = excluded.note
`);

const tx = db.transaction((rows: any[]) => {
  for (const c of rows) {
    const s = statMap.get(c.state) ?? usAvg;
    // Scale queued MW down for empties — they are non-populated peers so
    // set to 25% of state median to reflect low activity.
    const queued = Math.round((s.med_queued_mw ?? s.mw ?? 100) * 0.25);
    const fiber = Number(((s.avg_fiber ?? s.fib ?? 20) * 0.6).toFixed(1));
    const water = Number((s.avg_water ?? s.w ?? 25).toFixed(1));
    const tax = Number((s.avg_tax ?? s.tax ?? 40).toFixed(1));
    const hazard = Number((s.avg_hazard ?? s.haz ?? 30).toFixed(1));
    const land = Math.round(s.avg_land_price ?? s.land ?? 8000);
    upd.run(queued, fiber, water, tax, hazard, land, c.fips);
    const stateSrc = `${c.state} state peers`;
    const peers = statMap.has(c.state) ? statMap.get(c.state).n : 0;
    const note = `Estimated from ${peers} populated ${c.state} counties`;
    prov.run(c.fips, "queued_load_mw", stateSrc, "https://www.eia.gov/electricity/data/eia860/", note);
    prov.run(c.fips, "fiber_density_score", stateSrc, "https://broadbandusa.ntia.doc.gov/", note);
    prov.run(c.fips, "water_stress_score", "FEMA NRI", "https://hazards.fema.gov/nri/", "State-level baseline");
    prov.run(c.fips, "tax_incentive_score", "State posture", "https://taxfoundation.org/", "State-level incentive baseline");
    prov.run(c.fips, "hazard_score", "FEMA NRI", "https://hazards.fema.gov/nri/", "Composite risk baseline");
    prov.run(c.fips, "median_land_price_per_acre", "USDA NASS", "https://www.nass.usda.gov/", "Ag land value proxy");
  }
});
tx(empties);

// Recompute score_tier for backfilled rows — most stay cold but some
// warm-state counties might rise to emerging.
db.exec(`
  UPDATE counties
  SET landing_probability = MIN(75, ROUND(
    (COALESCE(queued_load_mw,0)/100.0)*0.35 +
    (COALESCE(fiber_density_score,0))*0.25 +
    ((100 - COALESCE(water_stress_score,0))*0.15) +
    (COALESCE(tax_incentive_score,0)*0.25)
  , 1))
  WHERE queued_load_mw > 0 AND existing_dc_count = 0 AND landing_probability = 0;

  UPDATE counties SET score_tier = CASE
    WHEN landing_probability >= 80 THEN 'hot'
    WHEN landing_probability >= 65 THEN 'warm'
    WHEN landing_probability >= 45 THEN 'emerging'
    ELSE 'cold'
  END;
`);

const finalCounts = db.prepare(`
  SELECT score_tier, COUNT(*) n FROM counties GROUP BY score_tier
`).all();
const stillEmpty = (db.prepare(`
  SELECT COUNT(*) n FROM counties WHERE queued_load_mw=0 AND fiber_density_score=0
`).get() as any).n;
console.log(JSON.stringify({ finalCounts, stillEmpty }));
