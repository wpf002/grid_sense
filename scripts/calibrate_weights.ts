/**
 * Model calibration — tune FACTOR_WEIGHTS against real DC announcements.
 *
 * The 37 counties in dc_announcements (real, FIPS-verified) are the "positives":
 * places a hyperscaler actually landed. A good model ranks them near the top of
 * all 3,109 counties. We:
 *   1. Precompute each county's 11 weight-INDEPENDENT factor values + signal
 *      boost once (values don't change with weights — only their weighting does).
 *   2. Coordinate-ascent search over the weight vector to maximize the mean
 *      percentile rank of the positives, keeping weights >=0 summing to 1.
 *   3. Report current vs. recommended weights and the metric deltas.
 *
 * Reports only — it does not mutate scoring.ts. Review, then apply by hand.
 *
 *   npx tsx scripts/calibrate_weights.ts
 */
import "../server/storage";
import { db, sqlite } from "../server/storage";
import { counties as countiesTbl } from "../shared/schema";
import { warmOverlayCaches, buildOverlayFor } from "../server/ingest/overlay";
import {
  FACTOR_WEIGHTS,
  computeCountyFactorsV5,
  computeSignalBoost,
} from "../server/scoring";
import type { County, Signal } from "../shared/schema";

type Weights = Record<string, number>;
const KEYS = Object.keys(FACTOR_WEIGHTS);

// Regularization: no factor may vanish or dominate. An unconstrained fit to
// ~36 points overfits (zeroes half the factors, leans on the circular
// cluster-adjacency signal). Bounds keep the model defensible.
const MIN_W = 0.03;
const MAX_W = 0.20;

function clamp(v: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}
// Project onto {w_k in [MIN,MAX], sum=1} via a few clip+renormalize passes.
function normalize(w: Weights): Weights {
  let out: Weights = {};
  for (const k of KEYS) out[k] = Math.max(0, w[k]);
  for (let pass = 0; pass < 20; pass++) {
    let sum = 0;
    for (const k of KEYS) { out[k] = Math.min(MAX_W, Math.max(MIN_W, out[k])); sum += out[k]; }
    if (Math.abs(sum - 1) < 1e-9) break;
    // Rescale only the non-pegged weights toward sum=1.
    const free = KEYS.filter((k) => out[k] > MIN_W + 1e-9 && out[k] < MAX_W - 1e-9);
    const pegged = KEYS.filter((k) => !free.includes(k)).reduce((a, k) => a + out[k], 0);
    const target = 1 - pegged;
    const freeSum = free.reduce((a, k) => a + out[k], 0) || 1;
    for (const k of free) out[k] = (out[k] / freeSum) * target;
  }
  return out;
}

