// HIFLD Electric Power Transmission Lines - per-county aggregate.
//
// Source: NETL Energy Transition Atlas (a HIFLD mirror, since the primary
// HIFLD Open portal shut down in August 2025).
//   https://arcgis.netl.doe.gov/server/rest/services/Hosted/Energy_Transition_Atlas_493d6/FeatureServer/18
//
// 94,216 transmission-line segments nationwide with owner, voltage (kV),
// voltage class ("<100", "100-161", "220-287", "345", "500", "735 and up"),
// and endpoint substation names. For scoring we only care about the
// per-county aggregate:
//   - total km of transmission crossing the county
//   - max voltage anywhere in the county
//   - km by voltage class (used as a proxy for transmission density)
//
// v2.0 - initial implementation.

import proj4 from "proj4";
import { sqlite } from "../storage.js";
import { fetchJson, nowIso, sleep, beginRun } from "./util.js";

const NETL_URL =
  "https://arcgis.netl.doe.gov/server/rest/services/Hosted/Energy_Transition_Atlas_493d6/FeatureServer/18/query";

// Web Mercator (3857) to WGS84 (4326)
proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs");

type LineFeature = {
  attributes: {
    objectid: number;
    voltage: number | null;
    volt_class: string | null;
    owner: string | null;
    status: string | null;
    sub_1: string | null;
    sub_2: string | null;
    SHAPE__Length: number; // meters in web mercator... but that's inflated at high lat. We'll re-project.
  };
  geometry: {
    paths: [number, number][][];
  };
};

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transmission_county_agg (
      fips TEXT PRIMARY KEY,
      total_km REAL NOT NULL,
      max_voltage_kv REAL,
      km_lt_100 REAL DEFAULT 0,
      km_100_161 REAL DEFAULT 0,
      km_220_287 REAL DEFAULT 0,
      km_345 REAL DEFAULT 0,
      km_500 REAL DEFAULT 0,
      km_735_up REAL DEFAULT 0,
      segment_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// Compute distance in km along a projected polyline (input meters in EPSG:3857).
// Convert each segment to WGS84 and use Haversine so we're not fooled by mercator stretch.
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function polylineKm(paths: [number, number][][]): number {
  let total = 0;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = proj4("EPSG:3857", "EPSG:4326", path[i - 1] as any) as [number, number];
      const b = proj4("EPSG:3857", "EPSG:4326", path[i] as any) as [number, number];
      total += haversineKm(a, b);
    }
  }
  return total;
}

// Bounding box test in WGS84
function polylineIntersectsBbox(
  paths: [number, number][][],
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  for (const path of paths) {
    for (const p of path) {
      const [lng, lat] = proj4("EPSG:3857", "EPSG:4326", p as any) as [number, number];
      if (lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng) return true;
    }
  }
  return false;
}

// Approximate county bounding box from lat/lng center and typical county radius.
// County median area is ~1,600 sq mi ~= 40mi radius, but many are smaller. We use
// a ~35 km radius which corresponds to ~0.32° lat and ~0.32°/cos(lat) lon.
// For scoring we want "does transmission touch this county" — a 35km buffer is
// conservative in the right direction (a substation just outside the county line
// is still valuable).
function countyBbox(lat: number, lng: number) {
  const dLat = 35 / 111;
  const dLng = 35 / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}

async function fetchLinesForBbox(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): Promise<LineFeature[]> {
  const url =
    NETL_URL +
    `?where=status%3D%27IN+SERVICE%27` +
    `&outFields=objectid,voltage,volt_class,owner,status,sub_1,sub_2,SHAPE__Length` +
    `&returnGeometry=true&outSR=3857` +
    `&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects` +
    `&geometry=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}` +
    `&inSR=4326&f=json&resultRecordCount=2000`;
  const data = (await fetchJson(url, {
    cacheKey: `hifld_lines_${bbox.minLat.toFixed(2)}_${bbox.minLng.toFixed(2)}.json`,
    maxAgeMs: 1000 * 60 * 60 * 24 * 90, // 90 day cache
  })) as any;
  return (data?.features ?? []) as LineFeature[];
}

function voltageBucket(voltClass: string | null, voltage: number | null): keyof Buckets {
  const v = voltage ?? 0;
  if (v >= 735) return "km_735_up";
  if (v >= 500) return "km_500";
  if (v >= 345) return "km_345";
  if (v >= 220) return "km_220_287";
  if (v >= 100) return "km_100_161";
  if (v > 0) return "km_lt_100";
  // Fall back to voltage class string
  const c = (voltClass ?? "").trim();
  if (c === "735 AND UP" || c === "735 and up") return "km_735_up";
  if (c === "500" || c === "500 KV") return "km_500";
  if (c === "345" || c === "345 KV") return "km_345";
  if (c.includes("220") || c.includes("287")) return "km_220_287";
  if (c.includes("100") || c.includes("161")) return "km_100_161";
  return "km_lt_100";
}

type Buckets = {
  km_lt_100: number;
  km_100_161: number;
  km_220_287: number;
  km_345: number;
  km_500: number;
  km_735_up: number;
};

