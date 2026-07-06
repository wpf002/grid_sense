// Build a RealDataOverlay object for a given county FIPS by joining raw
// tables (EIA-860, HIFLD, ISO queue, FEMA NRI). All lookups are indexed
// so this is fast enough to call per-county during rescoring.

import { sqlite } from "../storage.js";
import type { RealDataOverlay } from "../scoring.js";

// Cache-per-run maps built lazily.
let _eiaMap: Map<string, { totalMw: number; genCount: number }> | null = null;
let _hifldMap: Map<string, {
  linesCount: number;
  hvLinesCount: number;
  ehvLinesCount: number;
  maxVoltage: number | null;
}> | null = null;
let _queueMap: Map<string, { rowsCount: number; queuedMw: number; withdrawnMw: number }> | null = null;
let _nriMap: Map<string, { riskScore: number | null; ealScore: number | null }> | null = null;

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
  const hifldRows = sqlite
    .prepare(`SELECT fips, lines_count as linesCount, hv_lines_count as hvLinesCount,
              ehv_lines_count as ehvLinesCount, max_voltage as maxVoltage FROM raw_hifld_transmission`)
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
    });

  _nriMap = new Map();
  const nriRows = sqlite
    .prepare(`SELECT fips, riskScore, ealScore FROM raw_fema_nri`)
    .all() as { fips: string; riskScore: number | null; ealScore: number | null }[];
  for (const r of nriRows) _nriMap.set(r.fips, { riskScore: r.riskScore, ealScore: r.ealScore });
}

export function clearOverlayCaches() {
  _eiaMap = _hifldMap = _queueMap = _nriMap = null;
}

export function buildOverlayFor(fips: string): RealDataOverlay {
  if (!_eiaMap) warmOverlayCaches();
  return {
    eia: _eiaMap!.get(fips) ?? null,
    hifld: _hifldMap!.get(fips) ?? null,
    queue: _queueMap!.get(fips) ?? null,
    nri: _nriMap!.get(fips) ?? null,
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
