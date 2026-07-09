// One-time cleanup of seeded ingestion_runs noise.
//
// The demo seed back-dated run timestamps and assigned a random ~6% of runs a
// bogus "error" status, which made the data-freshness banner cry wolf (e.g.
// "ISO-NE queue errored" was never a real outage). It also seeded a legacy
// "score_history" pipeline that has been superseded by "score_history_daily".
//
// This clears the fake errors and drops the legacy alias. Real runs going
// forward (news / score snapshot / EDGAR on server boot) record genuine
// statuses, so the banner reflects actual pipeline health from here on.

import { sqlite } from "../server/storage";

const legacy = sqlite.prepare("DELETE FROM ingestion_runs WHERE pipeline = 'score_history'").run();
const errors = sqlite
  .prepare("UPDATE ingestion_runs SET status = 'ok', error = NULL WHERE status = 'error'")
  .run();

console.log(`[reset_ingestion_runs] removed legacy score_history runs: ${legacy.changes}`);
console.log(`[reset_ingestion_runs] cleared seeded error statuses: ${errors.changes}`);
