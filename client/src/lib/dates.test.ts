import { describe, it, expect, beforeAll } from "vitest";
import { formatDay, dayParts, isDateOnly } from "./dates";

// This suite is meaningless in UTC — the bug only appears west of Greenwich.
// vitest.config.ts pins TZ=America/Chicago (UTC-5) so these assertions bite.
describe("timezone guard", () => {
  it("runs in a non-UTC zone, or the rest of this file proves nothing", () => {
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);
  });
});

describe("isDateOnly", () => {
  it("distinguishes date-only strings from timestamps", () => {
    expect(isDateOnly("2026-07-10")).toBe(true);
    expect(isDateOnly("2026-07-10T00:00:00Z")).toBe(false);
    expect(isDateOnly("2026-07-09T20:12:28.409Z")).toBe(false);
  });
});

describe("formatDay", () => {
  // REGRESSION: signals detected on 2026-07-10 rendered as "Jul 9, 2026" for
  // every US user, making a same-day feed look a day stale.
  it("does not shift a date-only string backwards", () => {
    expect(formatDay("2026-07-10")).toBe("Jul 10, 2026");
    expect(formatDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDay("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("honors custom format options on a date-only string", () => {
    expect(formatDay("2026-07-10", { month: "long", day: "numeric" })).toBe("July 10");
  });

  it("renders a real timestamp in the local zone", () => {
    // 2026-07-10T02:00:00Z is still Jul 9 in Chicago (UTC-5). That is correct:
    // a timestamp is an instant, and the local calendar day is what happened.
    expect(formatDay("2026-07-10T02:00:00Z")).toBe("Jul 9, 2026");
    expect(formatDay("2026-07-10T18:00:00Z")).toBe("Jul 10, 2026");
  });

  it("returns an empty string rather than 'Invalid Date'", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay(null)).toBe("");
    expect(formatDay(undefined)).toBe("");
    expect(formatDay("garbage")).toBe("");
  });
});

describe("dayParts", () => {
  it("keeps month/day/year on the same calendar day for date-only input", () => {
    expect(dayParts("2026-07-10")).toEqual({ month: "Jul", day: "10", year: "2026" });
  });

  it("does not roll a new year backwards", () => {
    expect(dayParts("2026-01-01")).toEqual({ month: "Jan", day: "1", year: "2026" });
  });

  it("degrades safely on bad input", () => {
    expect(dayParts("nope")).toEqual({ month: "", day: "", year: "" });
  });
});
