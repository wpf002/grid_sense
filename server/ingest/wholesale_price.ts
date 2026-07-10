// Real wholesale power prices — replaces the state industrial RETAIL tariff that
// was standing in as an "LMP proxy". Power is the largest data-center opex line,
// and a state retail average is not a market price.
//
// Two free, key-less sources:
//   1. EIA / ICE wholesale hub prices (daily $/MWh, ~7 national trading hubs)
//      https://www.eia.gov/electricity/wholesale/  -> xls/ice_electric-<year>.xlsx
//      We take a volume-weighted trailing-90-day average per hub.
//   2. ERCOT Day-Ahead Market settlement point prices (no ICE hub covers ERCOT)
//      https://www.ercot.com/content/cdr/html/dam_spp.html  (24 hourly rows)
//      We take today's 24-hour mean per hub / load zone.
//
// This is a REGIONAL HUB price, not a nodal LMP. Counties in a region with no
// published hub (SPP, NYISO, TVA, FRCC, Southeast) get no price rather than a
// fabricated one.

import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { beginRun, fetchText, fetchBuffer } from "./util.js";

const EIA_WHOLESALE_PAGE = "https://www.eia.gov/electricity/wholesale/";
const ERCOT_DAM_SPP = "https://www.ercot.com/content/cdr/html/dam_spp.html";
const TRAILING_DAYS = 90;

// Our stable region keys -> the vendor's hub label.
const ICE_HUB_TO_REGION: Array<[RegExp, string]> = [
  [/^PJM WH/i, "PJM"],
  [/^Indiana Hub/i, "MISO"],
  [/^Nepool MH/i, "ISONE"],
  [/^NP15/i, "CAISO_NP15"],
  [/^SP15/i, "CAISO_SP15"],
  [/^Palo Verde/i, "PALOVERDE"],
  [/^Mid C/i, "MIDC"],
];

function ensureTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS wholesale_hub_price (
      region TEXT PRIMARY KEY,
      hub TEXT NOT NULL,
      usd_per_mwh REAL NOT NULL,
      period TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `);
}

/** Map a county to the wholesale hub region that actually prices its power. */
export function regionForCounty(iso: string | null, state: string, lat: number | null): string | null {
  const i = (iso ?? "").toUpperCase();
  if (i.includes("ERCOT")) return "ERCOT";
  if (i.includes("PJM")) return "PJM";
  if (i.includes("MISO")) return "MISO";
  if (i.includes("ISO-NE") || i.includes("ISONE")) return "ISONE";
  if (i.includes("CAISO")) return (lat ?? 0) >= 36.5 ? "CAISO_NP15" : "CAISO_SP15";
  if (i.includes("BPA")) return "MIDC";
  // Non-RTO West: the Palo Verde and Mid-C hubs are the real trading points.
  if (["AZ", "NM", "NV"].includes(state)) return "PALOVERDE";
  if (["WA", "OR", "ID", "MT"].includes(state)) return "MIDC";
  return null; // SPP / NYISO / TVA / FRCC / Southeast: no published hub -> no price
}

export function lookupWholesalePrice(iso: string | null, state: string, lat: number | null) {
  const region = regionForCounty(iso, state, lat);
  if (!region) return null;
  try {
    return (
      sqlite
        .prepare("SELECT region, hub, usd_per_mwh AS usdPerMwh, period, source_url AS sourceUrl FROM wholesale_hub_price WHERE region = ?")
        .get(region) as { region: string; hub: string; usdPerMwh: number; period: string; sourceUrl: string } | undefined
    ) ?? null;
  } catch {
    return null;
  }
}

function excelSerialToDate(n: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

/** Find the current (non-archive) ICE workbook link, so a year rollover doesn't break us. */
async function findIceWorkbookUrl(): Promise<string> {
  const html = await fetchText(EIA_WHOLESALE_PAGE, { cacheKey: "eia_wholesale_page.html", maxAgeMs: 24 * 3600 * 1000 });
  const m = [...html.matchAll(/href="((?:xls\/)?ice_electric-\d{4}\.xlsx)"/gi)].map((x) => x[1]);
  const rel = m.sort().pop();
  if (!rel) throw new Error("No current ice_electric-<year>.xlsx link found on the EIA wholesale page");
  return new URL(rel, EIA_WHOLESALE_PAGE).toString();
}

async function ingestIceHubs(now: string): Promise<number> {
  const url = await findIceWorkbookUrl();
  const buf = await fetchBuffer(url, { cacheKey: "ice_electric.xlsx", maxAgeMs: 3 * 24 * 3600 * 1000 });
  const wb = XLSX.read(buf, { type: "buffer" });
  const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const header = (grid[0] ?? []).map((c: any) => String(c ?? "").trim());
  const cHub = header.findIndex((h) => /price hub/i.test(h));
  const cDate = header.findIndex((h) => /trade date/i.test(h));
  const cPrice = header.findIndex((h) => /wtd avg price/i.test(h));
  const cVol = header.findIndex((h) => /daily volume/i.test(h));
  if (cHub < 0 || cDate < 0 || cPrice < 0) throw new Error("ICE workbook columns not recognized");

  // Trailing window relative to the newest trade date in the file.
  let maxSerial = 0;
  for (let r = 1; r < grid.length; r++) {
    const s = Number(grid[r]?.[cDate]);
    if (Number.isFinite(s) && s > maxSerial) maxSerial = s;
  }
  const cutoff = maxSerial - TRAILING_DAYS;

  const acc = new Map<string, { hub: string; pv: number; vol: number }>();
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const serial = Number(row[cDate]);
    const price = Number(row[cPrice]);
    if (!Number.isFinite(serial) || serial < cutoff || !Number.isFinite(price) || price <= 0) continue;
    const hub = String(row[cHub] ?? "").trim();
    const region = ICE_HUB_TO_REGION.find(([re]) => re.test(hub))?.[1];
    if (!region) continue;
    const vol = cVol >= 0 ? Math.max(1, Number(row[cVol]) || 1) : 1;
    const a = acc.get(region) ?? { hub, pv: 0, vol: 0 };
    a.pv += price * vol;
    a.vol += vol;
    acc.set(region, a);
  }

  const period = `${TRAILING_DAYS}d avg thru ${excelSerialToDate(maxSerial).toISOString().slice(0, 10)}`;
  const stmt = sqlite.prepare(`
    INSERT INTO wholesale_hub_price (region, hub, usd_per_mwh, period, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(region) DO UPDATE SET hub=excluded.hub, usd_per_mwh=excluded.usd_per_mwh,
      period=excluded.period, source_url=excluded.source_url, fetched_at=excluded.fetched_at
  `);
  let n = 0;
  for (const [region, a] of acc) {
    if (a.vol <= 0) continue;
    stmt.run(region, a.hub, Math.round((a.pv / a.vol) * 100) / 100, period, EIA_WHOLESALE_PAGE, now);
    n++;
  }
  console.log(`[wholesale_price] ICE hubs: ${n} regions (${period})`);
  return n;
}

async function ingestErcot(now: string): Promise<number> {
  const html = await fetchText(ERCOT_DAM_SPP, { cacheKey: "ercot_dam_spp.html", maxAgeMs: 12 * 3600 * 1000, forceRefresh: true });
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1].replace(/<[^>]*>/g, "").trim()),
  ).filter((r) => r.length > 2);
  if (!rows.length) throw new Error("ERCOT DAM SPP table not found");
  const header = rows[0];
  const iHubAvg = header.findIndex((h) => /^HB_HUBAVG$/i.test(h));
  if (iHubAvg < 0) throw new Error("ERCOT HB_HUBAVG column not found");
  const operDay = rows[1]?.[0] ?? "";

  let sum = 0, count = 0;
  for (let r = 1; r < rows.length; r++) {
    const v = Number(rows[r][iHubAvg]);
    if (Number.isFinite(v)) { sum += v; count++; }
  }
  if (!count) throw new Error("No ERCOT hourly prices parsed");
  const avg = Math.round((sum / count) * 100) / 100;

  sqlite.prepare(`
    INSERT INTO wholesale_hub_price (region, hub, usd_per_mwh, period, source_url, fetched_at)
    VALUES ('ERCOT', 'ERCOT HB_HUBAVG', ?, ?, ?, ?)
    ON CONFLICT(region) DO UPDATE SET usd_per_mwh=excluded.usd_per_mwh, period=excluded.period, fetched_at=excluded.fetched_at
  `).run(avg, `Day-ahead 24h mean, ${operDay}`, ERCOT_DAM_SPP, now);
  console.log(`[wholesale_price] ERCOT HB_HUBAVG: $${avg}/MWh (${operDay}, ${count}h)`);
  return 1;
}

export async function ingestWholesalePrice(): Promise<number> {
  const run = beginRun("wholesale_price", "Real wholesale hub prices (EIA/ICE + ERCOT DAM)");
  try {
    ensureTable();
    const now = new Date().toISOString();
    let n = 0;
    // Each source is isolated: one going down shouldn't lose the other.
    try { n += await ingestIceHubs(now); } catch (e: any) { console.warn(`[wholesale_price] ICE failed: ${e?.message ?? e}`); }
    try { n += await ingestErcot(now); } catch (e: any) { console.warn(`[wholesale_price] ERCOT failed: ${e?.message ?? e}`); }
    if (!n) throw new Error("No wholesale prices ingested from any source");
    run.complete(n, `${n} hub regions priced`);
    return n;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestWholesalePrice()
    .then((n) => { console.log("Done:", n); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
