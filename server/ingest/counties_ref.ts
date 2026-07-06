// County-name -> FIPS lookup. Sourced from US Census 2020 county gazetteer.
// https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REF_PATH = join(process.cwd(), "data/ref/us_counties_2020.psv");
export const CENSUS_SOURCE_URL =
  "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt";

type CountyRef = {
  state: string;
  stateFp: string;
  countyFp: string;
  fips: string;
  name: string;         // "Autauga County"
  nameNorm: string;     // "autauga"
};

let cache: CountyRef[] | null = null;
let byStateName: Map<string, string> | null = null;

function loadCounties(): CountyRef[] {
  if (cache) return cache;
  const raw = readFileSync(REF_PATH, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const rows: CountyRef[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("|");
    if (parts.length < 5) continue;
    const [state, stateFp, countyFp, , name] = parts;
    rows.push({
      state,
      stateFp,
      countyFp,
      fips: stateFp + countyFp,
      name,
      nameNorm: normalizeCountyName(name),
    });
  }
  cache = rows;
  return rows;
}

export function normalizeCountyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+county$/i, "")
    .replace(/\s+parish$/i, "")
    .replace(/\s+borough$/i, "")
    .replace(/\s+census area$/i, "")
    .replace(/\s+municipality$/i, "")
    .replace(/\s+city and borough$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .trim();
}

/** Look up 5-digit FIPS by (state-abbr, county-name). Returns null if not found. */
export function lookupFips(state: string, countyName: string): string | null {
  if (!byStateName) {
    byStateName = new Map();
    for (const row of loadCounties()) {
      byStateName.set(`${row.state}|${row.nameNorm}`, row.fips);
    }
  }
  const key = `${state.toUpperCase()}|${normalizeCountyName(countyName)}`;
  return byStateName.get(key) ?? null;
}

/** Return all counties (used to seed county-scale iteration when needed). */
export function allCounties(): CountyRef[] {
  return loadCounties();
}
