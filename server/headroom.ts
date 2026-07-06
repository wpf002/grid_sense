// Power headroom — the "how many MW can I get here, and when?" answer.
//
// There is no public transmission-level load-headroom dataset (it's determined
// by case-by-case ISO/utility studies), so — like the incumbents' internal
// tools — GridSense SYNTHESIZES a headroom estimate from the public signals it
// already ingests: county substation headroom (MVA), ISO interconnection queue
// depth + withdrawal ratio, HIFLD transmission voltage class, and EIA-860
// existing generation. This closes the credibility gap vs. substation-level
// tools (Ascend, Nira) at county granularity.

export interface HeadroomInputs {
  substationHeadroomMva?: number | null;
  queuedMw?: number | null;
  withdrawnMw?: number | null;
  maxVoltageKv?: number | null;
  ehvKm?: number | null; // >=345kV line-km in county
  hvKm?: number | null; // 100-287kV line-km
  existingGenMw?: number | null;
  timeToPowerMonths?: number | null;
  // Data-availability flags so we can tag confidence honestly.
  hasRealSubstation?: boolean;
  hasRealTransmission?: boolean;
  hasRealQueue?: boolean;
}

export type HeadroomTier = "abundant" | "strong" | "moderate" | "constrained" | "limited";

export interface HeadroomDriver {
  label: string;
  detail: string;
  // Signed nudge this driver applied to the score, for transparency.
  impact: number;
}

export interface PowerHeadroom {
  score: number; // 0-100 composite
  tier: HeadroomTier;
  // Rough band of near-term deliverable capacity at/near existing infrastructure.
  deliverableMwLow: number;
  deliverableMwHigh: number;
  timeToPowerMonths: number;
  withdrawalRatio: number | null;
  drivers: HeadroomDriver[];
  confidence: "real" | "partial" | "synthetic";
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
function logNormalize(v: number, cap: number): number {
  if (v <= 0) return 0;
  return clamp((Math.log10(1 + v) / Math.log10(1 + cap)) * 100);
}

// Bulk-transmission capacity band implied by the highest voltage present.
function voltageBand(kv: number | null | undefined): { tier: number; low: number; high: number; label: string } {
  const v = kv ?? 0;
  if (v >= 500) return { tier: 100, low: 1000, high: 3000, label: `${v}kV bulk (500kV+)` };
  if (v >= 345) return { tier: 80, low: 500, high: 1500, label: `${v}kV EHV (345kV)` };
  if (v >= 220) return { tier: 55, low: 150, high: 600, label: `${v}kV HV (230kV)` };
  if (v >= 100) return { tier: 30, low: 50, high: 200, label: `${v}kV sub-transmission` };
  if (v > 0) return { tier: 12, low: 10, high: 60, label: `${v}kV distribution` };
  return { tier: 0, low: 0, high: 0, label: "no transmission mapped" };
}

export function computePowerHeadroom(inp: HeadroomInputs): PowerHeadroom {
  const drivers: HeadroomDriver[] = [];

  // 1) Substation headroom (MVA → ~MW at 0.95 pf). Strongest near-term signal.
  const subMva = inp.substationHeadroomMva ?? 0;
  const subMw = subMva * 0.95;
  const subScore = logNormalize(subMw, 1500); // 100 pts near ~1.5 GW available
  if (subMva > 0) {
    drivers.push({
      label: "Substation headroom",
      detail: `${Math.round(subMva)} MVA (~${Math.round(subMw)} MW) available`,
      impact: Math.round(subScore * 0.4),
    });
  }

  // 2) Transmission voltage class — bulk import capability.
  const band = voltageBand(inp.maxVoltageKv);
  if (band.tier > 0) {
    drivers.push({
      label: "Transmission",
      detail: band.label,
      impact: Math.round(band.tier * 0.3),
    });
  }

  // 3) Existing generation nearby (EIA-860) — grid buildout / BTM potential.
  const genScore = logNormalize(inp.existingGenMw ?? 0, 2000);
  if ((inp.existingGenMw ?? 0) > 0) {
    drivers.push({
      label: "Nearby generation",
      detail: `${Math.round(inp.existingGenMw ?? 0)} MW EIA-860`,
      impact: Math.round(genScore * 0.15),
    });
  }

  // 4) Queue congestion penalty — a high withdrawal ratio means projects give
  //    up before energizing: a bad sign for actually getting power.
  const queued = inp.queuedMw ?? 0;
  const withdrawn = inp.withdrawnMw ?? 0;
  const withdrawalRatio = queued + withdrawn > 0 ? withdrawn / (queued + withdrawn) : null;
  let congestionPenalty = 0;
  if (withdrawalRatio != null) {
    congestionPenalty = withdrawalRatio * 25;
    drivers.push({
      label: "Queue congestion",
      detail: `${Math.round(withdrawalRatio * 100)}% of queue MW withdrawn`,
      impact: -Math.round(congestionPenalty),
    });
  }

  const score = clamp(
    subScore * 0.4 + band.tier * 0.3 + genScore * 0.15 - congestionPenalty + 10,
  );

  // Deliverable-MW band: prefer the substation figure, floored/extended by the
  // transmission band so a well-connected but unstudied county still shows range.
  const deliverableMwLow = Math.round(Math.max(subMw * 0.5, band.low * 0.25));
  const deliverableMwHigh = Math.round(Math.max(subMw, band.high));

  // Time-to-power: base energization estimate, worsened by congestion, improved
  // by ready substation headroom + EHV presence.
  let ttp = inp.timeToPowerMonths ?? 48;
  if (withdrawalRatio != null) ttp += withdrawalRatio * 18;
  if (subMva > 300) ttp -= 8;
  if ((inp.maxVoltageKv ?? 0) >= 345) ttp -= 4;
  const timeToPowerMonths = Math.max(12, Math.round(ttp));

  const tier: HeadroomTier =
    score >= 80 ? "abundant" :
    score >= 62 ? "strong" :
    score >= 45 ? "moderate" :
    score >= 28 ? "constrained" : "limited";

  const confidence: PowerHeadroom["confidence"] =
    inp.hasRealSubstation && inp.hasRealTransmission
      ? "real"
      : inp.hasRealTransmission || inp.hasRealQueue
        ? "partial"
        : "synthetic";

  return {
    score,
    tier,
    deliverableMwLow,
    deliverableMwHigh,
    timeToPowerMonths,
    withdrawalRatio,
    drivers,
    confidence,
  };
}
