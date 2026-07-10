import { describe, it, expect } from "vitest";
import {
  toAcres,
  isPlausibleParcelPrice,
  excelSerialToIso,
  normalizeFips,
  regionForCounty,
} from "./units";

// Each block below is a regression test for a bug that shipped to production.

describe("toAcres — area unit conversion", () => {
  it("passes acre-native values through untouched", () => {
    expect(toAcres(50)).toBe(50);
    expect(toAcres(1141.87)).toBeCloseTo(1141.87, 2);
  });

  it("REGRESSION: converts square feet instead of comparing raw sqft to an acre range", () => {
    // The shipped bug: a 900,000 sqft parcel (~20.7 ac) was compared as "900000
    // acres" against the 20-5000 acre band and rejected. Every parcel in every
    // sqft layer was dropped, which looked like six dead county endpoints.
    expect(toAcres(900_000, "sqft")).toBeCloseTo(20.66, 2);
    expect(toAcres(43_560, "sqft")).toBe(1);
    // Franklin County OH's STATEDAREA is sqft: 37,844 is a suburban lot, not a farm.
    expect(toAcres(37_844, "sqft")).toBeCloseTo(0.87, 2);
  });

  it("converts square metres", () => {
    expect(toAcres(4046.86, "sqm")).toBeCloseTo(1, 4);
  });

  it("a sqft parcel that should pass the 20-5000 acre filter actually does", () => {
    const acres = toAcres(1_500_000, "sqft"); // ~34 ac
    expect(acres).toBeGreaterThan(20);
    expect(acres).toBeLessThan(5000);
  });

  it("returns NaN for non-numeric input rather than 0", () => {
    expect(toAcres(null)).toBeNaN();
    expect(toAcres("abc")).toBeNaN();
    expect(toAcres(undefined, "sqft")).toBeNaN();
  });
});

describe("isPlausibleParcelPrice", () => {
  it("rejects $0 and nominal transfers", () => {
    expect(isPlausibleParcelPrice(0, 100)).toBe(false);
    expect(isPlausibleParcelPrice(1, 100)).toBe(false);
    expect(isPlausibleParcelPrice(1000, 100)).toBe(false);
  });

  it("REGRESSION: rejects bulk-sale totals smeared across parcels", () => {
    // Franklin County: the same $739,530,000 appeared on a 36ac and a 27ac
    // parcel — a portfolio price, i.e. ~$20M/acre. Nonsense.
    expect(isPlausibleParcelPrice(739_530_000, 36)).toBe(false);
    expect(isPlausibleParcelPrice(739_530_000, 27)).toBe(false);
  });

  it("accepts real high-value suburban land", () => {
    // Chesterfield VA: 57 ac at $106M => ~$1.85M/acre. Steep but real.
    expect(isPlausibleParcelPrice(106_000_000, 57)).toBe(true);
    // Wake NC: 508 ac at $305M => ~$600k/acre.
    expect(isPlausibleParcelPrice(305_354_990, 508)).toBe(true);
    // Wake NC: 4,584 ac at $474M => ~$103k/acre (rural).
    expect(isPlausibleParcelPrice(474_053_257, 4584)).toBe(true);
  });

  it("rejects absurdly cheap per-acre values and bad acreage", () => {
    expect(isPlausibleParcelPrice(2000, 100)).toBe(false); // $20/acre
    expect(isPlausibleParcelPrice(500_000, 0)).toBe(false);
    expect(isPlausibleParcelPrice(500_000, NaN)).toBe(false);
  });
});

describe("excelSerialToIso", () => {
  it("anchors on the Unix epoch (Excel serial 25569 = 1970-01-01)", () => {
    expect(excelSerialToIso(25569)).toBe("1970-01-01");
  });

  it("round-trips a known modern date", () => {
    // 2024-01-01 is Excel serial 45292.
    expect(excelSerialToIso(45292)).toBe("2024-01-01");
  });

  it("rejects values outside a sane window rather than emitting a bogus date", () => {
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(5)).toBeNull(); // year 1900
    expect(excelSerialToIso(999_999)).toBeNull();
    expect(excelSerialToIso("")).toBeNull();
    expect(excelSerialToIso(null)).toBeNull();
  });
});

describe("normalizeFips", () => {
  it("REGRESSION: restores the leading zero LBNL drops", () => {
    // LBNL writes Coconino County, AZ as 4005, not 04005.
    expect(normalizeFips(4005)).toBe("04005");
    expect(normalizeFips("4005")).toBe("04005");
  });

  it("leaves a well-formed 5-digit FIPS alone", () => {
    expect(normalizeFips("48441")).toBe("48441"); // Taylor, TX
  });

  it("returns null for anything that cannot be a county FIPS", () => {
    expect(normalizeFips("")).toBeNull();
    expect(normalizeFips("123")).toBeNull();
    expect(normalizeFips("123456")).toBeNull();
    expect(normalizeFips(null)).toBeNull();
  });
});

describe("regionForCounty — wholesale hub mapping", () => {
  it("maps RTO counties to their trading hub", () => {
    expect(regionForCounty("PJM", "VA", 39.1)).toBe("PJM"); // Loudoun
    expect(regionForCounty("MISO", "IA", 42.0)).toBe("MISO");
    expect(regionForCounty("ERCOT", "TX", 32.3)).toBe("ERCOT"); // Taylor
    expect(regionForCounty("ISO-NE", "MA", 42.3)).toBe("ISONE");
  });

  it("splits CAISO north/south at latitude 36.5", () => {
    expect(regionForCounty("CAISO", "CA", 37.3)).toBe("CAISO_NP15"); // Santa Clara
    expect(regionForCounty("CAISO", "CA", 34.0)).toBe("CAISO_SP15"); // LA
  });

  it("maps non-RTO West to Palo Verde / Mid-C", () => {
    expect(regionForCounty("WECC", "AZ", 33.4)).toBe("PALOVERDE"); // Maricopa
    expect(regionForCounty("BPA", "WA", 47.2)).toBe("MIDC"); // Grant
    expect(regionForCounty(null, "OR", 45.0)).toBe("MIDC");
  });

  it("returns null where no hub is published, rather than inventing a price", () => {
    expect(regionForCounty("SPP", "KS", 37.7)).toBeNull();
    expect(regionForCounty("NYISO", "NY", 42.6)).toBeNull();
    expect(regionForCounty("TVA", "TN", 35.0)).toBeNull();
    expect(regionForCounty("SERC (Southern)", "GA", 33.7)).toBeNull();
  });
});
