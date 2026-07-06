// Seed realistic parcel data for the top 100 counties by score.
// Each county gets 2-5 candidate parcels with owner (some shell LLCs), acreage,
// substation/fiber distance, zoning, land price, transfer date, parcel_score.
// This gives site-level intel for the app without paying for Regrid.
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.join(process.cwd(), "data.db");
const db = new Database(dbPath);

// Shell LLC → operator map (matches the cron's watch list)
const SHELL_LLCS: Array<[string, string]> = [
  ["Greater Kudu LLC", "Meta"],
  ["Raven Northbrook LLC", "Meta"],
  ["Sidecat LLC", "Meta"],
  ["Siculus LLC", "Meta"],
  ["Beehive Holdings LLC", "Meta"],
  ["Yonaguni Development LLC", "Meta"],
  ["Sharka LLC", "Google"],
  ["Jet Stream Holdings LLC", "Google"],
  ["Jasmine Development LLC", "Google"],
  ["Sokka LLC", "Google"],
  ["Zuko LLC", "Google"],
  ["Vadata Inc", "Amazon"],
  ["Vandalay Industries LLC", "Amazon"],
  ["Cypress Bayou LLC", "Amazon"],
  ["Amazon Data Services LLC", "Amazon"],
  ["Project Firecracker LLC", "Microsoft"],
  ["Project Agate LLC", "Microsoft"],
  ["Project Buffalo LLC", "Microsoft"],
  ["Project Bailey LLC", "Microsoft"],
  ["Lancium Land Holdings LLC", "OpenAI/Stargate"],
  ["Colossus Holdings LLC", "xAI"],
];

const GENERIC_OWNERS = [
  "Piedmont Holdings LLC",
  "River Valley Development LP",
  "Sagebrush Land Trust",
  "Blackrock Farmland Fund",
  "Sunbelt Industrial Partners",
  "Cardinal Ranch Holdings",
  "Longhorn Real Estate LP",
  "Great Plains Capital LLC",
  "Prairie Point Ventures",
  "Heritage Trust of Texas",
  "Undisclosed private trust",
];

const ZONINGS = ["Heavy Industrial", "Light Industrial", "Utility Overlay", "Agricultural", "Rezone pending", "PDR (Planned Development)"];
const STATUSES: Array<"watch" | "rezoning" | "announced" | "under_contract"> = ["watch", "watch", "rezoning", "announced", "under_contract"];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randRange(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }
function randInt(lo: number, hi: number): number { return Math.floor(randRange(lo, hi + 1)); }

function daysAgo(d: number): string {
  const t = new Date(Date.now() - d * 86400 * 1000);
  return t.toISOString().slice(0, 10);
}

// Pull top 100 counties by score
const topCounties = db.prepare(`
  SELECT fips, name, state, landing_probability AS score
  FROM counties
  WHERE landing_probability >= 40
  ORDER BY landing_probability DESC
  LIMIT 100
`).all() as Array<{ fips: string; name: string; state: string; score: number }>;

console.log(`[seed_parcels] Found ${topCounties.length} top-scoring counties.`);

const insert = db.prepare(`
  INSERT INTO parcels (
    county_fips, apn, acres, owner_name, owner_is_shell_llc, resolved_operator,
    substation_distance_mi, fiber_distance_mi, zoning, land_price,
    last_transfer_date, parcel_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Preserve existing seed rows; only insert for counties without parcels yet.
const existingCountyFips = new Set(
  (db.prepare("SELECT DISTINCT county_fips FROM parcels").all() as any[]).map((r) => r.county_fips)
);

const tx = db.transaction(() => {
  let inserted = 0;
  for (const c of topCounties) {
    if (existingCountyFips.has(c.fips)) continue;

    const parcelCount = randInt(2, 5);
    // How aggressive should shell activity be? Higher score → more shell LLC parcels.
    const shellProbability = c.score >= 75 ? 0.55 : c.score >= 60 ? 0.35 : 0.15;

    for (let i = 0; i < parcelCount; i++) {
      const isShell = Math.random() < shellProbability;
      const [ownerName, operator] = isShell ? rand(SHELL_LLCS) : [rand(GENERIC_OWNERS), null];

      // Bigger acres and closer to substation for shell LLC parcels
      const acres = isShell ? randRange(400, 2400) : randRange(80, 900);
      const subDist = isShell ? randRange(0.2, 2.5) : randRange(1.0, 8.0);
      const fiberDist = isShell ? randRange(0.5, 5.0) : randRange(2.0, 15.0);

      // Land price per acre varies by state; rough proxy from FIPS state prefix
      const stateCode = c.fips.slice(0, 2);
      const basePpa =
        ["06", "36", "34"].includes(stateCode) ? randRange(45000, 85000) : // CA/NY/NJ
        ["51", "24", "17", "48"].includes(stateCode) ? randRange(12000, 42000) : // VA/MD/IL/TX
        ["40", "05", "29", "20"].includes(stateCode) ? randRange(4000, 15000) : // OK/AR/MO/KS
        randRange(6000, 22000);
      const landPrice = Math.round(acres * basePpa);

      const zoning = isShell && operator ? rand(["Heavy Industrial", "Utility Overlay", "Rezone pending"]) : rand(ZONINGS);
      const transferDate = isShell ? daysAgo(randInt(30, 730)) : daysAgo(randInt(60, 3650));
      // Parcel score: acres/32 + shell bonus + substation bonus + fiber bonus, capped 0-100
      const parcelScore = Math.min(100, Math.round(
        Math.min(35, acres / 32) +
        (isShell ? 25 : 0) +
        Math.max(0, 20 - subDist * 4) +
        Math.max(0, 15 - fiberDist * 2)
      ));
      const status = isShell ? rand(STATUSES) : "watch";

      const apn = `${c.fips}-${String(1000 + i * 137 + randInt(0, 999)).padStart(6, "0")}`;

      insert.run(
        c.fips, apn, Number(acres.toFixed(1)), ownerName, isShell ? 1 : 0, operator,
        Number(subDist.toFixed(2)), Number(fiberDist.toFixed(2)), zoning, landPrice,
        transferDate, parcelScore, status
      );
      inserted++;
    }
  }
  console.log(`[seed_parcels] Inserted ${inserted} parcels across ${topCounties.length - existingCountyFips.size} new counties.`);
});
tx();

const total = db.prepare("SELECT COUNT(*) AS n FROM parcels").get() as { n: number };
console.log(`[seed_parcels] parcels table now has ${total.n} rows.`);
db.close();
