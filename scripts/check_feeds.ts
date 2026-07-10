// Feed canary: did the pipelines that just ran actually return data?
//
// Upstream sources break quietly. A county assessor renames a field, an ISO
// moves an export behind a session cookie, a federal agency reshuffles a
// workbook — the ingest "succeeds" with 0 rows and nothing looks wrong until
// someone notices a factor has gone synthetic. This asserts a floor on each
// pipeline's most recent run and exits non-zero if a feed has gone dark.
//
// Thresholds are deliberately loose: they catch "returned nothing" and
// "returned a handful", not normal week-to-week variation.

import { sqlite } from "../server/storage.js";

/** Minimum rows the latest successful run of each pipeline should have produced. */
const MIN_ROWS: Record<string, number> = {
  dc_news: 1,
  edgar: 1,
  wholesale_price: 2,
  pjm_queue: 100,
  miso_queue: 100,
  ercot_queue: 100,
  spp_queue: 50,
  caiso_queue: 50,
  nyiso_queue: 50,
  isone_queue: 500,
  eia860: 100,
  fema_nri: 1000,
  arcgis_parcels: 1000,
  socrata_permits: 100,
};

// Sources that legitimately no-op: LBNL needs a hand-downloaded workbook that
// isn't in the repo, so a 0-row run on a cloud runner is expected, not a break.
const ALLOWED_ZERO = new Set(["lbnl_queue"]);

const pipelines = process.argv[2]?.split(",").filter(Boolean) ?? Object.keys(MIN_ROWS);

interface Row { status: string; rows: number | null; note: string | null; finished_at: number | null }

const failures: string[] = [];
const skipped: string[] = [];

for (const p of pipelines) {
  if (!(p in MIN_ROWS)) continue; // enrich, score_history etc. have no row floor
  const run = sqlite
    .prepare("SELECT status, rows, note, finished_at FROM ingestion_runs WHERE pipeline = ? ORDER BY id DESC LIMIT 1")
    .get(p) as Row | undefined;

  if (!run) { skipped.push(`${p}: never ran`); continue; }
  if (run.status !== "ok") { failures.push(`${p}: status=${run.status} — ${run.note ?? "no note"}`); continue; }

  const rows = run.rows ?? 0;
  if (rows === 0 && ALLOWED_ZERO.has(p)) { skipped.push(`${p}: 0 rows (expected — ${run.note ?? ""})`); continue; }
  if (rows < MIN_ROWS[p]) failures.push(`${p}: ${rows} rows, expected >= ${MIN_ROWS[p]}`);
  else console.log(`ok   ${p}: ${rows} rows`);
}

for (const s of skipped) console.log(`skip ${s}`);

if (failures.length) {
  console.error(`\nFEED CANARY FAILED — ${failures.length} pipeline(s) returned less data than expected:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nAn upstream source likely changed shape or went behind a gate.");
  process.exit(1);
}
console.log(`\nAll ${pipelines.length} checked feed(s) healthy.`);
