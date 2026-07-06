import { describe, it, expect } from "vitest";
import { computePowerHeadroom } from "./headroom";

describe("computePowerHeadroom", () => {
  it("returns a limited tier for a county with no signals", () => {
    const h = computePowerHeadroom({});
    expect(h.score).toBeLessThan(28);
    expect(h.tier).toBe("limited");
    expect(h.confidence).toBe("synthetic");
    expect(h.deliverableMwHigh).toBe(0);
  });

  it("scores a well-connected county high and marks it real", () => {
    const h = computePowerHeadroom({
      substationHeadroomMva: 1200,
      maxVoltageKv: 500,
      existingGenMw: 2500,
      queuedMw: 8000,
      withdrawnMw: 200,
      timeToPowerMonths: 30,
      hasRealSubstation: true,
      hasRealTransmission: true,
      hasRealQueue: true,
    });
    expect(h.score).toBeGreaterThan(70);
    expect(["strong", "abundant"]).toContain(h.tier);
    expect(h.confidence).toBe("real");
    expect(h.deliverableMwHigh).toBeGreaterThan(1000);
  });

  it("penalizes a congested queue (high withdrawal ratio)", () => {
    const base = {
      substationHeadroomMva: 400,
      maxVoltageKv: 345,
      existingGenMw: 500,
      timeToPowerMonths: 40,
    };
    const clean = computePowerHeadroom({ ...base, queuedMw: 5000, withdrawnMw: 200 });
    const congested = computePowerHeadroom({ ...base, queuedMw: 2000, withdrawnMw: 6000 });
    expect(congested.score).toBeLessThan(clean.score);
    expect(congested.timeToPowerMonths).toBeGreaterThan(clean.timeToPowerMonths);
    expect(congested.withdrawalRatio).toBeGreaterThan(0.5);
  });

  it("computes a deliverable-MW band from substation headroom", () => {
    const h = computePowerHeadroom({ substationHeadroomMva: 1000, maxVoltageKv: 230 });
    // ~950 MW at 0.95 pf; high end tracks the substation figure.
    expect(h.deliverableMwHigh).toBeGreaterThanOrEqual(900);
    expect(h.deliverableMwLow).toBeGreaterThan(0);
    expect(h.deliverableMwLow).toBeLessThan(h.deliverableMwHigh);
  });

  it("marks partial confidence when only transmission is real", () => {
    const h = computePowerHeadroom({ maxVoltageKv: 345, hasRealTransmission: true });
    expect(h.confidence).toBe("partial");
  });

  it("surfaces transparent drivers", () => {
    const h = computePowerHeadroom({
      substationHeadroomMva: 500,
      maxVoltageKv: 500,
      existingGenMw: 1000,
      queuedMw: 3000,
      withdrawnMw: 3000,
    });
    const labels = h.drivers.map((d) => d.label);
    expect(labels).toContain("Substation headroom");
    expect(labels).toContain("Transmission");
    expect(labels).toContain("Queue congestion");
    // Congestion driver is a negative impact.
    expect(h.drivers.find((d) => d.label === "Queue congestion")!.impact).toBeLessThan(0);
  });

  it("keeps time-to-power at least 12 months", () => {
    const h = computePowerHeadroom({
      substationHeadroomMva: 5000,
      maxVoltageKv: 765,
      timeToPowerMonths: 14,
    });
    expect(h.timeToPowerMonths).toBeGreaterThanOrEqual(12);
  });
});
