// One-time cleanup: collapse fanned-out signal rows.
//
// An earlier version of server/ingest/enrich.ts attached a single state-level
// news item or SEC 8-K to EVERY county in the state (254 rows for one Texas
// article), which (a) repeated the same story across the "Latest signals" feed
// and (b) inflated the signal-cluster triggers with state-level noise.
//
// enrich.ts now attaches one representative county per article. This script
// brings an already-seeded data.db in line with that policy: for each distinct
// headline it keeps the single row whose county has the highest landing
// probability and deletes the rest. Safe to re-run (idempotent once deduped).

import { sqlite } from "../server/storage";

const before = (sqlite.prepare("SELECT COUNT(*) AS n FROM signals").get() as { n: number }).n;
const dupGroups = (
  sqlite
    .prepare("SELECT COUNT(*) AS n FROM (SELECT headline FROM signals GROUP BY LOWER(TRIM(headline)) HAVING COUNT(*) > 1)")
    .get() as { n: number }
).n;

sqlite
  .prepare(
    `DELETE FROM signals WHERE id IN (
       SELECT id FROM (
         SELECT s.id AS id,
                ROW_NUMBER() OVER (
                  PARTITION BY LOWER(TRIM(s.headline))
                  ORDER BY COALESCE(c.landing_probability, 0) DESC, s.id DESC
                ) AS rn
         FROM signals s
         LEFT JOIN counties c ON c.fips = s.county_fips
       ) WHERE rn > 1
     )`,
  )
  .run();

const after = (sqlite.prepare("SELECT COUNT(*) AS n FROM signals").get() as { n: number }).n;
console.log(`[dedupe_signals] duplicate headline groups: ${dupGroups}`);
console.log(`[dedupe_signals] signals: ${before} -> ${after} (removed ${before - after})`);
