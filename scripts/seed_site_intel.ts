/**
 * Seed site-level intel: parcels, permits, competitive_bids
 * Target: every emerging+ county has ≥ 3 parcels, ≥ 3 permits, ≥ 2 bids
 *
 * Uses deterministic pseudo-random derived from FIPS so re-runs produce same data.
 */
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = new Database(path.join(__dirname, "..", "data.db"));

// Deterministic hash → 0-1 float
function h(seed: string, salt = 0): number {
  let x = salt;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) | 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % 100000) / 100000;
}
function pick<T>(seed: string, salt: number, arr: T[]): T {
  return arr[Math.floor(h(seed, salt) * arr.length)];
}
function num(seed: string, salt: number, min: number, max: number): number {
  return min + h(seed, salt) * (max - min);
}
function iso(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400_000);
  return d.toISOString().slice(0, 10);
}

// Get all emerging+ counties
const counties = db.prepare(`
  SELECT fips, name, state, score_tier, landing_probability
  FROM counties
  WHERE score_tier IN ('hot','warm','emerging')
  ORDER BY landing_probability DESC
`).all() as { fips: string; name: string; state: string; score_tier: string; landing_probability: number }[];

console.log(`Target counties: ${counties.length}`);

// Operator pool + shell LLCs
const OPS = [
  { name: "Meta", shells: ["Greater Kudu LLC","Raven Northbrook LLC","Sidecat LLC","Siculus LLC","Starbelt LLC","Beehive LLC","Yonaguni LLC"] },
  { name: "Google", shells: ["Sharka LLC","Jet Stream LLC","Jasmine Development LLC","Sokka LLC","Zuko LLC"] },
  { name: "Amazon", shells: ["Vadata Inc","Vandalay Industries LLC","Amazon Data Services LLC","Cypress Bayou LLC","Immedia Semiconductor LLC"] },
  { name: "Microsoft", shells: ["Project Firecracker LLC","Project Agate LLC","Project Yoga LLC","Project Pine LLC","Project Bailey LLC","Project Buffalo LLC","LYH03 LLC"] },
  { name: "OpenAI/Stargate", shells: ["Lancium LLC","Stargate Holdings LLC"] },
  { name: "xAI/Colossus", shells: ["X.AI Corp","Colossus Holdings LLC"] },
  { name: "Oracle", shells: ["Oracle Cloud Infrastructure LLC"] },
  { name: "Digital Realty", shells: ["Digital 220 Data Centers LLC","DRT Holdings LLC"] },
  { name: "Equinix", shells: ["Equinix (US) LLC","EQX Holdings LLC"] },
  { name: "QTS", shells: ["QTS Data Centers LLC","Blackstone QTS Holdings LLC"] },
  { name: "CyrusOne", shells: ["CyrusOne LP","KKR/GIP CyrusOne LLC"] },
  { name: "CoreWeave", shells: ["CoreWeave Data Centers LLC"] },
  { name: "Vantage", shells: ["Vantage Data Centers LLC"] },
  { name: "Aligned", shells: ["Aligned Data Centers LLC"] },
  { name: "Stack", shells: ["Stack Infrastructure LLC"] },
  { name: "Compass", shells: ["Compass Datacenters LLC"] },
];

const ZONING = ["M-1 Industrial","M-2 Heavy Industrial","I-1 Light Industrial","I-2 Industrial","PUD","Agricultural (rezone pending)","B-3 Commercial","M-P Manufacturing Park"];
const PERMIT_TYPES = ["rezoning","building","electrical","water"];
const PERMIT_STATUS = ["filed","under_review","approved","denied","appealed"];
const BID_STAGES = ["sniffing","loi","option","under_contract","closed","walked"];
const BID_SOURCES = ["SEC 8-K filing","county assessor record","planning commission agenda","industry rumor","local news","DCD article","utility interconnect queue","property records"];

// Wipe existing seeded data (keep the ux ones intact)
db.exec("DELETE FROM parcels; DELETE FROM permits; DELETE FROM competitive_bids;");

const insParcel = db.prepare(`
  INSERT INTO parcels (county_fips, apn, acres, owner_name, owner_is_shell_llc, resolved_operator,
    substation_distance_mi, fiber_distance_mi, zoning, land_price, last_transfer_date, parcel_score, status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const insPermit = db.prepare(`
  INSERT INTO permits (county_fips, permit_type, applicant, resolved_operator, parcel_apn, filed_date, status, megawatts, acres, description, source_url)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);
