// Seed permit tracker + competitive bid intel for top counties.
// Permits: rezoning/building/electrical permits filed at the county level.
// Bids: competitive activity signals (LOIs, RFPs, options).
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.join(process.cwd(), "data.db"));

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  county_fips TEXT NOT NULL,
  permit_type TEXT NOT NULL,      -- 'rezoning' | 'building' | 'electrical' | 'water'
  applicant TEXT,                  -- LLC or entity name
  resolved_operator TEXT,          -- Meta / Google / etc if matched
  parcel_apn TEXT,                 -- optional link to parcels.apn
  filed_date TEXT NOT NULL,
  status TEXT NOT NULL,            -- 'filed' | 'under_review' | 'approved' | 'denied' | 'appealed'
  megawatts REAL,                  -- for electrical permits, requested load
  acres REAL,                       -- for rezoning
  description TEXT,
  source_url TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')*1000)
);
CREATE INDEX IF NOT EXISTS idx_permits_fips ON permits(county_fips);
CREATE INDEX IF NOT EXISTS idx_permits_filed ON permits(filed_date DESC);
CREATE INDEX IF NOT EXISTS idx_permits_operator ON permits(resolved_operator);

CREATE TABLE IF NOT EXISTS competitive_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  county_fips TEXT NOT NULL,
  operator TEXT NOT NULL,          -- interested operator
  stage TEXT NOT NULL,             -- 'sniffing' | 'loi' | 'option' | 'under_contract' | 'closed' | 'walked'
  megawatts REAL,                  -- estimated site size
  observed_date TEXT NOT NULL,
  source TEXT,                     -- how we detected it
  source_url TEXT,
  confidence REAL DEFAULT 0.6,     -- 0-1 signal quality
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')*1000)
);
CREATE INDEX IF NOT EXISTS idx_bids_fips ON competitive_bids(county_fips);
CREATE INDEX IF NOT EXISTS idx_bids_operator ON competitive_bids(operator);
CREATE INDEX IF NOT EXISTS idx_bids_stage ON competitive_bids(stage);
CREATE INDEX IF NOT EXISTS idx_bids_date ON competitive_bids(observed_date DESC);
`);

// Get top counties + their shell activity from parcels
const topCounties = db.prepare(`
  SELECT c.fips, c.name, c.state, c.landing_probability AS score
  FROM counties c
  WHERE c.landing_probability >= 40
  ORDER BY c.landing_probability DESC
  LIMIT 100
`).all() as Array<{ fips: string; name: string; state: string; score: number }>;

const OPERATORS = ["Meta", "Google", "Amazon", "Microsoft", "OpenAI/Stargate", "xAI", "Oracle", "Digital Realty", "Equinix", "QTS", "CoreWeave", "CyrusOne"];
const PERMIT_TYPES = ["rezoning", "building", "electrical", "water"] as const;
const PERMIT_STATUSES = ["filed", "under_review", "approved", "denied", "appealed"] as const;
const BID_STAGES = ["sniffing", "loi", "option", "under_contract", "closed", "walked"] as const;

function rand<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randRange(lo: number, hi: number): number { return lo + Math.random() * (hi - lo); }
function randInt(lo: number, hi: number): number { return Math.floor(randRange(lo, hi + 1)); }
function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400 * 1000).toISOString().slice(0, 10);
}

const insertPermit = db.prepare(`
  INSERT INTO permits (county_fips, permit_type, applicant, resolved_operator, parcel_apn, filed_date, status, megawatts, acres, description, source_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertBid = db.prepare(`
  INSERT INTO competitive_bids (county_fips, operator, stage, megawatts, observed_date, source, source_url, confidence, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const existingPermits = new Set(
  (db.prepare("SELECT DISTINCT county_fips FROM permits").all() as any[]).map((r) => r.county_fips)
);
const existingBids = new Set(
  (db.prepare("SELECT DISTINCT county_fips FROM competitive_bids").all() as any[]).map((r) => r.county_fips)
);

const permitsTx = db.transaction(() => {
  let inserted = 0;
  for (const c of topCounties) {
    if (existingPermits.has(c.fips)) continue;

    // Pull parcels for this county
    const parcels = db.prepare(`
      SELECT apn, owner_name, resolved_operator, acres, owner_is_shell_llc
      FROM parcels WHERE county_fips = ?
    `).all(c.fips) as any[];

    // Number of permits scales with score
    const permitCount = c.score >= 75 ? randInt(3, 7) : c.score >= 60 ? randInt(2, 5) : randInt(1, 3);

    for (let i = 0; i < permitCount; i++) {
      const permitType = rand(PERMIT_TYPES);
      // 60% of the time, tie permit to an actual parcel from parcels table
      const useParcel = parcels.length > 0 && Math.random() < 0.6;
      const parcel = useParcel ? rand(parcels) : null;

      const applicant = parcel?.owner_name ?? `${["Piedmont", "Ridgewood", "Cardinal", "Sunbelt", "Ironwood"][randInt(0, 4)]} Development LLC`;
      const operator = parcel?.resolved_operator ?? (Math.random() < 0.15 ? rand(OPERATORS) : null);
      const filedDate = daysAgo(randInt(1, 540));
      // Recent permits skew toward under_review/approved; old ones skew approved/denied
      const daysSinceFile = Math.floor((Date.now() - new Date(filedDate).getTime()) / (86400 * 1000));
      const status = daysSinceFile < 30 ? rand(["filed", "under_review"] as const)
        : daysSinceFile < 180 ? rand(["under_review", "approved", "denied"] as const)
        : rand(PERMIT_STATUSES);

      const megawatts = permitType === "electrical" ? Math.round(randRange(50, 500)) : null;
      const acres = permitType === "rezoning" && parcel?.acres ? parcel.acres : (permitType === "rezoning" ? Math.round(randRange(80, 1200)) : null);

      const desc = permitType === "rezoning" ? `Rezone ${acres} ac from Agricultural/RA to Heavy Industrial / Utility Overlay for data center use`
        : permitType === "building" ? `Construction of ${randInt(1, 4)}-building data center campus, ${randInt(200000, 1400000).toLocaleString()} sqft total`
        : permitType === "electrical" ? `Substation interconnection agreement: ${megawatts} MW load addition`
        : `Water withdrawal permit: ${randInt(1, 8).toFixed(1)} MGD cooling makeup for hyperscale campus`;

      const sourceUrl = `https://gis.${c.state.toLowerCase()}.gov/permits/${c.fips}/${1000 + i}`;

      insertPermit.run(
        c.fips, permitType, applicant, operator, parcel?.apn ?? null,
        filedDate, status, megawatts, acres, desc, sourceUrl
      );
      inserted++;
    }
  }
  console.log(`[seed_permits] Inserted ${inserted} permits across new counties.`);
});
permitsTx();

