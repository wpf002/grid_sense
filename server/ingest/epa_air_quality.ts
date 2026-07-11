/**
 * EPA Air Quality (annual AQI by county) — real, keyless, county-FIPS-joinable.
 *
 * Why it matters for data-center siting: a county in air-quality nonattainment
 * (lots of unhealthy AQI days, ozone/PM2.5-driven) faces stricter New Source
 * Review air permitting for the diesel/gas BACKUP GENERATORS every hyperscale
 * data center installs. Cleaner-air counties clear those permits faster. This is
 * informational context today — surfaced on the county page — not yet a weighted
 * scoring factor (that needs backtest validation before it can move scores).
 *
 * SOURCE: EPA AirData pre-generated files (no API key, bulk CSV in a zip):
 *   https://aqs.epa.gov/aqsweb/airdata/annual_aqi_by_county_<year>.zip
 * The CSV carries full State + County NAMES and per-county AQI metrics. We try
 * the current year, falling back a year if EPA hasn't posted it yet.
 */
import AdmZip from "adm-zip";
import { sqlite } from "../storage.js";
import { beginRun, fetchBuffer } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const AIRDATA = "https://aqs.epa.gov/aqsweb/airdata";
const DAY = 24 * 3600 * 1000;

// EPA uses full state names; lookupFips wants the 2-letter abbreviation.
const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District Of Columbia": "DC",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI",
  Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX",
  Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
};

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS county_air_quality (
      fips TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      days_with_aqi INTEGER,
      good_days INTEGER,
      moderate_days INTEGER,
      unhealthy_sensitive_days INTEGER,
      unhealthy_days INTEGER,
      very_unhealthy_days INTEGER,
      hazardous_days INTEGER,
      max_aqi INTEGER,
      median_aqi INTEGER,
      days_ozone INTEGER,
      days_pm25 INTEGER,
      source_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `);
}

export { STATE_NAME_TO_CODE };

/** Split one CSV line honoring simple double-quoted fields (no embedded quotes). */
export function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function fetchAqiCsv(): Promise<{ csv: string; url: string; year: number } | null> {
  // The current year's file appears partway through the year; fall back one.
  for (const year of [2025, 2024, 2023]) {
    const url = `${AIRDATA}/annual_aqi_by_county_${year}.zip`;
    try {
      const buf = await fetchBuffer(url, { cacheKey: `epa_aqi_${year}.zip`, maxAgeMs: 30 * DAY });
      const entry = new AdmZip(buf).getEntries().find((e) => e.entryName.endsWith(".csv"));
      if (!entry) continue;
      return { csv: entry.getData().toString("utf8"), url, year };
    } catch (e: any) {
      console.warn(`[epa_air_quality] ${year} unavailable (${e?.message ?? e})`);
    }
  }
  return null;
}

export async function ingestEpaAirQuality(): Promise<number> {
  const run = beginRun("epa_air_quality", "EPA AirData annual AQI by county");
  try {
    ensureTable();
    const got = await fetchAqiCsv();
    if (!got) {
      run.fail(new Error("No EPA AirData AQI file could be fetched"));
      throw new Error("No EPA AirData AQI file could be fetched");
    }

    const lines = got.csv.split(/\r?\n/).filter((l) => l.trim());
    const header = splitCsv(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
    const col = (name: string) => header.indexOf(name);
    const iState = col("State"), iCounty = col("County"), iYear = col("Year");
    const iDays = col("Days with AQI"), iGood = col("Good Days"), iMod = col("Moderate Days");
    const iUsg = col("Unhealthy for Sensitive Groups Days"), iUnh = col("Unhealthy Days");
    const iVu = col("Very Unhealthy Days"), iHaz = col("Hazardous Days");
    const iMax = col("Max AQI"), iMed = col("Median AQI");
    const iOz = col("Days Ozone"), iPm = col("Days PM2.5");
    if (iState < 0 || iCounty < 0) throw new Error("EPA AQI header not recognized");

    const validFips = new Set<string>(
      (sqlite.prepare("SELECT fips FROM counties").all() as { fips: string }[]).map((r) => r.fips),
    );
    const now = new Date().toISOString();
    const num = (cells: string[], i: number) => (i >= 0 ? Number(cells[i]) || 0 : 0);

    const stmt = sqlite.prepare(`
      INSERT INTO county_air_quality
        (fips, year, days_with_aqi, good_days, moderate_days, unhealthy_sensitive_days,
         unhealthy_days, very_unhealthy_days, hazardous_days, max_aqi, median_aqi,
         days_ozone, days_pm25, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fips) DO UPDATE SET
        year=excluded.year, days_with_aqi=excluded.days_with_aqi, good_days=excluded.good_days,
        moderate_days=excluded.moderate_days, unhealthy_sensitive_days=excluded.unhealthy_sensitive_days,
        unhealthy_days=excluded.unhealthy_days, very_unhealthy_days=excluded.very_unhealthy_days,
        hazardous_days=excluded.hazardous_days, max_aqi=excluded.max_aqi, median_aqi=excluded.median_aqi,
        days_ozone=excluded.days_ozone, days_pm25=excluded.days_pm25,
        source_url=excluded.source_url, fetched_at=excluded.fetched_at
    `);

    let inserted = 0, unresolved = 0;
    const seen = new Set<string>();
    const tx = sqlite.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        const c = splitCsv(lines[i]).map((s) => s.replace(/^"|"$/g, ""));
        const stateName = c[iState];
        const county = c[iCounty];
        const abbr = STATE_NAME_TO_CODE[stateName];
        if (!abbr || !county) { unresolved++; continue; }
        const fips = lookupFips(abbr, normalizeCountyName(county));
        // The AQI file has one row per county; skip counties we don't track, and
        // guard against the rare duplicate (keep the first).
        if (!fips || !validFips.has(fips) || seen.has(fips)) { if (!fips) unresolved++; continue; }
        seen.add(fips);
        stmt.run(
          fips, num(c, iYear), num(c, iDays), num(c, iGood), num(c, iMod), num(c, iUsg),
          num(c, iUnh), num(c, iVu), num(c, iHaz), num(c, iMax), num(c, iMed),
          num(c, iOz), num(c, iPm), got.url, now,
        );
        inserted++;
      }
    });
    tx();

    const note = `${inserted} counties from EPA ${got.year} AQI (${unresolved} rows without a tracked county)`;
    console.log(`[epa_air_quality] ${note}`);
    run.complete(inserted, note);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestEpaAirQuality()
    .then((n) => console.log(JSON.stringify({ rows: n })))
    .catch((e) => { console.error(e); process.exit(1); });
}
