// Purge fabricated demo data.
//
// Two kinds of fabrication were seeded to make the app look populated:
//   1. Fake ingestion_runs — scripts/seed_users_and_runs.ts inserted ~320 rows
//      with Math.random() row counts and random ok/error status, spread over 30
//      days. Signature: note IS NULL AND error IS NULL (real successes always
//      carry a note via run.complete(); real failures always set `error`).
//   2. Demo users — 10 accounts with a placeholder password hash that can never
//      log in, seeded only to pad the Admin panel's user count.
//
// This removes both, leaving only real ingest history and the real admin user.
// Safe to re-run; it only ever deletes rows matching those exact signatures.

import { sqlite } from "../server/storage.js";

const runsBefore = (sqlite.prepare("SELECT COUNT(*) c FROM ingestion_runs").get() as { c: number }).c;
const fakeRuns = sqlite
  .prepare(
    "DELETE FROM ingestion_runs WHERE note IS NULL AND error IS NULL AND status != 'running'",
  )
  .run();
const runsAfter = (sqlite.prepare("SELECT COUNT(*) c FROM ingestion_runs").get() as { c: number }).c;

// Demo users carry the seed script's placeholder hash and cannot authenticate.
const usersBefore = (sqlite.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
const fakeUsers = sqlite
  .prepare(
    "DELETE FROM users WHERE password_hash LIKE '%demo.hash%' OR password_hash LIKE '%filler%'",
  )
  .run();
const usersAfter = (sqlite.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;

console.log(`ingestion_runs: removed ${fakeRuns.changes} fabricated of ${runsBefore} → ${runsAfter} real remain`);
console.log(`users:          removed ${fakeUsers.changes} demo of ${usersBefore} → ${usersAfter} real remain`);

// Sanity: every surviving run should look real (have a note or an error).
const suspect = (sqlite
  .prepare("SELECT COUNT(*) c FROM ingestion_runs WHERE note IS NULL AND error IS NULL AND status != 'running'")
  .get() as { c: number }).c;
if (suspect > 0) {
  console.error(`WARNING: ${suspect} note-less/error-less runs still present`);
  process.exit(1);
}
console.log("clean: no note-less, error-less runs remain");
