// ERCOT Generator Interconnection Queue — GIS Report XLSX
// Source: https://www.ercot.com/mp/data-products/data-product-details?id=PG7-200-ER
// Direct XLSX: ercot.com/misdownload/servlets/mirDownload?doclookupId=1245185620
// Columns (data starts row 35): INR | Project Name | Study Phase | Interconnecting Entity |
//   POI Location | County | CDR Zone | Projected COD | Fuel | Tech | Capacity MW | ... | IA Signed
// All ERCOT projects are in Texas (state FIPS 48).
import * as XLSX from "xlsx";
import { sqlite } from "../storage.js";
import { fetchBuffer, beginRun, STATE_FIPS } from "./util.js";
import { lookupFips, normalizeCountyName } from "./counties_ref.js";

const URL_ERCOT = "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId=1245185620";

const COL = {
  INR: 0,
  NAME: 1,
  STUDY_PHASE: 2,
  ENTITY: 3,
  POI: 4,
  COUNTY: 5,
  ZONE: 6,
  COD: 7,
  FUEL: 8,
  TECH: 9,
  MW: 10,
  IA_SIGNED: 18,
};

/** Excel serial date -> ISO YYYY-MM-DD. Returns null for invalid inputs. */
function excelSerialToIso(n: unknown): string | null {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  // Excel epoch 1899-12-30 (correct for leap-year bug)
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function ingestErcotQueue(): Promise<number> {
  const run = beginRun("ercot_queue", "ERCOT GIS Report — Large Gen queue");
  try {
    const buf = await fetchBuffer(URL_ERCOT, { cacheKey: "ercot_gis.xlsx" });
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = "Project Details - Large Gen";
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO raw_iso_queue
        (iso, queue_no, project_name, state, county, fips, mw, fuel_type, status, submitted_date, expected_in_service, fetched_at, source_url)
      VALUES ('ERCOT', ?, ?, 'TX', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    sqlite.prepare("DELETE FROM raw_iso_queue WHERE iso = 'ERCOT'").run();

    let inserted = 0;
    const insertMany = sqlite.transaction(() => {
      for (let i = 35; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !Array.isArray(r)) continue;
        const inr = r[COL.INR];
        if (!inr || typeof inr !== "string" || inr.trim().length === 0) continue;

        const name = (r[COL.NAME] as string | null) ?? "";
        const county = (r[COL.COUNTY] as string | null) ?? null;
        const mwRaw = r[COL.MW];
        const mw = typeof mwRaw === "number" ? mwRaw : null;
        const fuel = (r[COL.FUEL] as string | null) ?? null;
        const tech = (r[COL.TECH] as string | null) ?? null;
        const fuelType = tech ? `${fuel ?? ""}/${tech}`.trim() : fuel;
        const iaSigned = r[COL.IA_SIGNED];
        // ERCOT reports "Yes"/"No"/date-like for IA Signed. Roll it into status text.
        const studyPhase = (r[COL.STUDY_PHASE] as string | null) ?? "";
        const status = iaSigned && typeof iaSigned === "string"
          ? `${studyPhase}; IA=${iaSigned}`
          : studyPhase || null;
        const cod = excelSerialToIso(r[COL.COD]);
        const fips = county
          ? lookupFips("TX", normalizeCountyName(county))
          : null;

        stmt.run(
          inr.trim(),
          name.trim(),
          county,
          fips,
          mw,
          fuelType,
          status,
          null, // submitted_date not directly in this sheet
          cod,
          now,
          URL_ERCOT,
        );
        inserted++;
      }
    });
    insertMany();
    run.complete(inserted, `${inserted} ERCOT Large-Gen queue rows`);
    return inserted;
  } catch (err) {
    run.fail(err);
    throw err;
  }
}
