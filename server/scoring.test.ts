import { describe, it, expect } from "vitest";
import type { County, Signal } from "@shared/schema";
import {
  FACTOR_WEIGHTS,
  computeCountyFactorsV5,
  computeCountyBaseScore,
  computeSignalBoost,
  computeLandingProbability,
  scoreTierFor,
  coolingScoreFromDegreeDays,
  type RealDataOverlay,
} from "./scoring";

// Minimal county factory. scoring.ts only reads a subset of columns, so we
// build a bare object and cast — the DB row type has many unrelated fields.
function county(overrides: Partial<County> = {}): County {
  return {
    queuedLoadMw: 0,
    timeToPowerMonths: 48,
    onsiteGenerationFriendly: false,
    largeParcelCount: 0,
    medianLandPricePerAcre: null,
    fiberDensityScore: 0,
    peeringExchangeCount: 0,
    taxIncentiveScore: 0,
    moratoriumStatus: "none",
    rightToBuildZoning: false,
    existingDcCapacityMw: 0,
    waterStressScore: 0,
    hazardScore: 25,
    ...overrides,
  } as unknown as County;
}

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    detectedAt: "2026-06-01",
    weight: 1,
    confidence: 0.8,
    ...overrides,
  } as unknown as Signal;
}

const KEYS = [
  "gridDemandIntent",
  "timeToPower",
  "onsiteGeneration",
  "landAvailability",
  "landAffordability",
  "fiberConnectivity",
  "fiscalIncentives",
  "clusterAdjacency",
  "waterAvailability",
  "hazardSafety",
  "coolingEfficiency",
  "gasAccess",
  "carbonIntensity",
];