const bidsTx = db.transaction(() => {
  let inserted = 0;
  for (const c of topCounties) {
    if (existingBids.has(c.fips)) continue;

    // Higher score → more competitive interest
    const bidCount = c.score >= 80 ? randInt(3, 6) : c.score >= 65 ? randInt(2, 4) : randInt(1, 2);

    // Which operators are here? Bias by score band
    const activeOps = new Set<string>();
    for (let i = 0; i < bidCount; i++) {
      let op: string;
      do { op = rand(OPERATORS); } while (activeOps.has(op) && activeOps.size < OPERATORS.length);
      activeOps.add(op);

      const stage = c.score >= 80 ? rand(["loi", "option", "under_contract", "closed"] as const)
        : c.score >= 60 ? rand(["sniffing", "loi", "option", "walked"] as const)
        : rand(["sniffing", "walked"] as const);

      const megawatts = stage === "closed" || stage === "under_contract" ? Math.round(randRange(150, 800))
        : Math.round(randRange(50, 500));

      const observedDate = daysAgo(randInt(3, 400));
      const sources = ["SEC 8-K", "shell LLC filing", "brokerage rumor", "site visit observation", "utility filing", "county planning agenda", "local press"];
      const source = rand(sources);

      const confidence = stage === "closed" ? 0.95
        : stage === "under_contract" ? 0.85
        : stage === "option" ? 0.75
        : stage === "loi" ? 0.65
        : stage === "sniffing" ? 0.45
        : 0.55;

      const notes = stage === "walked" ? `Passed after ${randInt(1, 6)}-month diligence — likely water/transmission blocker`
        : stage === "closed" ? `Deal closed; ${megawatts} MW planned load`
        : stage === "under_contract" ? `Option exercised; expected close in ${randInt(2, 8)} months`
        : stage === "option" ? `${randInt(60, 270)}-day option filed`
        : stage === "loi" ? "Letter of intent signed with land owner"
        : "Preliminary site tours and utility outreach";

      const sourceUrl = source === "SEC 8-K" ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${randInt(100000, 999999)}`
        : source === "county planning agenda" ? `https://gis.${c.state.toLowerCase()}.gov/planning/${c.fips}`
        : null;

      insertBid.run(
        c.fips, op, stage, megawatts, observedDate, source, sourceUrl, Number(confidence.toFixed(2)), notes
      );
      inserted++;
    }
  }
  console.log(`[seed_bids] Inserted ${inserted} competitive bid rows across new counties.`);
});
bidsTx();

const pn = db.prepare("SELECT COUNT(*) AS n FROM permits").get() as { n: number };
const bn = db.prepare("SELECT COUNT(*) AS n FROM competitive_bids").get() as { n: number };
console.log(`[seed] permits=${pn.n} competitive_bids=${bn.n}`);
db.close();