export async function ingestHifldTransmission(): Promise<{
  countiesProcessed: number;
  totalSegments: number;
  countiesWithLines: number;
}> {
  const run = beginRun("hifld_transmission", "HIFLD electric transmission lines (per-county aggregate)");
  try {
  ensureTable();

  const counties = sqlite
    .prepare("SELECT fips, lat, lng, name, state FROM counties WHERE lat IS NOT NULL AND lng IS NOT NULL")
    .all() as { fips: string; lat: number; lng: number; name: string; state: string }[];

  const upsert = sqlite.prepare(`
    INSERT INTO transmission_county_agg
      (fips, total_km, max_voltage_kv, km_lt_100, km_100_161, km_220_287, km_345, km_500, km_735_up, segment_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fips) DO UPDATE SET
      total_km = excluded.total_km,
      max_voltage_kv = excluded.max_voltage_kv,
      km_lt_100 = excluded.km_lt_100,
      km_100_161 = excluded.km_100_161,
      km_220_287 = excluded.km_220_287,
      km_345 = excluded.km_345,
      km_500 = excluded.km_500,
      km_735_up = excluded.km_735_up,
      segment_count = excluded.segment_count,
      updated_at = excluded.updated_at
  `);

  const ts = nowIso();
  let totalSegments = 0;
  let countiesWithLines = 0;
  let processed = 0;

  // Parallelize in batches of 6 - NETL ArcGIS handles bursts fine and the
  // 626-county run drops from ~40 min to ~7 min.
  const BATCH = 6;
  async function processCounty(c: typeof counties[0]) {
    const bbox = countyBbox(c.lat, c.lng);
    let lines: LineFeature[] = [];
    try {
      lines = await fetchLinesForBbox(bbox);
    } catch (e: any) {
      console.warn(`[hifld] ${c.name} ${c.state} failed: ${e.message}`);
      return;
    }

    const buckets: Buckets = {
      km_lt_100: 0, km_100_161: 0, km_220_287: 0, km_345: 0, km_500: 0, km_735_up: 0,
    };
    let maxKv = 0;
    let segCount = 0;

    for (const line of lines) {
      if (!polylineIntersectsBbox(line.geometry.paths, bbox)) continue;
      const km = polylineKm(line.geometry.paths);
      const key = voltageBucket(line.attributes.volt_class, line.attributes.voltage);
      buckets[key] += km;
      const kv = line.attributes.voltage ?? 0;
      if (kv > maxKv) maxKv = kv;
      segCount++;
    }

    const totalKm = Object.values(buckets).reduce((a, b) => a + b, 0);
    upsert.run(
      c.fips, totalKm, maxKv || null,
      buckets.km_lt_100, buckets.km_100_161, buckets.km_220_287,
      buckets.km_345, buckets.km_500, buckets.km_735_up,
      segCount, ts,
    );

    totalSegments += segCount;
    if (segCount > 0) countiesWithLines++;
  }

  for (let i = 0; i < counties.length; i += BATCH) {
    const slice = counties.slice(i, i + BATCH);
    await Promise.all(slice.map(processCounty));
    processed += slice.length;
    if (processed % 30 === 0 || processed >= counties.length) {
      console.log(`[hifld] ${processed}/${counties.length} counties · ${totalSegments} segments · ${countiesWithLines} with lines`);
    }
    await sleep(80);
  }

  console.log(`[hifld] Done: ${processed} counties, ${totalSegments} segments, ${countiesWithLines} with lines`);
    run.complete(processed, `${countiesWithLines} counties with lines · ${totalSegments} segments`);
    return { countiesProcessed: processed, totalSegments, countiesWithLines };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

/**
 * Fetch transmission lines within a bounding box for the map viewport.
 * Used by the /api/transmission?bbox=... endpoint.
 */
export async function transmissionLinesInBbox(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): Promise<{
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
    properties: { owner: string | null; voltage: number | null; voltClass: string | null; sub1: string | null; sub2: string | null };
  }[];
}> {
  const lines = await fetchLinesForBbox(bbox);
  const features = lines.map((line) => {
    const paths = line.geometry.paths.map((path) =>
      path.map((pt) => proj4("EPSG:3857", "EPSG:4326", pt as any) as [number, number]),
    );
    const geom =
      paths.length === 1
        ? { type: "LineString" as const, coordinates: paths[0] }
        : { type: "MultiLineString" as const, coordinates: paths };
    return {
      type: "Feature" as const,
      geometry: geom,
      properties: {
        owner: line.attributes.owner,
        voltage: line.attributes.voltage,
        voltClass: line.attributes.volt_class,
        sub1: line.attributes.sub_1,
        sub2: line.attributes.sub_2,
      },
    };
  });
  return { type: "FeatureCollection", features };
}

export function transmissionAggForCounty(fips: string) {
  try {
    const row = sqlite
      .prepare("SELECT * FROM transmission_county_agg WHERE fips = ?")
      .get(fips) as any;
    if (!row) return null;
    return {
      totalKm: row.total_km,
      maxVoltageKv: row.max_voltage_kv,
      segmentCount: row.segment_count,
      byClass: {
        "<100kV": row.km_lt_100,
        "100-161kV": row.km_100_161,
        "220-287kV": row.km_220_287,
        "345kV": row.km_345,
        "500kV": row.km_500,
        "735kV+": row.km_735_up,
      },
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}
