/**
 * OSM parcel & zoning inspector (Gap 6 + Gap 8, scaffolds Gap 15).
 *
 * We use the free Overpass API to fetch OpenStreetMap features that are
 * effective proxies for the paid Regrid parcel dataset. For each county
 * centroid we grab:
 *   - Industrial landuse polygons (landuse=industrial)
 *   - Commercial landuse polygons (landuse=commercial)
 *   - Brownfield polygons (landuse=brownfield)
 *   - Substations (power=substation)
 *   - Building footprints tagged industrial/warehouse over some minimum size
 *
 * This gives a broker/analyst enough to eyeball where the ready-to-develop
 * inventory actually sits inside a county. It is NOT a replacement for
 * Regrid, but it's the best you can get for free.
 *
 * Results are cached for 30 days per county to be gentle on Overpass.
 */
import { sqlite } from "../storage.js";
import { fetchJson } from "./util.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CACHE_DAYS = 30;

interface ParcelInspection {
  fips: string;
  industrial_polygons: number;
  industrial_acres: number;
  commercial_polygons: number;
  commercial_acres: number;
  brownfield_polygons: number;
  brownfield_acres: number;
  substations: number;
  large_industrial_buildings: number;
  features: Array<{
    id: string;
    type: "industrial" | "commercial" | "brownfield" | "substation" | "industrial_building";
    acres: number | null;
    lat: number;
    lng: number;
    name: string | null;
    tags: Record<string, string>;
  }>;
  fetched_at: string;
}

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS osm_county_inspection (
      fips TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}

// Very rough shoelace formula for polygon area in acres from WGS84 coords.
function polygonAcres(coords: Array<[number, number]>): number {
  if (coords.length < 3) return 0;
  const R = 6378137; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  const [lng0, lat0] = coords[0];
  const project = ([lng, lat]: [number, number]) => {
    const x = R * toRad(lng - lng0) * Math.cos(toRad(lat0));
    const y = R * toRad(lat - lat0);
    return [x, y];
  };
  const pts = coords.map(project);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  const m2 = Math.abs(area / 2);
  return m2 / 4046.8564224; // m² → acres
}

export async function inspectCounty(fips: string, forceRefresh = false): Promise<ParcelInspection | null> {
  ensureTable();
  if (!forceRefresh) {
    const cached = sqlite
      .prepare(`SELECT payload, fetched_at FROM osm_county_inspection WHERE fips = ?`)
      .get(fips) as any;
    if (cached) {
      const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86400000;
      if (ageDays < CACHE_DAYS) return JSON.parse(cached.payload);
    }
  }

  const county = sqlite
    .prepare("SELECT fips, name, state, lat, lng FROM counties WHERE fips = ?")
    .get(fips) as any;
  if (!county || county.lat == null || county.lng == null) return null;

  // ~15km search radius around county centroid. Data centers cluster near
  // the county seat; a tighter radius keeps Overpass fast.
  const radiusM = 15_000;
  const q = `
    [out:json][timeout:60];
    (
      way["landuse"~"industrial|commercial|brownfield"](around:${radiusM},${county.lat},${county.lng});
      node["power"="substation"](around:${radiusM},${county.lat},${county.lng});
      way["power"="substation"](around:${radiusM},${county.lat},${county.lng});
      way["building"~"industrial|warehouse"]["building:levels"](around:${radiusM},${county.lat},${county.lng});
    );
    out geom tags 500;
  `;

  let raw: any;
  try {
    raw = await fetchJson<any>(`${OVERPASS_URL}?data=${encodeURIComponent(q)}`, {
      cacheKey: `osm_inspect_${fips}`,
      timeoutMs: 90_000,
    });
  } catch (err) {
    console.error(`[osm_parcels] overpass failed for ${fips}:`, err);
    return null;
  }

  const inspection: ParcelInspection = {
    fips,
    industrial_polygons: 0,
    industrial_acres: 0,
    commercial_polygons: 0,
    commercial_acres: 0,
    brownfield_polygons: 0,
    brownfield_acres: 0,
    substations: 0,
    large_industrial_buildings: 0,
    features: [],
    fetched_at: new Date().toISOString(),
  };

  const els = Array.isArray(raw?.elements) ? raw.elements : [];
  for (const el of els) {
    const tags = (el.tags ?? {}) as Record<string, string>;
    const geom = el.geometry as Array<{ lat: number; lon: number }> | undefined;
    const lat = el.type === "node" ? el.lat : geom?.[0]?.lat;
    const lng = el.type === "node" ? el.lon : geom?.[0]?.lon;
    if (lat == null || lng == null) continue;
    const coords: Array<[number, number]> = geom ? geom.map((g) => [g.lon, g.lat]) : [];
    const acres = coords.length >= 3 ? polygonAcres(coords) : null;

    if (tags.landuse === "industrial") {
      inspection.industrial_polygons++;
      inspection.industrial_acres += acres ?? 0;
      inspection.features.push({
        id: `${el.type}/${el.id}`,
        type: "industrial",
        acres,
        lat,
        lng,
        name: tags.name ?? null,
        tags,
      });
    } else if (tags.landuse === "commercial") {
      inspection.commercial_polygons++;
      inspection.commercial_acres += acres ?? 0;
      inspection.features.push({
        id: `${el.type}/${el.id}`,
        type: "commercial",
        acres,
        lat,
        lng,
        name: tags.name ?? null,
        tags,
      });
    } else if (tags.landuse === "brownfield") {
      inspection.brownfield_polygons++;
      inspection.brownfield_acres += acres ?? 0;
      inspection.features.push({
        id: `${el.type}/${el.id}`,
        type: "brownfield",
        acres,
        lat,
        lng,
        name: tags.name ?? null,
        tags,
      });
    } else if (tags.power === "substation") {
      inspection.substations++;
      inspection.features.push({
        id: `${el.type}/${el.id}`,
        type: "substation",
        acres,
        lat,
        lng,
        name: tags.name ?? null,
        tags,
      });
    } else if (tags.building === "industrial" || tags.building === "warehouse") {
      // Only count if large — 2+ acres footprint.
      if (acres && acres >= 2) {
        inspection.large_industrial_buildings++;
        inspection.features.push({
          id: `${el.type}/${el.id}`,
          type: "industrial_building",
          acres,
          lat,
          lng,
          name: tags.name ?? null,
          tags,
        });
      }
    }
  }

  // Round numeric fields for cleaner UI display.
  inspection.industrial_acres = Math.round(inspection.industrial_acres);
  inspection.commercial_acres = Math.round(inspection.commercial_acres);
  inspection.brownfield_acres = Math.round(inspection.brownfield_acres);

  sqlite
    .prepare(
      `INSERT INTO osm_county_inspection (fips, payload, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(fips) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(fips, JSON.stringify(inspection), inspection.fetched_at);

  return inspection;
}
