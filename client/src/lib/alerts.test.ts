import { describe, it, expect } from "vitest";
import { parseAlert, alertSentence, firedAtLabel } from "./alerts";

const mk = (title: string, detail: string) => ({ title, detail });

// The alert generator writes log lines, not sentences. These strings are
// verbatim from the alerts table; the UI depends on taking them apart.
describe("parseAlert", () => {
  it("parses a tier downgrade", () => {
    const p = parseAlert(mk("Washington, WI: emerging → cold", "Landing-probability fell 5 pts day-over-day (2026-07-07 → 2026-07-09)."));
    expect(p.place).toBe("Washington, WI");
    expect(p.fromTier).toBe("emerging");
    expect(p.toTier).toBe("cold");
    expect(p.direction).toBe("down");
    expect(p.points).toBe(5);
    expect(p.fromDate).toBe("2026-07-07");
    expect(p.toDate).toBe("2026-07-09");
  });

  it("parses a tier upgrade", () => {
    const p = parseAlert(mk("Rock, WI: emerging → warm", "Landing-probability rose 6 pts day-over-day (2026-07-07 → 2026-07-09)."));
    expect(p.direction).toBe("up");
    expect(p.points).toBe(6);
  });

  it("ranks hot > warm > emerging > cold", () => {
    expect(parseAlert(mk("X, TX: warm → emerging", "")).direction).toBe("down");
    expect(parseAlert(mk("X, TX: cold → hot", "")).direction).toBe("up");
    expect(parseAlert(mk("X, TX: warm → warm", "")).direction).toBe("neutral");
  });

  it("falls back to the detail verb when the title carries no tier arrow", () => {
    const p = parseAlert(mk("Loudoun, VA", "Landing-probability fell 3 pts."));
    expect(p.fromTier).toBeNull();
    expect(p.direction).toBe("down");
    expect(p.points).toBe(3);
  });

  it("reads a decimal point value", () => {
    expect(parseAlert(mk("X, TX: warm → hot", "rose 2.5 pts")).points).toBe(2.5);
  });

  it("degrades to neutral instead of throwing on an unrecognized alert", () => {
    const p = parseAlert(mk("Shell LLC resolved to Meta", "Raven Northbrook LLC tied to Meta."));
    expect(p.direction).toBe("neutral");
    expect(p.points).toBeNull();
    expect(p.fromTier).toBeNull();
  });

  it("survives an empty alert", () => {
    const p = parseAlert(mk("", ""));
    expect(p.direction).toBe("neutral");
    expect(p.points).toBeNull();
  });
});

describe("alertSentence", () => {
  it("writes a sentence a person would say", () => {
    const p = parseAlert(mk("Washington, WI: emerging → cold", "Landing-probability fell 5 pts day-over-day (2026-07-07 → 2026-07-09)."));
    expect(alertSentence(p, "")).toBe("Landing probability fell 5 points between Jul 7 and Jul 9.");
  });

  it("says 'point' for exactly one", () => {
    const p = parseAlert(mk("X, TX: warm → emerging", "fell 1 pt day-over-day"));
    expect(alertSentence(p, "")).toBe("Landing probability fell 1 point.");
  });

  it("falls back to the raw detail when there is no point count", () => {
    const p = parseAlert(mk("Shell LLC resolved", "Raven Northbrook LLC tied to Meta."));
    expect(alertSentence(p, "Raven Northbrook LLC tied to Meta.")).toBe("Raven Northbrook LLC tied to Meta.");
  });
});

describe("firedAtLabel", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");
  it("labels recent alerts relatively", () => {
    expect(firedAtLabel("2026-07-10T11:40:00Z", now)).toBe("Just now");
    expect(firedAtLabel("2026-07-10T06:00:00Z", now)).toBe("6h ago");
    expect(firedAtLabel("2026-07-09T06:00:00Z", now)).toBe("Yesterday");
  });
  it("falls back to a date for older alerts", () => {
    expect(firedAtLabel("2026-07-01T06:00:00Z", now)).toMatch(/Jul/);
  });
  it("returns empty string for an invalid date", () => {
    expect(firedAtLabel("not-a-date", now)).toBe("");
  });
});