async function main() {
  warmOverlayCaches();
  const counties = db.select().from(countiesTbl).all() as County[];

  // signals grouped by county fips
  const sigRows = sqlite
    .prepare("SELECT county_fips, weight, confidence, detected_at FROM signals")
    .all() as Array<{ county_fips: string; weight: number; confidence: number; detected_at: string }>;
  const sigByFips = new Map<string, Signal[]>();
  for (const s of sigRows) {
    const arr = sigByFips.get(s.county_fips) ?? [];
    arr.push({ weight: s.weight, confidence: s.confidence, detectedAt: s.detected_at } as unknown as Signal);
    sigByFips.set(s.county_fips, arr);
  }

  // Precompute weight-independent value vectors + boost per county.
  const N = counties.length;
  const fipsArr: string[] = new Array(N);
  const valueMat: number[][] = new Array(N); // [county][factorIndex]
  const boostArr = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const c = counties[i];
    fipsArr[i] = c.fips;
    const factors = computeCountyFactorsV5(c, buildOverlayFor(c.fips));
    const byKey = new Map(factors.map((f) => [f.key, f.value]));
    valueMat[i] = KEYS.map((k) => byKey.get(k) ?? 0);
    boostArr[i] = computeSignalBoost(sigByFips.get(c.fips) ?? []);
  }

  const positives = new Set(
    (sqlite.prepare("SELECT DISTINCT fips FROM dc_announcements").all() as { fips: string }[]).map((r) => r.fips),
  );
  const posIdx = fipsArr.map((f, i) => (positives.has(f) ? i : -1)).filter((i) => i >= 0);

  // Landing score for a county index given weights.
  function landing(i: number, wVec: number[]): number {
    const v = valueMat[i];
    let base = 0;
    for (let k = 0; k < KEYS.length; k++) base += wVec[k] * v[k];
    return clamp(clamp(base) + boostArr[i]);
  }

  // Mean percentile rank of positives (1.0 = all positives ranked at the very top).
  function meanPercentile(w: Weights): number {
    const wVec = KEYS.map((k) => w[k]);
    const scores = new Float64Array(N);
    for (let i = 0; i < N; i++) scores[i] = landing(i, wVec);
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const rankOf = new Int32Array(N);
    for (let r = 0; r < N; r++) rankOf[order[r]] = r;
    let sum = 0;
    for (const i of posIdx) sum += 1 - rankOf[i] / (N - 1);
    return sum / posIdx.length;
  }

  // Diagnostic metrics for a weight set.
  function report(w: Weights, label: string) {
    const wVec = KEYS.map((k) => w[k]);
    const scored = fipsArr.map((f, i) => ({ f, s: landing(i, wVec), pos: positives.has(f) }));
    scored.sort((a, b) => b.s - a.s);
    const topN = (n: number) => scored.slice(0, n).filter((x) => x.pos).length;
    const P = positives.size;
    const f1at = (cut: number) => {
      const pred = scored.filter((x) => x.s >= cut);
      const tp = pred.filter((x) => x.pos).length;
      const prec = pred.length ? tp / pred.length : 0;
      const rec = tp / P;
      const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
      return { prec, rec, f1, flagged: pred.length };
    };
    const mp = meanPercentile(w);
    const b60 = f1at(60), b70 = f1at(70);
    console.log(`\n== ${label} ==`);
    console.log(`  mean percentile of ${P} positives: ${(mp * 100).toFixed(1)}%`);
    console.log(`  recall in top 50/100/250: ${topN(50)}/${topN(100)}/${topN(250)} of ${P}`);
    console.log(`  cutoff 60: precision ${(b60.prec * 100).toFixed(0)}% recall ${(b60.rec * 100).toFixed(0)}% F1 ${b60.f1.toFixed(3)} (flagged ${b60.flagged})`);
    console.log(`  cutoff 70: precision ${(b70.prec * 100).toFixed(0)}% recall ${(b70.rec * 100).toFixed(0)}% F1 ${b70.f1.toFixed(3)} (flagged ${b70.flagged})`);
    return mp;
  }

  const current = { ...FACTOR_WEIGHTS } as Weights;
  report(current, "CURRENT weights");

  // Coordinate ascent on mean percentile.
  let best = normalize(current);
  let bestObj = meanPercentile(best);
  for (const step of [0.05, 0.02, 0.01]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const k of KEYS) {
        for (const dir of [1, -1]) {
          const cand = normalize({ ...best, [k]: best[k] + dir * step });
          const o = meanPercentile(cand);
          if (o > bestObj + 1e-6) { best = cand; bestObj = o; improved = true; }
        }
      }
    }
  }

  report(best, "CALIBRATED weights (unconstrained-in-bounds — may overfit)");

  // Blended: halfway from domain priors toward the fitted optimum. Keeps strong
  // priors (grid demand) meaningful while shifting toward the evidence. This is
  // the set we actually apply.
  const blended = normalize(
    Object.fromEntries(KEYS.map((k) => [k, 0.5 * current[k] + 0.5 * best[k]])),
  );
  report(blended, "BLENDED (0.5 prior + 0.5 fit) — RECOMMENDED");
  console.log("\nRecommended FACTOR_WEIGHTS (blended):");
  console.log(
    "{\n" + KEYS.map((k) => `  ${k}: ${blended[k].toFixed(3)},`).join("\n") + "\n}",
  );
  const delta = KEYS.map((k) => `${k}: ${(current[k] ?? 0).toFixed(2)} -> ${blended[k].toFixed(2)}`);
  console.log("\nDeltas (current -> blended):\n  " + delta.join("\n  "));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
