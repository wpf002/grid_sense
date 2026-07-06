/**
 * NOAA NCEI 1991-2020 Climate Normals — cooling factor ingest.
 *
 * Cooling is 30-40% of a data center's energy; free-cooling/economizer
 * potential swings PUE and opex enormously. This pipeline gives every county a
 * cooling-climate score from the authoritative NOAA normals:
 *   - annual Cooling Degree Days (CDD, base 65F) → cooling load (higher = worse)
 *   - annual Heating Degree Days (HDD)           → cold-climate free-cooling (higher = better)
 *
 * Method: map each county centroid to its nearest weather station that has
 * temperature normals, then pull that station's CDD/HDD.
 *
 * Sources (all free, no token):
 *  - Station coordinates: NOAA GHCN daily station inventory (ghcnd-stations.txt)
 *  - Stations with normals: NCEI 1991-2020 annual/seasonal access index
 *  - CDD/HDD values: NCEI Access Data Service (dataset=normals-annualseasonal)
 *
 * v2 upgrade (see docs/DATA_FEEDS_ROADMAP.md): derive true airside/waterside
 * free-cooling HOURS from hourly ISD-Lite dry-bulb + dewpoint.
 */
import { sqlite } from "../storage.js";
import { beginRun, fetchText, fetchJson } from "./util.js";
import { coolingScoreFromDegreeDays } from "../scoring.js";

const GHCND_STATIONS = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt";
const NORMALS_INDEX = "https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/";
const ACCESS_DATA = "https://www.ncei.noaa.gov/access/services/data/v1";
const WEEK_MS = 7 * 24 * 3600 * 1000;

interface Station {
  id: string;
  lat: number;
  lng: number;
}

// Cheap planar approximation of distance — adequate for nearest-station, avoids
// 47M trig calls. Longitude is scaled by cos(lat) so degrees are comparable.
function approxDist2(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * Math.cos((aLat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

function nearest(lat: number, lng: number, stations: Station[]): Station | null {
  let best: Station | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = approxDist2(lat, lng, s.lat, s.lng);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

async function fetchNormals(
  stationIds: string[],
): Promise<Map<string, { cdd: number; hdd: number }>> {
  const out = new Map<string, { cdd: number; hdd: number }>();
  const BATCH = 100;
  for (let i = 0; i < stationIds.length; i += BATCH) {
    const batch = stationIds.slice(i, i + BATCH);
    const url =
      `${ACCESS_DATA}?dataset=normals-annualseasonal&dataTypes=ANN-CLDD-NORMAL,ANN-HTDD-NORMAL` +
      `&stations=${batch.join(",")}&format=json`;
    try {
      const rows = await fetchJson<any[]>(url, {
        cacheKey: `noaa_normals_${i}_${batch.length}.json`,
        maxAgeMs: WEEK_MS,
      });
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const cdd = parseFloat(r["ANN-CLDD-NORMAL"]);
        const hdd = parseFloat(r["ANN-HTDD-NORMAL"]);
        if (r.STATION && Number.isFinite(cdd) && cdd >= 0) {
          out.set(r.STATION, { cdd, hdd: Number.isFinite(hdd) && hdd >= 0 ? hdd : 0 });
        }
      }
    } catch (e) {
      console.warn(`[noaa_climate] normals batch ${i} failed:`, (e as Error).message);
    }
  }
  return out;
}

export async function ingestNoaaClimate(): Promise<{ updated: number; stations: number }> {
  const run = beginRun("noaa_climate", "NOAA NCEI 1991-2020 Climate Normals (CDD/HDD)");
  try {
    // 1. Station coordinates (GHCN daily inventory, fixed-width). US only.
    const ghcnd = await fetchText(GHCND_STATIONS, { cacheKey: "ghcnd-stations.txt", maxAgeMs: 30 * WEEK_MS });
    const coords = new Map<string, { lat: number; lng: number }>();
    for (const line of ghcnd.split("\n")) {
      if (line.length < 31) continue;
      const id = line.slice(0, 11).trim();
      if (!id.startsWith("US")) continue; // continental coverage
      const lat = parseFloat(line.slice(12, 20));
      const lng = parseFloat(line.slice(21, 30));
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords.set(id, { lat, lng });
    }

    // 2. Which stations have 1991-2020 normals.
    const idx = await fetchText(NORMALS_INDEX, { cacheKey: "noaa_normals_index.html", maxAgeMs: 30 * WEEK_MS });
    const normalsIds = new Set<string>();
    for (const m of idx.matchAll(/href="([A-Z]{2}[A-Z0-9]{9})\.csv"/g)) normalsIds.add(m[1]);

    // Stations that have both coords and normals.
    const stations: Station[] = [];
    for (const id of normalsIds) {
      const c = coords.get(id);
      if (c) stations.push({ id, lat: c.lat, lng: c.lng });
    }
    if (stations.length === 0) throw new Error("no US normals stations with coordinates");

    // 3. Counties → nearest station (round 1).
    const counties = sqlite
      .prepare("SELECT fips, lat, lng FROM counties WHERE lat IS NOT NULL AND lng IS NOT NULL")
      .all() as Array<{ fips: string; lat: number; lng: number }>;
    const round1 = new Map<string, string>(); // fips -> stationId
    const needed = new Set<string>();
    for (const c of counties) {
      const s = nearest(c.lat, c.lng, stations);
      if (s) {
        round1.set(c.fips, s.id);
        needed.add(s.id);
      }
    }

    // 4. Fetch CDD/HDD for the distinct nearest stations.
    const normals = await fetchNormals([...needed]);

    // Stations that actually returned temperature normals, with coords — used
    // to reassign counties whose nearest station had only precip normals.
    const validStations: Station[] = stations.filter((s) => normals.has(s.id));
    if (validStations.length === 0) throw new Error("no stations returned CDD/HDD normals");

    // 5. Assign each county to a station with real data, compute score, update.
    const upd = sqlite.prepare(
      "UPDATE counties SET cooling_degree_days = ?, heating_degree_days = ?, cooling_score = ?, updated_at = ? WHERE fips = ?",
    );
    const now = new Date().toISOString();
    let updated = 0;
    const txn = sqlite.transaction(() => {
      for (const c of counties) {
        let sid = round1.get(c.fips);
        let dd = sid ? normals.get(sid) : undefined;
        if (!dd) {
          const s = nearest(c.lat, c.lng, validStations);
          if (s) dd = normals.get(s.id);
        }
        if (!dd) continue;
        const score = coolingScoreFromDegreeDays(dd.cdd, dd.hdd);
        upd.run(dd.cdd, dd.hdd, score, now, c.fips);
        updated++;
      }
    });
    txn();

    run.complete(updated, `${validStations.length} stations · ${updated} counties`);
    return { updated, stations: validStations.length };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestNoaaClimate()
    .then((r) => { console.log("[noaa_climate]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
