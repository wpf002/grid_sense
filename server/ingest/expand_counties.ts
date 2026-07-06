// Expand the tracked-counties table by adding the top queue-MW counties that
// are not yet tracked. Uses the Census 2023 gazetteer for lat/lng centroids.
// Runs after ISO queue pipelines so we score every county that shows real
// data-center-scale grid demand.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../storage.js";
import { beginRun, FIPS_TO_STATE } from "./util.js";

const GAZ_PATH = join(process.cwd(), "data/ref/2023_Gaz_counties_national.txt");

interface Centroid {
  fips: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
}

let CENTROIDS: Map<string, Centroid> | null = null;

function loadCentroids(): Map<string, Centroid> {
  if (CENTROIDS) return CENTROIDS;
  const raw = readFileSync(GAZ_PATH, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const map = new Map<string, Centroid>();
  for (let i = 1; i < lines.length; i++) {
    // Tab-separated
    const parts = lines[i].split("\t").map((s) => s.trim());
    if (parts.length < 10) continue;
    const [usps, geoid, , name, , , , , lat, lng] = parts;
    if (!geoid || !lat || !lng) continue;
    map.set(geoid, {
      fips: geoid,
      name,
      state: usps,
      lat: Number(lat),
      lng: Number(lng),
    });
  }
  CENTROIDS = map;
  return map;
}

export function expandTrackedCounties(topN: number = 200): number {
  const run = beginRun("expand_counties", `Add top ${topN} untracked queue-MW counties`);
  try {
    const centroids = loadCentroids();
    // Top untracked counties by summed queue MW
    const rows = sqlite
      .prepare(
        `
        SELECT r.fips as fips, SUM(r.mw) as queue_mw, COUNT(*) as projects
        FROM raw_iso_queue r
        WHERE r.fips IS NOT NULL
          AND r.mw IS NOT NULL
          AND r.fips NOT IN (SELECT fips FROM counties)
        GROUP BY r.fips
        ORDER BY queue_mw DESC
        LIMIT ?
      `,
      )
      .all(topN) as Array<{ fips: string; queue_mw: number; projects: number }>;

    const insert = sqlite.prepare(`
      INSERT OR IGNORE INTO counties
        (fips, name, state, lat, lng, iso, queued_load_mw,
         onsite_generation_friendly, fiber_density_score, peering_exchange_count,
         large_parcel_count, floodplain_pct_block, hazard_score, water_stress_score,
         tax_incentive_score, moratorium_status, right_to_build_zoning,
         existing_dc_count, existing_dc_capacity_mw, landing_probability, score_tier, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 'none', 0, 0, 0, 0, 'cold', ?)
    `);
    // Determine ISO from raw_iso_queue majority
    const isoStmt = sqlite.prepare(
      `SELECT iso, COUNT(*) as c FROM raw_iso_queue WHERE fips = ? GROUP BY iso ORDER BY c DESC LIMIT 1`,
    );
    const now = new Date().toISOString().slice(0, 10);

    let added = 0;
    const tx = sqlite.transaction(() => {
      for (const r of rows) {
        const c = centroids.get(r.fips);
        if (!c) continue;
        const isoRow = isoStmt.get(r.fips) as { iso: string } | undefined;
        insert.run(
          r.fips,
          c.name.replace(/\s+County$/i, "").replace(/\s+Parish$/i, ""),
          c.state,
          c.lat,
          c.lng,
          isoRow?.iso ?? null,
          r.queue_mw,
          now,
        );
        added++;
      }
    });
    tx();
    run.complete(added, `Added ${added} counties (of ${rows.length} top candidates)`);
    return added;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = process.argv[2] ? parseInt(process.argv[2], 10) : 200;
  const added = expandTrackedCounties(n);
  console.log(`Added ${added} counties`);
  process.exit(0);
}
// Silence unused-warning
void FIPS_TO_STATE;