const insBid = db.prepare(`
  INSERT INTO competitive_bids (county_fips, operator, stage, megawatts, observed_date, source, source_url, confidence, notes)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

let pCount = 0, permCount = 0, bidCount = 0;

const tx = db.transaction(() => {
  for (const c of counties) {
    // Count scales with tier
    const parcelsN = c.score_tier === "hot" ? 8 : c.score_tier === "warm" ? 5 : 3;
    const permitsN = c.score_tier === "hot" ? 6 : c.score_tier === "warm" ? 4 : 3;
    const bidsN    = c.score_tier === "hot" ? 5 : c.score_tier === "warm" ? 3 : 2;

    // Parcels
    for (let i = 0; i < parcelsN; i++) {
      const isShell = h(c.fips, 10+i) > 0.4;  // Most parcels have shell LLC ownership in hot markets
      const op = isShell ? pick(c.fips, 20+i, OPS) : null;
      const owner = isShell && op ? pick(c.fips, 30+i, op.shells) : `${pick(c.fips, 40+i, ["Legacy Holdings","Family Trust","Farm Estates","Regional Partners","Southland Investors"])} ${(i+1)}`;
      const acres = Math.round(num(c.fips, 50+i, 40, 800));
      const subDist = +(num(c.fips, 60+i, 0.2, 4.5)).toFixed(2);
      const fiberDist = +(num(c.fips, 70+i, 0.1, 3.2)).toFixed(2);
      const pricePerAcre = Math.round(num(c.fips, 80+i, 8_000, 65_000) / 1000) * 1000;
      const landPrice = Math.round(acres * pricePerAcre);
      const status = isShell ? pick(c.fips, 90+i, ["watch","assembling","rezoning","announced"]) : "watch";
      const score = Math.round(num(c.fips, 100+i, isShell ? 55 : 30, isShell ? 92 : 65));
      const apn = `${c.fips.slice(0,2)}-${c.fips.slice(2)}-${String(1000 + Math.floor(h(c.fips, 110+i)*8999)).padStart(4,"0")}-${String(Math.floor(h(c.fips, 120+i)*99)).padStart(2,"0")}`;
      const daysAgo = Math.floor(num(c.fips, 130+i, 30, 720));
      insParcel.run(c.fips, apn, acres, owner, isShell ? 1 : 0, op?.name ?? null, subDist, fiberDist, pick(c.fips, 140+i, ZONING), landPrice, iso(daysAgo), score, status);
      pCount++;
    }

    // Permits
    for (let i = 0; i < permitsN; i++) {
      const isOp = h(c.fips, 200+i) > 0.35;
      const op = isOp ? pick(c.fips, 210+i, OPS) : null;
      const applicant = op ? pick(c.fips, 220+i, op.shells) : `${pick(c.fips, 230+i, ["Regional Development Group","Southland Builders","Metro Land Partners","AgriRealty LLC"])}`;
      const permitType = pick(c.fips, 240+i, PERMIT_TYPES);
      const status = pick(c.fips, 250+i, PERMIT_STATUS);
      const mw = permitType === "electrical" ? Math.round(num(c.fips, 260+i, 20, 500)) : null;
      const acres = permitType === "rezoning" ? Math.round(num(c.fips, 270+i, 80, 600)) : null;
      const daysAgo = Math.floor(num(c.fips, 280+i, 5, 400));
      const desc = permitType === "electrical" ? `${mw} MW industrial load interconnection`
        : permitType === "rezoning" ? `Rezone ${acres} acres from agricultural to industrial park`
        : permitType === "water" ? `Cooling water withdrawal permit, up to 2.5 MGD`
        : `Building permit — Class II data processing facility, ${Math.round(num(c.fips,290+i,100_000,500_000)).toLocaleString()} sq ft`;
      insPermit.run(c.fips, permitType, applicant, op?.name ?? null, null, iso(daysAgo), status, mw, acres, desc, `https://permits.${c.state.toLowerCase()}.gov/lookup/${c.fips}/${1000+i}`);
      permCount++;
    }

    // Competitive bids
    for (let i = 0; i < bidsN; i++) {
      const op = pick(c.fips, 300+i, OPS);
      const stage = pick(c.fips, 310+i, BID_STAGES);
      const mw = Math.round(num(c.fips, 320+i, 50, 1200));
      const daysAgo = Math.floor(num(c.fips, 330+i, 1, 180));
      const source = pick(c.fips, 340+i, BID_SOURCES);
      const confidence = +num(c.fips, 350+i, 0.45, 0.95).toFixed(2);
      const notes = `${op.name} observed at ${stage} stage — estimated ${mw} MW site, tracked via ${source.toLowerCase()}.`;
      insBid.run(c.fips, op.name, stage, mw, iso(daysAgo), source, `https://gridsense.internal/evidence/${c.fips}-${i}`, confidence, notes);
      bidCount++;
    }
  }
});

tx();

console.log(`Seeded parcels: ${pCount}`);
console.log(`Seeded permits: ${permCount}`);
console.log(`Seeded competitive bids: ${bidCount}`);
console.log(`Counties covered: ${counties.length}`);

const summary = db.prepare(`
  SELECT
    (SELECT COUNT(DISTINCT county_fips) FROM parcels) as parcel_counties,
    (SELECT COUNT(DISTINCT county_fips) FROM permits) as permit_counties,
    (SELECT COUNT(DISTINCT county_fips) FROM competitive_bids) as bid_counties
`).get();
console.log("Coverage:", summary);
