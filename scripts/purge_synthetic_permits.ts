// Purge fabricated (seed) permits. Real permits carry genuine source URLs from
// county/city open-data portals (ArcGIS FeatureServers, Socrata, fairfaxcounty.gov,
// austintexas.gov, data.cityofchicago.org, ...). Seed permits from
// scripts/seed_permits_bids.ts use invented URLs of the form
// "https://permits.<state>.gov/lookup/<fips>/<n>". We delete exactly those.

import { sqlite } from "../server/storage";

const PATTERN = "source_url LIKE 'https://permits.%.gov/lookup/%'";

const before = (sqlite.prepare("SELECT COUNT(*) n FROM permits").get() as { n: number }).n;
const synthetic = (sqlite.prepare(`SELECT COUNT(*) n FROM permits WHERE ${PATTERN}`).get() as { n: number }).n;
const del = sqlite.prepare(`DELETE FROM permits WHERE ${PATTERN}`).run();
const after = (sqlite.prepare("SELECT COUNT(*) n FROM permits").get() as { n: number }).n;
const counties = (sqlite.prepare("SELECT COUNT(DISTINCT county_fips) n FROM permits").get() as { n: number }).n;

console.log(`[purge] synthetic permits matched: ${synthetic}`);
console.log(`[purge] permits ${before} -> ${after} (deleted ${del.changes})`);
console.log(`[purge] remaining permits span ${counties} real counties`);