describe("FACTOR_WEIGHTS", () => {
  it("sum to 1.0", () => {
    const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  // powerPrice is defined but weighted 0 by default: a backtest sweep showed it
  // costs precision (announced counties average $48.64/MWh vs $55.00 overall —
  // only 12% cheaper, and PJM is both the priciest hub and the busiest market).
  // GRIDSENSE_POWER_WEIGHT can turn it on; the other 13 keep their ratios.
  it("weights powerPrice at 0 unless GRIDSENSE_POWER_WEIGHT is set", () => {
    expect(FACTOR_WEIGHTS.powerPrice).toBe(0);
  });

  it("omits zero-weight factors from the scored output", () => {
    const keys = computeCountyFactorsV5(county()).map((f) => f.key);
    expect(keys).not.toContain("powerPrice");
    expect(keys).toHaveLength(13);
  });
});

describe("computeCountyFactorsV5", () => {
  it("returns all factors with weight*value contributions", () => {
    const factors = computeCountyFactorsV5(county());
    expect(factors.map((f) => f.key).sort()).toEqual([...KEYS].sort());
    for (const f of factors) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(100);
      expect(f.contribution).toBeCloseTo(f.weight * f.value, 6);
    }
  });

  it("tags factors synthetic when no overlay is supplied", () => {
    const factors = computeCountyFactorsV5(county());
    const grid = factors.find((f) => f.key === "gridDemandIntent")!;
    expect(grid.dataQuality).toBe("synthetic");
  });

  it("marks grid demand real and raises it when ISO queue overlay is present", () => {
    const overlay: RealDataOverlay = {
      queue: { rowsCount: 5, queuedMw: 8000, withdrawnMw: 500 },
    };
    const withQueue = computeCountyFactorsV5(county(), overlay).find(
      (f) => f.key === "gridDemandIntent",
    )!;
    const without = computeCountyFactorsV5(county()).find(
      (f) => f.key === "gridDemandIntent",
    )!;
    expect(withQueue.dataQuality).toBe("real");
    expect(withQueue.value).toBeGreaterThan(without.value);
  });

  it("credits behind-the-meter generation from EIA-860 MW", () => {
    const overlay: RealDataOverlay = { eia: { totalMw: 2500, genCount: 8 } };
    const friendly = computeCountyFactorsV5(
      county({ onsiteGenerationFriendly: true }),
      overlay,
    ).find((x) => x.key === "onsiteGeneration")!;
    expect(friendly.dataQuality).toBe("real");
    expect(friendly.value).toBeGreaterThan(80);

    // A county flagged unfriendly is penalized 25% even with the same real MW.
    const unfriendly = computeCountyFactorsV5(county(), overlay).find(
      (x) => x.key === "onsiteGeneration",
    )!;
    expect(unfriendly.value).toBeLessThan(friendly.value);
  });

  it("scores land affordability inversely to price per acre", () => {
    const cheap = computeCountyFactorsV5(
      county({ medianLandPricePerAcre: 3000 }),
    ).find((f) => f.key === "landAffordability")!;
    const pricey = computeCountyFactorsV5(
      county({ medianLandPricePerAcre: 500000 }),
    ).find((f) => f.key === "landAffordability")!;
    expect(cheap.value).toBeGreaterThan(pricey.value);
  });

  it("inverts FEMA NRI risk into hazard safety", () => {
    const safe = computeCountyFactorsV5(county(), {
      nri: { riskScore: 10, ealScore: null },
    }).find((f) => f.key === "hazardSafety")!;
    const risky = computeCountyFactorsV5(county(), {
      nri: { riskScore: 90, ealScore: null },
    }).find((f) => f.key === "hazardSafety")!;
    expect(safe.value).toBeCloseTo(90, 5);
    expect(risky.value).toBeCloseTo(10, 5);
    expect(safe.dataQuality).toBe("real");
  });

  it("zeroes fiscal incentives under an active moratorium", () => {
    const f = computeCountyFactorsV5(
      county({ taxIncentiveScore: 80, moratoriumStatus: "active" }),
    ).find((x) => x.key === "fiscalIncentives")!;
    expect(f.value).toBe(0);
  });

  it("scores a cool climate above a hot one, tagged real", () => {
    const phoenix = computeCountyFactorsV5(
      county({ coolingDegreeDays: 3729, heatingDegreeDays: 1248 }),
    ).find((f) => f.key === "coolingEfficiency")!;
    const seattle = computeCountyFactorsV5(
      county({ coolingDegreeDays: 771, heatingDegreeDays: 5968 }),
    ).find((f) => f.key === "coolingEfficiency")!;
    expect(seattle.value).toBeGreaterThan(phoenix.value);
    expect(phoenix.dataQuality).toBe("real");
    expect(phoenix.value).toBeLessThan(30);
    expect(seattle.value).toBeGreaterThan(80);
  });

  it("falls back to a neutral synthetic cooling value with no normals", () => {
    const f = computeCountyFactorsV5(county()).find((x) => x.key === "coolingEfficiency")!;
    expect(f.value).toBe(50);
    expect(f.dataQuality).toBe("synthetic");
  });
});

describe("coolingScoreFromDegreeDays", () => {
  it("returns null when both inputs are missing", () => {
    expect(coolingScoreFromDegreeDays(null, null)).toBeNull();
  });
  it("penalizes cooling load and rewards free-cooling potential", () => {
    const hot = coolingScoreFromDegreeDays(4000, 200)!;
    const cold = coolingScoreFromDegreeDays(500, 7000)!;
    expect(hot).toBeLessThan(cold);
    expect(hot).toBeGreaterThanOrEqual(0);
    expect(cold).toBeLessThanOrEqual(100);
  });
});

describe("computeCountyBaseScore", () => {
  it("stays within 0..100", () => {
    const low = computeCountyBaseScore(county());
    const high = computeCountyBaseScore(
      county({
        queuedLoadMw: 20000,
        timeToPowerMonths: 18,
        onsiteGenerationFriendly: true,
        largeParcelCount: 40,
        medianLandPricePerAcre: 2000,
        fiberDensityScore: 100,
        peeringExchangeCount: 60,
        taxIncentiveScore: 100,
        rightToBuildZoning: true,
        existingDcCapacityMw: 4000,
        waterStressScore: 5,
        hazardScore: 5,
      }),
    );
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThan(low);
  });
});

describe("computeSignalBoost", () => {
  it("is zero with no signals", () => {
    expect(computeSignalBoost([])).toBe(0);
  });

  it("is capped at 15 points", () => {
    const many = Array.from({ length: 50 }, () =>
      signal({ weight: 5, confidence: 1, detectedAt: "2026-07-01" }),
    );
    expect(computeSignalBoost(many)).toBeLessThanOrEqual(15);
  });

  it("decays with recency — older signals contribute less", () => {
    const recent = computeSignalBoost([signal({ detectedAt: "2026-06-01" })]);
    const old = computeSignalBoost([signal({ detectedAt: "2020-01-01" })]);
    expect(recent).toBeGreaterThan(old);
  });
});

describe("computeLandingProbability", () => {
  it("equals rounded base + boost", () => {
    const c = county({ queuedLoadMw: 5000 });
    const signals = [signal()];
    const p = computeLandingProbability(c, signals);
    const base = computeCountyBaseScore(c);
    const boost = computeSignalBoost(signals);
    expect(p).toBe(Math.round(Math.min(100, base + boost)));
  });
});

describe("scoreTierFor", () => {
  it.each([
    [82, "hot"],
    [75, "hot"],
    [74, "warm"],
    [60, "warm"],
    [59, "emerging"],
    [45, "emerging"],
    [44, "cold"],
    [0, "cold"],
  ])("maps %i -> %s", (p, tier) => {
    expect(scoreTierFor(p as number)).toBe(tier);
  });
});
