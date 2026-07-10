// Build a RealDataOverlay object for a given county FIPS by joining raw
// tables (EIA-860, HIFLD, ISO queue, FEMA NRI). All lookups are indexed
// so this is fast enough to call per-county during rescoring.

import { sqlite } from "../storage.js";
import { regionForCounty } from "./wholesale_price.js";
import type { RealDataOverlay } from "../scoring.js";

// Cache-per-run maps built lazily.
let _eiaMap: Map<string, { totalMw: number; genCount: number }> | null = null;
let _hifldMap: Map<string, {
  linesCount: number;
  hvLinesCount: number;
  ehvLinesCount: number;
  maxVoltage: number | null;
}> | null = null;
let _queueMap: Map<string, { rowsCount: number; queuedMw: number; withdrawnMw: number; ttpMonths: number | null }> | null = null;
let _nriMap: Map<string, { riskScore: number | null; ealScore: number | null }> | null = null;
let _powerMap: Map<string, { usdPerMwh: number; quality: "real" | "partial" }> | null = null;

export function warmOverlayCaches() {
  _eiaMap = new Map();
  const eiaRows = sqlite
    .prepare(`
      SELECT fips, SUM(nameplate_mw) as totalMw, COUNT(*) as genCount
      FROM raw_eia_generators
      WHERE status = 'OP' AND fips IS NOT NULL
      GROUP BY fips
    `)
    .all() as { fips: string; totalMw: number; genCount: number }[];
  for (const r of eiaRows) _eiaMap.set(r.fips, { totalMw: r.totalMw ?? 0, genCount: r.genCount });

  _hifldMap = new Map();
  // Read the real HIFLD aggregate (transmission_county_agg) written by
  // hifld_transmission.ts. It stores km per voltage band + a segment count, so
  // approximate the line counts scoring expects: split segments in proportion to
  // each band's share of total km. EHV = ≥345 kV, HV = 100-287 kV.
  const hifldRows = sqlite
    .prepare(`SELECT fips,
                segment_count AS linesCount,
                CAST(segment_count * (COALESCE(km_345,0)+COALESCE(km_500,0)+COALESCE(km_735_up,0)) / NULLIF(total_km,0) AS INTEGER) AS ehvLinesCount,
                CAST(segment_count * (COALESCE(km_100_161,0)+COALESCE(km_220_287,0)) / NULLIF(total_km,0) AS INTEGER) AS hvLinesCount,
                max_voltage_kv AS maxVoltage
              FROM transmission_county_agg`)
    .all() as any[];
  for (const r of hifldRows) _hifldMap.set(r.fips, r);

  _queueMap = new Map();
  // Aggregate PJM + MISO + ERCOT by fips. Split active vs withdrawn.
  const queueRows = sqlite
    .prepare(`
      SELECT fips,
             COUNT(*) as rowsCount,
             SUM(CASE WHEN LOWER(COALESCE(status,'')) NOT LIKE '%withdrawn%' THEN COALESCE(mw,0) ELSE 0 END) as queuedMw,
             SUM(CASE WHEN LOWER(COALESCE(status,'')) LIKE '%withdrawn%' THEN COALESCE(mw,0) ELSE 0 END) as withdrawnMw
      FROM raw_iso_queue
      WHERE fips IS NOT NULL
      GROUP BY fips
    `)
    .all() as { fips: string; rowsCount: number; queuedMw: number; withdrawnMw: number }[];
  for (const r of queueRows)
    _queueMap.set(r.fips, {
      rowsCount: r.rowsCount,
      queuedMw: r.queuedMw ?? 0,
      withdrawnMw: r.withdrawnMw ?? 0,
      ttpMonths: null,
    });

  // Real time-to-power: the median queue-entry -> in-service duration (months)
  // from dated projects. Use the county median where we have >= 3 dated projects,
  // otherwise the ISO-region median. Filtered to recent submissions (last 8y) and
  // plausible durations (6-120 months) to drop stalled decades-old outliers.
  const durRows = sqlite
    .prepare(`
      SELECT fips, iso, (julianday(expected_in_service) - julianday(submitted_date)) / 30.44 AS months
      FROM raw_iso_queue
      WHERE fips IS NOT NULL AND submitted_date IS NOT NULL AND expected_in_service IS NOT NULL
        AND submitted_date >= date('now', '-8 years')
    `)
    .all() as { fips: string; iso: string; months: number }[];
  const median = (a: number[]): number => {
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const push = (map: Map<string, number[]>, key: string, v: number) => {
    const arr = map.get(key); if (arr) arr.push(v); else map.set(key, [v]);
  };
  const countyDur = new Map<string, number[]>();
  const isoDur = new Map<string, number[]>();
  for (const r of durRows) {
    if (!(r.months >= 6 && r.months <= 120)) continue;
    push(countyDur, r.fips, r.months);
    if (r.iso) push(isoDur, r.iso, r.months);
  }
  const isoMedian = new Map<string, number>();
  for (const [iso, arr] of isoDur) isoMedian.set(iso, median(arr));
  const fipsIso = new Map<string, string>();
  for (const r of sqlite.prepare("SELECT fips, iso FROM raw_iso_queue WHERE fips IS NOT NULL").all() as { fips: string; iso: string }[]) {
    if (!fipsIso.has(r.fips) && r.iso) fipsIso.set(r.fips, r.iso);
  }
  for (const [fips, entry] of _queueMap) {
    const cd = countyDur.get(fips);
    if (cd && cd.length >= 3) entry.ttpMonths = Math.round(median(cd));
    else {
      const iso = fipsIso.get(fips);
      if (iso && isoMedian.has(iso)) entry.ttpMonths = Math.round(isoMedian.get(iso)!);
    }
  }

  _nriMap = new Map();
  const nriRows = sqlite
    .prepare(`SELECT fips, riskScore, ealScore FROM raw_fema_nri`)
    .all() as { fips: string; riskScore: number | null; ealScore: number | null }[];
  for (const r of nriRows) _nriMap.set(r.fips, { riskScore: r.riskScore, ealScore: r.ealScore });

  // Power price per county: the REAL traded wholesale hub price where one is
  // published, otherwise the state industrial retail rate as a partial proxy.
  _powerMap = new Map();
  const hubPrice = new Map<string, number>();
  try {
    for (const r of sqlite.prepare("SELECT region, usd_per_mwh FROM wholesale_hub_price").all() as { region: string; usd_per_mwh: number }[]) {
      hubPrice.set(r.region, r.usd_per_mwh);
    }
  } catch { /* table not created until wholesale_price has run */ }
  const retail = new Map<string, number>();
  try {
    for (const r of sqlite.prepare("SELECT state, industrial_cents_per_kwh FROM state_power_price").all() as { state: string; industrial_cents_per_kwh: number }[]) {
      if (r.industrial_cents_per_kwh != null) retail.set(r.state, r.industrial_cents_per_kwh * 10); // ¢/kWh -> $/MWh
    }
  } catch { /* optional */ }
  const counties = sqlite.prepare("SELECT fips, iso, state, lat FROM counties").all() as { fips: string; iso: string | null; state: string; lat: number | null }[];
  for (const c of counties) {
    const region = regionForCounty(c.iso, c.state, c.lat);
    const hub = region ? hubPrice.get(region) : undefined;
    if (hub != null) _powerMap.set(c.fips, { usdPerMwh: hub, quality: "real" });
    else {
      const r = retail.get(c.state);
      if (r != null) _powerMap.set(c.fips, { usdPerMwh: r, quality: "partial" });
    }
  }
}

export function clearOverlayCaches() {
  _eiaMap = _hifldMap = _queueMap = _nriMap = _powerMap = null;
}

export function buildOverlayFor(fips: string): RealDataOverlay {
  if (!_eiaMap) warmOverlayCaches();
  return {
    eia: _eiaMap!.get(fips) ?? null,
    hifld: _hifldMap!.get(fips) ?? null,
    queue: _queueMap!.get(fips) ?? null,
    nri: _nriMap!.get(fips) ?? null,
    power: _powerMap!.get(fips) ?? null,
  };
}

export function overlayStats(): {
  eiaCounties: number;
  hifldCounties: number;
  queueCounties: number;
  nriCounties: number;
} {
  if (!_eiaMap) warmOverlayCaches();
  return {
    eiaCounties: _eiaMap!.size,
    hifldCounties: _hifldMap!.size,
    queueCounties: _queueMap!.size,
    nriCounties: _nriMap!.size,
  };
}
