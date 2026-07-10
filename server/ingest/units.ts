// Pure conversion / validation helpers shared by the ingest pipelines.
//
// These live apart from the ingests on purpose: they have no database or network
// dependency, so they can be unit-tested directly. Every function here encodes a
// bug that actually shipped:
//
//   toAcres              — sqft/sqm layers were compared against an ACRE range,
//                          silently rejecting every parcel in 6 counties.
//   isPlausibleParcelPrice — raw assessor price fields carry bulk-sale totals
//                          smeared across parcels (a bogus $20M/acre).
//   excelSerialToIso     — LBNL/ICE workbooks store dates as Excel serials.
//   normalizeFips        — LBNL drops the leading zero ("4005" is Coconino, AZ).

/** Divisor to convert an area field to acres. */
export const AREA_DIV: Record<string, number> = { sqft: 43560, sqm: 4046.86 };

export type AreaUnit = "sqft" | "sqm";

/**
 * Convert a raw area value to acres. `areaUnit` undefined means the field is
 * already in acres. Returns NaN for non-numeric input.
 */
export function toAcres(rawArea: unknown, areaUnit?: AreaUnit): number {
  // Number(null) and Number("") are 0, which would read as a real zero-acre
  // parcel rather than a missing field. Reject the empties first.
  if (rawArea === null || rawArea === undefined || rawArea === "") return NaN;
  const n = Number(rawArea);
  if (!Number.isFinite(n)) return NaN;
  const div = areaUnit ? AREA_DIV[areaUnit] : 1;
  return n / div;
}

/**
 * Is this a believable parcel price? Rejects $0/nominal transfers and the
 * per-acre outliers typical of raw assessor fields. Ceiling is ~3x the priciest
 * US data-center dirt (Loudoun peaks near $1.5M/acre).
 */
export function isPlausibleParcelPrice(rawPrice: unknown, acres: number): boolean {
  const p = Number(rawPrice);
  if (!Number.isFinite(p) || p <= 1000) return false;
  if (!Number.isFinite(acres) || acres <= 0) return false;
  const perAcre = p / acres;
  return perAcre >= 500 && perAcre <= 5_000_000;
}

/**
 * Excel serial date -> ISO yyyy-mm-dd. Excel's epoch is 1899-12-30 (its
 * fictitious 1900 leap year is why it isn't 12-31). Serial 25569 = 1970-01-01.
 * Values outside a sane window return null rather than a bogus date.
 */
export function excelSerialToIso(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 10000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

/** Zero-pad a county FIPS to 5 digits; null when it can't be one. */
export function normalizeFips(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length !== 4 && digits.length !== 5) return null;
  return digits.padStart(5, "0");
}

/**
 * Map a county to the wholesale hub region that actually prices its power.
 * Returns null where no hub is published (SPP / NYISO / TVA / FRCC / Southeast)
 * so callers show "no price" rather than inventing one.
 */
export function regionForCounty(iso: string | null, state: string, lat: number | null): string | null {
  const i = (iso ?? "").toUpperCase();
  if (i.includes("ERCOT")) return "ERCOT";
  if (i.includes("PJM")) return "PJM";
  if (i.includes("MISO")) return "MISO";
  if (i.includes("ISO-NE") || i.includes("ISONE")) return "ISONE";
  if (i.includes("CAISO")) return (lat ?? 0) >= 36.5 ? "CAISO_NP15" : "CAISO_SP15";
  if (i.includes("BPA")) return "MIDC";
  if (["AZ", "NM", "NV"].includes(state)) return "PALOVERDE";
  if (["WA", "OR", "ID", "MT"].includes(state)) return "MIDC";
  return null;
}
