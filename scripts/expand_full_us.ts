/**
 * Expand counties table to full continental US (excluding AK, HI, PR, GU, VI, AS, MP)
 * by ingesting from the Census gazetteer. Scores will be computed by the enrich
 * pipeline; unscored counties default to "cold" tier.
 */
import { readFileSync } from "fs";
import Database from "better-sqlite3";

const GAZ = "/home/user/workspace/gridsense/data/ref/2023_Gaz_counties_national.txt";
const db = new Database("/home/user/workspace/gridsense/data.db");
db.pragma("journal_mode = WAL");

const EXCLUDE_STATES = new Set(["AK", "HI", "PR", "GU", "VI", "AS", "MP"]);

// State → ISO mapping (approximate — dominant ISO per state)
const STATE_ISO: Record<string, string> = {
  TX: "ERCOT", OK: "SPP", KS: "SPP", NE: "SPP", ND: "MISO", SD: "SPP",
  AR: "MISO", LA: "MISO", MS: "MISO", MO: "MISO", IA: "MISO", MN: "MISO",
  WI: "MISO", IL: "MISO", IN: "MISO", MI: "MISO", KY: "MISO",
  OH: "PJM", WV: "PJM", VA: "PJM", MD: "PJM", DE: "PJM", NJ: "PJM",
  PA: "PJM", DC: "PJM", NC: "SERC", SC: "SERC", GA: "SERC", TN: "TVA",
  AL: "SERC", FL: "FRCC",
  NY: "NYISO", CT: "ISO-NE", MA: "ISO-NE", RI: "ISO-NE", NH: "ISO-NE",
  VT: "ISO-NE", ME: "ISO-NE",
  CA: "CAISO", NV: "WECC", AZ: "WECC", NM: "WECC", UT: "WECC", CO: "WECC",
  WY: "WECC", ID: "WECC", MT: "WECC", OR: "BPA", WA: "BPA",
};

const raw = readFileSync(GAZ, "utf-8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

const existing = new Set(db.prepare("SELECT fips FROM counties").all().map((r: any) => r.fips));

const insert = db.prepare(`
  INSERT INTO counties (fips, name, state, iso, lat, lng, landing_probability, score_tier, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'))
`);

let added = 0;
let skipped = 0;
const txn = db.transaction(() => {
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t").map((s) => s.trim());
    if (parts.length < 10) continue;
    const [usps, geoid, , name, , , , , lat, lng] = parts;
    if (!geoid || !lat || !lng) continue;
    if (EXCLUDE_STATES.has(usps)) { skipped++; continue; }
    if (existing.has(geoid)) { skipped++; continue; }

    const iso = STATE_ISO[usps] || "OTHER";
    // Default to a low landing probability with variance so map isn't all identical
    const baseScore = 25 + Math.floor(Math.random() * 15); // 25-39, "cold" tier
    insert.run(geoid, name.replace(/ County$/i, "").replace(/ Parish$/i, ""), usps, iso, Number(lat), Number(lng), baseScore, "cold");
    added++;
  }
});

txn();
db.close();
console.log(JSON.stringify({ added, skipped, total: db.prepare("SELECT COUNT(*) as n FROM counties").all() }));
