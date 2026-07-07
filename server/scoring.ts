// GridSense Landing Probability model — v0.5 (real-data-blended)
//
// Two-layer design:
//   County propensity: weighted composite over grid, land, fiber, fiscal, policy factors.
//   Parcel triggers:   event-detector over signals (llc_purchase, rezoning, substation, ...).
//
// v0.5 upgrade: factor computation accepts an optional RealDataOverlay so EIA-860
// (existing generation), HIFLD transmission, PJM/MISO/ERCOT queues, and FEMA NRI
// (hazard) directly drive the score. Each factor now carries its provenance
// quality (`real` | `partial` | `synthetic`) so the UI can grey out untrusted values.
//
// Weights derived from research_signals.md § "Top 10 most predictive signals ranked".
// Calibration philosophy: ESIG five-metric framework.

import type { County, Signal, ScoreFactor } from "@shared/schema";

// Calibrated 2026-07 against 37 real FIPS-verified DC announcements via
// scripts/calibrate_weights.ts (blended 0.5 domain-prior + 0.5 fitted optimum,
// regularized to [0.03, 0.20] so no factor vanishes or dominates). Lifted mean
// percentile rank of real DC counties 64% -> 74% and precision@70 10% -> 58%
// without gutting priors. Sums to 1.0.
export const FACTOR_WEIGHTS = {
  gridDemandIntent: 0.105,
  timeToPower: 0.111,
  onsiteGeneration: 0.15,
  landAvailability: 0.08,
  landAffordability: 0.071,
  fiberConnectivity: 0.145,
  fiscalIncentives: 0.065,
  clusterAdjacency: 0.14,
  waterAvailability: 0.03,
  hazardSafety: 0.035,
  coolingEfficiency: 0.068,
} as const;

// Cooling climate score (0-100, higher = better DC cooling climate) from NOAA
// 1991-2020 annual Cooling/Heating Degree Days. High CDD = high cooling load
// (bad); high HDD = cold climate with more free-cooling/economizer hours (good).
// Exported so the ingest and the model use one formula.
export function coolingScoreFromDegreeDays(
  cdd: number | null | undefined,
  hdd: number | null | undefined,
): number | null {
  if (cdd == null && hdd == null) return null;
  const coolingLoad = clamp((cdd ?? 0) / 40, 0, 115);
  const freeCoolingBonus = Math.min((hdd ?? 0) / 600, 12);
  return clamp(100 - coolingLoad + freeCoolingBonus);
}

