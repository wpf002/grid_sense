// Evaluate the scoring model against the 37 FIPS-verified real data-center
// announcements. Used to decide whether a model change (e.g. adding a factor)
// actually improves ranking, rather than assuming it does.
//
// Metrics:
//   - mean/median percentile rank of announced counties (higher = model ranks
//     real landings above the 3,109-county field)
//   - precision / recall / F1 at score cutoffs
//
// Usage: npx tsx scripts/eval_backtest.ts [label]

import { sqlite } from "../server/storage";

const label = process.argv[2] ?? "current";

const scored = (sqlite
  .prepare("SELECT fips, landing_probability AS s FROM counties WHERE landing_probability IS NOT NULL")
  .all() as { fips: string; s: number }[]).sort((a, b) => a.s - b.s);
const total = scored.length;

// percentile rank = fraction of counties scoring strictly below this one
const rankOf = new Map<string, number>();
scored.forEach((r, i) => rankOf.set(r.fips, (i / (total - 1)) * 100));

const positives = sqlite
  .prepare(`SELECT DISTINCT a.fips, c.landing_probability AS s
            FROM dc_announcements a JOIN counties c ON c.fips = a.fips
            WHERE c.landing_probability IS NOT NULL`)
  .all() as { fips: string; s: number }[];

const pcts = positives.map((p) => rankOf.get(p.fips) ?? 0).sort((a, b) => a - b);
const mean = pcts.reduce((x, y) => x + y, 0) / pcts.length;
const median = pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2;

console.log(`\n=== ${label} ===`);
console.log(`positives: ${positives.length} / ${total} counties`);
console.log(`mean percentile rank:   ${mean.toFixed(1)}%`);
console.log(`median percentile rank: ${median.toFixed(1)}%`);

console.log(`\ncutoff  flagged   TP  precision  recall     F1`);
for (const cutoff of [50, 60, 70, 80]) {
  const flagged = scored.filter((r) => r.s >= cutoff).length;
  const tp = positives.filter((p) => p.s >= cutoff).length;
  const fp = flagged - tp;
  const fn = positives.length - tp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  console.log(
    `${String(cutoff).padStart(5)}  ${String(flagged).padStart(7)}  ${String(tp).padStart(3)}  ` +
      `${(precision * 100).toFixed(1).padStart(8)}%  ${(recall * 100).toFixed(1).padStart(5)}%  ${(f1 * 100).toFixed(1).padStart(5)}%`,
  );
}
