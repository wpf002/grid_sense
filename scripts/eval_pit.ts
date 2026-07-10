// Point-in-time backtest CLI.
//
//   npx tsx scripts/eval_pit.ts
//   npx tsx scripts/eval_pit.ts --min-evaluable 5 --max-lookback 365
//
// Scores each announced county using ONLY a snapshot taken before the
// announcement. Unlike scripts/eval_backtest.ts (which scores counties as they
// look today), this cannot be inflated by news published after the fact.
//
// It will report "not ready" until score history reaches back past a real
// announcement. That is the correct answer, not a bug.

import { runBothBases, historyOutlook } from "../server/eval/run.js";
import type { PitReport } from "../server/eval/pit.js";

const argv = process.argv.slice(2);
const flag = (name: string, dflt: number): number => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= argv.length) return dflt;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
};

const opts = {
  minEvaluable: flag("min-evaluable", 10),
  maxLookbackDays: flag("max-lookback", 540),
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function printReport(label: string, r: PitReport): void {
  console.log(`\n── ${label} ──`);
  console.log(`  coverage           ${r.evaluated.length}/${r.totalAnnouncements} announcements (${pct(r.coverage)})`);

  if (!r.metrics) {
    console.log("  metrics            none — nothing is evaluable yet");
    return;
  }
  const m = r.metrics;
  console.log(`  mean percentile    ${pct(m.meanPercentile)}`);
  console.log(`  median percentile  ${pct(m.medianPercentile)}`);
  console.log(`  mean lead time     ${m.meanLeadDays.toFixed(0)} days before announcement`);
  console.log("  cutoff   TP   FN   flagged   precision   recall   F1");
  for (const c of m.cutoffs) {
    const p = c.precision == null ? "   n/a" : pct(c.precision).padStart(6);
    const f = c.f1 == null ? "   n/a" : pct(c.f1).padStart(6);
    console.log(
      `  ${String(c.threshold).padStart(4)}   ${String(c.truePositives).padStart(2)}   ` +
        `${String(c.falseNegatives).padStart(2)}   ${String(c.flagged).padStart(7)}   ` +
        `${p}      ${pct(c.recall).padStart(6)}   ${f}`,
    );
  }
}

const outlook = historyOutlook();
const { total, factorsOnly } = runBothBases(opts);

console.log("GridSense — Point-in-Time Backtest");
console.log("═".repeat(62));
console.log(`score history      ${outlook.snapshotDays} day(s), ${outlook.earliest ?? "—"} → ${outlook.latest ?? "—"}`);
console.log(`announcements      ${outlook.totalAnnouncements} total, ${outlook.announcementsAfterHistoryStart} after history begins`);
console.log(`lookback window    ${opts.maxLookbackDays} days`);
console.log(`min evaluable      ${opts.minEvaluable}`);

if (!total.ready) {
  console.log(`\nSTATUS: NOT READY`);
  console.log(`  ${total.notReady}`);

  const reasons = new Map<string, number>();
  for (const u of total.uncovered) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);
  if (reasons.size) {
    console.log("\n  why each announcement is uncovered:");
    for (const [reason, n] of reasons) console.log(`    ${n.toString().padStart(3)}  ${reason}`);
  }
  console.log(
    "\n  The harness is wired and tested. It starts producing numbers as soon as a\n" +
      "  data center is announced in a county we snapshotted beforehand. Snapshots\n" +
      "  now record base_score and signal_boost, so the leakage-free comparison\n" +
      "  below will be available for every future announcement.",
  );
} else {
  console.log(`\nSTATUS: READY`);
}

printReport("Total score (factors + signal boost)", total);
printReport("Factors only (leakage-free)", factorsOnly);

if (total.ready && total.metrics && factorsOnly.metrics) {
  const gap = total.metrics.meanPercentile - factorsOnly.metrics.meanPercentile;
  console.log(`\nleakage estimate    ${(gap * 100).toFixed(2)} percentile points attributable to signals`);
  console.log(
    gap > 0.02
      ? "  The signal boost is doing meaningful work at prediction time, not just after the fact."
      : "  Signals add little before announcement — as expected, since the news hasn't been written yet.",
  );
}

console.log("");
// Exit 0 either way: "not ready" is a valid state, not a failure.
