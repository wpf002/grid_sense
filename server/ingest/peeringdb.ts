// server/ingest/peeringdb.ts
//
// Source: PeeringDB public API — https://www.peeringdb.com/api/fac
// License: PeeringDB data is publicly available; no API key required for
//          unauthenticated GET requests (rate-limited, cached ~15min).
//
// Approach:
//   1. Fetch all US facilities (fac endpoint) with country=US.
//      Each facility has lat/lng + ix_count (number of internet exchanges
//      hosted at that facility) + net_count (peering networks present).
//   2. For each of our 626 tracked counties, count facilities within a
//      metro-scale radius (~40 miles / 65 km) and weight by ix_count.
//   3. Store: peering_exchange_count = count of nearby facilities that
//      host at least one IX.
//
// This maps directly to the "cluster adjacency" / "peering density" signal
// that hyperscalers use when choosing metros — you can't put an AI cluster
// where there's no fiber neighborhood or exchange to peer with.

import { sqlite } from "../storage.js";
import { fetchJson } from "./util.js";

const PEERINGDB_URL = "https://www.peeringdb.com/api/fac?country=US";
const RADIUS_MILES = 40;

type PdbFacility = {
  id: number;
  name: string;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  ix_count: number;
  net_count: number;
  status: string;
};

type PdbResponse = { data: PdbFacility[] };

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function ingestPeeringDb(): Promise<{
  countiesUpdated: number;
  facilitiesLoaded: number;
  countiesWithIx: number;
}> {
  console.log("[peeringdb] Fetching US facilities from PeeringDB…");
  const body = await fetchJson<PdbResponse>(PEERINGDB_URL, { timeoutMs: 60_000 });
  const allFacs = body.data ?? [];
  // Keep only geolocated, operational facilities.
  const facs = allFacs.filter(
    (f) =>
      f.status === "ok" &&
      f.latitude !== null &&
      f.longitude !== null &&
      Math.abs(f.latitude!) > 0.1 &&
      Math.abs(f.longitude!) > 0.1,
  );
  console.log(`[peeringdb] Loaded ${facs.length} geolocated US facilities (of ${allFacs.length})`);

  // Load county coordinates.
  const counties = sqlite
    .prepare("SELECT fips, lat, lng FROM counties")
    .all() as { fips: string; lat: number; lng: number }[];

  const stmt = sqlite.prepare(
    "UPDATE counties SET peering_exchange_count = ? WHERE fips = ?",
  );

  let updated = 0;
  let withIx = 0;

  const tx = sqlite.transaction((rows: typeof counties) => {
    for (const c of rows) {
      let ixWeightedCount = 0;
      let facCount = 0;
      for (const f of facs) {
        const d = haversineMiles(c.lat, c.lng, f.latitude!, f.longitude!);
        if (d <= RADIUS_MILES) {
          facCount++;
          // Weight: facilities that host at least one IX contribute ix_count
          // (a hub campus with 8 IXes scores 8x a single-IX site);
          // facilities with zero IX still contribute 0.5 as carrier-hotel
          // proxy (dense fiber = better peering opportunity).
          if (f.ix_count > 0) ixWeightedCount += f.ix_count;
          else ixWeightedCount += 0.5;
        }
      }
      // Store the raw IX-weighted count; scoring layer will normalize.
      // Cap at 200 to keep the column bounded.
      const stored = Math.min(200, ixWeightedCount);
      stmt.run(stored, c.fips);
      updated++;
      if (stored > 0) withIx++;
      if (facCount > 0) {
        // Optional debug for hot metros
      }
    }
  });
  tx(counties);

  console.log(
    `[peeringdb] Updated ${updated} counties, ${withIx} have at least one nearby IX facility`,
  );
  return { countiesUpdated: updated, facilitiesLoaded: facs.length, countiesWithIx: withIx };
}
