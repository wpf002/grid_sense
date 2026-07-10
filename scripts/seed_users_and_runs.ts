import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data.db"));
db.pragma("foreign_keys = ON");

const demoUsers = [
  "evan@wildacres.dev","mia@northgrid.co","jordan@parcelfx.io","priya@rowdyland.co","ben@heartlandsites.net",
  "sasha@apex-re.com","daniel@atlasdc.com","quinn@bluevoltage.io","kelsey@meadowridge.dev","marcus@kilogrid.com",
];
const insUser = db.prepare(`INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)`);
let uCount = 0;
for (const email of demoUsers) {
  const r = insUser.run(email, "$2a$10$demo.hash.no.real.login.only.for.admin.stats.filler");
  if (r.changes) uCount++;
}

// Every name here must correspond to a REAL ingest pipeline. "epa_ozone" used to
// be seeded but has no ingest behind it, so it only ever showed up on Data Health
// as a permanently-stale feed with no way to refresh it. Don't seed phantoms.
const sources = [
  "eia860","fema_nri","pjm_queue","miso_queue","ercot_queue","isone_queue","spp_queue","caiso_queue","nyiso_queue",
  "noaa_climate","sec_edgar","dc_news","enrich","score_history","expand_counties","overpass_parcels",
];
const insIng = db.prepare(
  `INSERT INTO ingestion_runs (pipeline, started_at, finished_at, status, rows) VALUES (?, ?, ?, ?, ?)`
);

let iCount = 0;
const nowMs = Date.now();
for (let d = 0; d < 30; d++) {
  for (const src of sources) {
    if (Math.random() < 0.4 && !["dc_news","sec_edgar","score_history","enrich"].includes(src)) continue;
    const startedAt = nowMs - d*86400_000 - Math.floor(Math.random()*3600_000);
    const duration = 5000 + Math.floor(Math.random()*180_000);
    const finished = startedAt + duration;
    const status = Math.random() < 0.94 ? "ok" : "error";
    const rows = status === "error" ? 0 : Math.floor(Math.random() * 5000) + 50;
    insIng.run(src, startedAt, finished, status, rows);
    iCount++;
  }
}

const totalUsers = (db.prepare("SELECT COUNT(*) c FROM users").get() as any).c;
const totalIng = (db.prepare("SELECT COUNT(*) c FROM ingestion_runs").get() as any).c;
console.log(JSON.stringify({ new_users: uCount, new_ingestion_runs: iCount, total_users: totalUsers, total_ingestion_runs: totalIng }));
