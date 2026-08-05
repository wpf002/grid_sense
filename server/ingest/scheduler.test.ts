import { describe, it, expect } from "vitest";
import { staleAfterDays, isRetriable } from "./scheduler";

// REGRESSION: the freshness banner used a flat ~8-day cutoff, so it cried "20
// feeds behind schedule" when quarterly feeds at 27 days were perfectly on
// schedule. Staleness now reads each feed's own cadence.
describe("staleAfterDays", () => {
  it("uses each feed's real refresh cadence", () => {
    expect(staleAfterDays("wholesale_price")).toBe(1);   // daily
    expect(staleAfterDays("socrata_permits")).toBe(7);   // weekly
    expect(staleAfterDays("pjm_queue")).toBe(30);        // monthly
    expect(staleAfterDays("epa_air_quality")).toBe(90);  // quarterly
    expect(staleAfterDays("lbnl_queue")).toBe(300);      // annual
  });

  it("a quarterly feed at 27 days is NOT behind schedule", () => {
    expect(27).toBeLessThan(staleAfterDays("eia861"));
    expect(27).toBeLessThan(staleAfterDays("hifld_transmission"));
  });

  it("treats fast (6-hourly) feeds as behind after 2 days", () => {
    expect(staleAfterDays("dc_news")).toBe(2);
    expect(staleAfterDays("edgar")).toBe(2);
    expect(staleAfterDays("score_history_daily")).toBe(2);
  });

  it("never flags derived/curated pipelines that aren't independently fetched", () => {
    // These run as part of other flows; they don't age out on their own.
    expect(staleAfterDays("dc_announcements_real")).toBe(Infinity);
    expect(staleAfterDays("enrich")).toBe(Infinity);
    expect(staleAfterDays("comps")).toBe(Infinity);
  });
});

describe("isRetriable", () => {
  it("allows cadence feeds and the fast feeds", () => {
    expect(isRetriable("pjm_queue")).toBe(true);
    expect(isRetriable("epa_air_quality")).toBe(true);
    expect(isRetriable("dc_news")).toBe(true);
  });
  it("rejects recorded-but-not-runnable names", () => {
    expect(isRetriable("epa_ozone")).toBe(false);
    expect(isRetriable("sec_edgar")).toBe(false);
    expect(isRetriable("score_history_daily")).toBe(false);
  });
});