export interface RealDataOverlay {
  // EIA-860 aggregate for this county
  eia?: { totalMw: number; genCount: number } | null;
  // HIFLD transmission within 30 mi
  hifld?: {
    linesCount: number;
    hvLinesCount: number; // ≥230kV
    ehvLinesCount: number; // ≥345kV
    maxVoltage: number | null;
  } | null;
  // ISO interconnection queue rows for this county (PJM/MISO/ERCOT combined)
  queue?: { rowsCount: number; queuedMw: number; withdrawnMw: number } | null;
  // FEMA National Risk Index — 0-100 composite; higher = more hazard
  nri?: { riskScore: number | null; ealScore: number | null } | null;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function logNormalize(v: number, cap: number): number {
  if (v <= 0) return 0;
  const ratio = Math.log10(1 + v) / Math.log10(1 + cap);
  return clamp(ratio * 100);
}

export type DataQuality = "real" | "partial" | "synthetic";

export interface ScoreFactorV5 extends ScoreFactor {
  dataQuality: DataQuality;
  sourceHint?: string;
}

export function computeCountyFactorsV5(
  c: County,
  overlay: RealDataOverlay = {},
): ScoreFactorV5[] {
  // ---- 1. Grid demand intent ----
  // Prefer real ISO queue queuedMw; fall back to seed queuedLoadMw.
  const queuedMw = overlay.queue?.queuedMw ?? c.queuedLoadMw ?? 0;
  const gridDemandIntent = logNormalize(queuedMw, 20000);
  const gdQuality: DataQuality = overlay.queue ? "real" : "synthetic";

  // ---- 2. Time to power ----
  // Real signal: how deep is the queue withdrawnMw share? High withdrawal ratio ⇒
  // rougher path to energization. Otherwise use seed timeToPowerMonths.
  let timeToPower: number;
  let ttpQuality: DataQuality = "synthetic";
  if (overlay.queue && overlay.queue.queuedMw > 100) {
    // Blend: base on seed ttm if present, but adjust ±10 pts by withdrawal ratio.
    const withdrawalRatio =
      overlay.queue.withdrawnMw /
      Math.max(1, overlay.queue.queuedMw + overlay.queue.withdrawnMw);
    const ttm = c.timeToPowerMonths ?? 48;
    const base = clamp(100 - ((ttm - 18) / (60 - 18)) * 100);
    timeToPower = clamp(base - withdrawalRatio * 20);
    ttpQuality = "partial";
  } else {
    const ttm = c.timeToPowerMonths ?? 48;
    timeToPower = clamp(100 - ((ttm - 18) / (60 - 18)) * 100);
  }

  // ---- 3. Onsite generation ----
  // Real signal: EIA-860 total generation MW in county. >2 GW existing ⇒ full BTM confidence.
  let onsiteGeneration: number;
  let ogQuality: DataQuality = "synthetic";
  if (overlay.eia && overlay.eia.totalMw > 0) {
    // 100 pt score at 2000 MW+, curve down at low MW.
    onsiteGeneration = clamp(logNormalize(overlay.eia.totalMw, 2000));
    ogQuality = "real";
    // Blend with seed toggle: if seed says "unfriendly" but real MW is high, still credit some.
    if (!c.onsiteGenerationFriendly) onsiteGeneration = onsiteGeneration * 0.75;
  } else {
    onsiteGeneration = c.onsiteGenerationFriendly ? 100 : 30;
  }

  // ---- 4. Land availability ---- REAL from USDA ERS Rural-Urban Continuum Codes 2023 ----
  // usda_rucc pipeline sets large_parcel_count via RUCC → parcel-supply proxy.
  // Rural counties (RUCC 6-9) score 32-40 (peak parcel supply);
  // metro counties (RUCC 1) score 5 (parcel scarcity).
  const landAvailability = clamp(((c.largeParcelCount ?? 0) / 40) * 100);
  const lavQuality: DataQuality = (c.largeParcelCount ?? 0) > 0 ? "real" : "synthetic";

  // ---- 5. Land affordability ---- REAL from USDA NASS 2025 Land Values ----
  // usda_land pipeline sets median_land_price_per_acre based on state-level
  // farm real estate values with tier + existing-DC capacity multipliers.
  const landPx = c.medianLandPricePerAcre ?? 50000;
  const laQuality: DataQuality = c.medianLandPricePerAcre != null ? "real" : "synthetic";
  const landAffordability = clamp(100 - logNormalize(landPx, 1000000));

  // ---- 6. Fiber connectivity ---- REAL from FCC BDC Dec 2024 + PeeringDB ----
  // FCC BDC tells us last-mile fiber density; PeeringDB tells us carrier-hotel
  // and IX presence within 40 miles. Both matter for hyperscaler siting.
  // Blend: 70% FCC density + 30% peering (log-normalized, ceiling 60 IX-weight).
  const bdcFiber = c.fiberDensityScore ?? 0;
  const pdbCount = c.peeringExchangeCount ?? 0;
  const peeringScore = clamp(logNormalize(pdbCount, 60) * 100);
  const fiberConnectivity = clamp(bdcFiber * 0.7 + peeringScore * 0.3);
  const fcQuality: DataQuality = bdcFiber > 0 || pdbCount > 0 ? "real" : "synthetic";

  // ---- 7. Fiscal incentives ---- REAL from state DC tax incentive matrix ----
  // state_incentives pipeline sets tax_incentive_score based on statutory
  // sales-tax exemption tier, electricity exemption, property abatement,
  // and capex/jobs thresholds. Moratorium + right-to-build modifiers still apply.
  const baseIncentive = c.taxIncentiveScore ?? 0;
  let fiscalIncentives = baseIncentive;
  if (c.moratoriumStatus === "active") fiscalIncentives *= 0.0;
  else if (c.moratoriumStatus === "proposed") fiscalIncentives *= 0.55;
  if (c.rightToBuildZoning) fiscalIncentives = clamp(fiscalIncentives + 10);
  const fiQuality: DataQuality = baseIncentive > 0 ? "real" : "synthetic";

  // ---- 8. Cluster adjacency ----
  // Real signal: HIFLD ≥345kV EHV lines. High EHV count = major cluster infrastructure.
  let clusterAdjacency: number;
  let clQuality: DataQuality = "synthetic";
  if (overlay.hifld && overlay.hifld.linesCount > 0) {
    // Weight EHV heavily. Existing DC clusters live near EHV.
    const ehvBoost = clamp(overlay.hifld.ehvLinesCount * 5); // +5 per ≥345kV line, cap 100
    const hvContribution = clamp(overlay.hifld.hvLinesCount * 2);
    const seedContribution = logNormalize(c.existingDcCapacityMw ?? 0, 4000) * 0.5;
    clusterAdjacency = clamp(seedContribution + ehvBoost * 0.6 + hvContribution * 0.2);
    clQuality = "partial";
  } else {
    clusterAdjacency = clamp(logNormalize(c.existingDcCapacityMw ?? 0, 4000));
  }

  // ---- 9. Water availability ---- REAL from USGS 2015 water use ----
  // usgs_water pipeline sets water_stress_score using per-capita non-agricultural
  // withdrawals + irrigation share + state aridity floor. Score is 0 when the
  // pipeline has not been run yet.
  let waterAvailability: number;
  let waQuality: DataQuality = "synthetic";
  const wss = c.waterStressScore ?? 0;
  if (wss > 0) {
    waterAvailability = clamp(100 - wss);
    waQuality = "real";
  } else {
    waterAvailability = clamp(100 - 50); // fallback midpoint
  }

  // ---- 10. Hazard safety ---- REAL from FEMA NRI ----
  let hazardSafety: number;
  let hzQuality: DataQuality = "synthetic";
  if (overlay.nri && overlay.nri.riskScore != null) {
    // NRI risk is 0-100 higher = worse. Invert.
    hazardSafety = clamp(100 - overlay.nri.riskScore);
    hzQuality = "real";
  } else {
    hazardSafety = clamp(100 - (c.hazardScore ?? 25));
  }

  // ---- 11. Cooling efficiency ---- REAL from NOAA NCEI 1991-2020 normals ----
  // noaa_climate pipeline sets cooling_degree_days + heating_degree_days.
  const coolingReal = coolingScoreFromDegreeDays(c.coolingDegreeDays, c.heatingDegreeDays);
  const coolingEfficiency = coolingReal ?? 50; // neutral fallback pre-ingest
  const coolQuality: DataQuality = coolingReal != null ? "real" : "synthetic";

  const factors: ScoreFactorV5[] = [
    {
      key: "gridDemandIntent",
      label: "Grid demand",
      weight: FACTOR_WEIGHTS.gridDemandIntent,
      value: gridDemandIntent,
      contribution: 0,
      dataQuality: gdQuality,
      sourceHint: overlay.queue ? `ISO queue: ${Math.round(queuedMw)} MW` : undefined,
    },
    {
      key: "timeToPower",
      label: "Time to power",
      weight: FACTOR_WEIGHTS.timeToPower,
      value: timeToPower,
      contribution: 0,
      dataQuality: ttpQuality,
      sourceHint: overlay.queue
        ? `${Math.round((overlay.queue.withdrawnMw / Math.max(1, overlay.queue.queuedMw + overlay.queue.withdrawnMw)) * 100)}% withdrawal ratio`
        : undefined,
    },
    {
      key: "onsiteGeneration",
      label: "Behind-the-meter",
      weight: FACTOR_WEIGHTS.onsiteGeneration,
      value: onsiteGeneration,
      contribution: 0,
      dataQuality: ogQuality,
      sourceHint: overlay.eia
        ? `EIA-860: ${Math.round(overlay.eia.totalMw)} MW, ${overlay.eia.genCount} gens`
        : undefined,
    },
    {
      key: "landAvailability",
      label: "Parcel supply",
      weight: FACTOR_WEIGHTS.landAvailability,
      value: landAvailability,
      contribution: 0,
      dataQuality: lavQuality,
      sourceHint: lavQuality === "real" ? `USDA RUCC 2023: ${Math.round(landAvailability)}/100 parcel supply` : undefined,
    },
    {
      key: "landAffordability",
      label: "Land affordability",
      weight: FACTOR_WEIGHTS.landAffordability,
      value: landAffordability,
      contribution: 0,
      dataQuality: laQuality,
      sourceHint: laQuality === "real" ? `USDA NASS 2025: $${Math.round(landPx / 1000)}K/acre` : undefined,
    },
    {
      key: "fiberConnectivity",
      label: "Fiber & peering",
      weight: FACTOR_WEIGHTS.fiberConnectivity,
      value: fiberConnectivity,
      contribution: 0,
      dataQuality: fcQuality,
      sourceHint:
        fcQuality === "real"
          ? `FCC BDC ${Math.round(bdcFiber)}/100 · PeeringDB ${pdbCount} IX-weight`
          : undefined,
    },
    {
      key: "fiscalIncentives",
      label: "Fiscal / policy",
      weight: FACTOR_WEIGHTS.fiscalIncentives,
      value: fiscalIncentives,
      contribution: 0,
      dataQuality: fiQuality,
      sourceHint: fiQuality === "real" ? `State DC tax code: ${Math.round(baseIncentive)}/100 base incentive` : undefined,
    },
    {
      key: "clusterAdjacency",
      label: "Cluster adjacency",
      weight: FACTOR_WEIGHTS.clusterAdjacency,
      value: clusterAdjacency,
      contribution: 0,
      dataQuality: clQuality,
      sourceHint: overlay.hifld
        ? `${overlay.hifld.ehvLinesCount} EHV + ${overlay.hifld.hvLinesCount} HV lines`
        : undefined,
    },
    {
      key: "waterAvailability",
      label: "Water availability",
      weight: FACTOR_WEIGHTS.waterAvailability,
      value: waterAvailability,
      contribution: 0,
      dataQuality: waQuality,
      sourceHint: waQuality === "real" ? `USGS 2015: stress ${Math.round(wss)}/100` : undefined,
    },
    {
      key: "hazardSafety",
      label: "Hazard safety",
      weight: FACTOR_WEIGHTS.hazardSafety,
      value: hazardSafety,
      contribution: 0,
      dataQuality: hzQuality,
      sourceHint: overlay.nri?.riskScore != null ? `FEMA NRI: ${overlay.nri.riskScore.toFixed(1)}` : undefined,
    },
    {
      key: "coolingEfficiency",
      label: "Cooling climate",
      weight: FACTOR_WEIGHTS.coolingEfficiency,
      value: coolingEfficiency,
      contribution: 0,
      dataQuality: coolQuality,
      sourceHint:
        coolQuality === "real"
          ? `NOAA normals: ${Math.round(c.coolingDegreeDays ?? 0)} CDD / ${Math.round(c.heatingDegreeDays ?? 0)} HDD`
          : undefined,
    },
  ];

  factors.forEach((f) => {
    f.contribution = f.weight * f.value;
  });
  return factors;
}

// Legacy shim for callers that don't have overlay yet
export function computeCountyFactors(c: County): ScoreFactor[] {
  return computeCountyFactorsV5(c) as ScoreFactor[];
}

export function computeCountyBaseScore(c: County, overlay?: RealDataOverlay): number {
  const factors = computeCountyFactorsV5(c, overlay);
  const raw = factors.reduce((s, f) => s + f.contribution, 0);
  return clamp(raw);
}

export function computeSignalBoost(signals: Signal[]): number {
  if (!signals?.length) return 0;
  const now = Date.parse("2026-07-04");
  let total = 0;
  for (const s of signals) {
    const ts = Date.parse(s.detectedAt ?? "2020-01-01");
    const ageMonths = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24 * 30));
    const recency = Math.max(0, 1 - ageMonths / 36);
    total += (s.weight ?? 0) * (s.confidence ?? 0.5) * recency;
  }
  return clamp(15 * (1 - Math.exp(-total / 2.0)), 0, 15);
}

export function computeLandingProbability(
  c: County,
  signals: Signal[],
  overlay?: RealDataOverlay,
): number {
  const base = computeCountyBaseScore(c, overlay);
  const boost = computeSignalBoost(signals);
  return Math.round(clamp(base + boost));
}

export function scoreTierFor(p: number): "hot" | "warm" | "emerging" | "cold" {
  if (p >= 75) return "hot";
  if (p >= 60) return "warm";
  if (p >= 45) return "emerging";
  return "cold";
}
