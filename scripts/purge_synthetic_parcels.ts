// Purge fabricated (seed) parcels so counties without a real assessor feed show
// "no parcel data" instead of invented owners/APNs.
//
// Real parcels come ONLY from server/ingest/arcgis_parcels.ts (county assessor
// ArcGIS FeatureServers). Any parcel in a county NOT in that config is seed data
// (scripts/seed_parcels.ts / seed_site_intel.ts, APNs like "56-025-3660-80").
// We delete exactly those.

import { sqlite } from "../server/storage";
import fs from "node:fs";

const src = fs.readFileSync("server/ingest/arcgis_parcels.ts", "utf8");
const realFips = [...src.matchAll(/fips:\s*"(\d{5})"/g)].map((m) => m[1]);
const uniqueReal = [...new Set(realFips)];
const placeholders = uniqueReal.map(() => "?").join(",");

const before = (sqlite.prepare("SELECT COUNT(*) n FROM parcels").get() as { n: number }).n;
const del = sqlite
  .prepare(`DELETE FROM parcels WHERE county_fips NOT IN (${placeholders})`)
  .run(...uniqueReal);
const after = (sqlite.prepare("SELECT COUNT(*) n FROM parcels").get() as { n: number }).n;
const counties = (sqlite.prepare("SELECT COUNT(DISTINCT county_fips) n FROM parcels").get() as { n: number }).n;

console.log(`[purge] real assessor-feed counties: ${uniqueReal.length}`);
console.log(`[purge] parcels ${before} -> ${after} (deleted ${del.changes} synthetic)`);
console.log(`[purge] remaining parcels span ${counties} real counties`);
