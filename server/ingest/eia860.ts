// EIA-860 annual generator inventory pipeline.
// Downloads the annual ZIP, extracts the generator sheet, and rolls up
// nameplate MW + generator count per county. This feeds the
// `existingDcCapacityMw` and `clusterAdjacency` factors as a REAL signal.
//
// Source: https://www.eia.gov/electricity/data/eia860/
// License: public data (US government, no copyright).

import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { db } from "../storage.js";
import { rawEiaGenerators, dataProvenance } from "@shared/schema";
import { fetchBuffer, nowIso } from "./util.js";
import { lookupFips } from "./counties_ref.js";
import { sql } from "drizzle-orm";

const EIA860_URL = "https://www.eia.gov/electricity/data/eia860/xls/eia8602024.zip";
const EIA860_VINTAGE = "2024";
const GENERATOR_SHEET_FILE = "3_1_Generator_Y2024.xlsx";

type EiaRow = {
  plantCode: string;
  plantName: string;
  state: string;
  countyName: string;
  generatorId: string;
  status: string;
  nameplateMw: number | null;
  energySource: string;
  operatingYear: number | null;
};

function parseGeneratorSheet(buf: Buffer): EiaRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  // The generator file has one sheet with a 2-row header (title + column names).
  const sheetName = wb.SheetNames.find((n) => /operable|generator/i.test(n)) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  // range: skip title row
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    range: 1,
    defval: null,
    raw: true,
  });

  const out: EiaRow[] = [];
  for (const r of rows) {
    // Column names in EIA-860 are quite stable across years:
    // "Plant Code", "Plant Name", "State", "County", "Generator ID",
    // "Status", "Nameplate Capacity (MW)", "Energy Source 1", "Operating Year"
    const plantCode = String(r["Plant Code"] ?? r["Plant ID"] ?? "").trim();
    const plantName = String(r["Plant Name"] ?? "").trim();
    const state = String(r["State"] ?? "").trim();
    const county = String(r["County"] ?? "").trim();
    const genId = String(r["Generator ID"] ?? "").trim();
    if (!plantCode || !state || !county) continue;
    const mwRaw = r["Nameplate Capacity (MW)"] ?? r["Nameplate Capacity"];
    const mw = typeof mwRaw === "number" ? mwRaw : parseFloat(String(mwRaw ?? "")) || null;
    const status = String(r["Status"] ?? "").trim();
    const es = String(r["Energy Source 1"] ?? r["Energy Source"] ?? "").trim();
    const oyRaw = r["Operating Year"];
    const oy = typeof oyRaw === "number" ? oyRaw : parseInt(String(oyRaw ?? ""), 10) || null;
    out.push({
      plantCode,
      plantName,
      state,
      countyName: county,
      generatorId: genId,
      status,
      nameplateMw: mw,
      energySource: es,
      operatingYear: oy,
    });
  }
  return out;
}

export async function ingestEia860(): Promise<{ inserted: number; countiesTouched: number }> {
  console.log("[eia860] Fetching", EIA860_URL);
  const zipBuf = await fetchBuffer(EIA860_URL, {
    cacheKey: `eia860_${EIA860_VINTAGE}.zip`,
    timeoutMs: 180_000,
  });
  console.log("[eia860] ZIP downloaded, size:", zipBuf.length);

  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntry(GENERATOR_SHEET_FILE);
  if (!entry) {
    const names = zip.getEntries().map((e) => e.entryName).join(", ");
    throw new Error(`Generator sheet not found in EIA-860 zip. Files: ${names}`);
  }
  const xlsxBuf = entry.getData();
  console.log("[eia860] Parsing generator sheet, size:", xlsxBuf.length);

  const rows = parseGeneratorSheet(xlsxBuf);
  console.log("[eia860] Parsed rows:", rows.length);

  // Clear old raw rows
  db.delete(rawEiaGenerators).run();

  const fetchedAt = nowIso();
  const insertRows = rows.map((r) => ({
    plantCode: r.plantCode,
    plantName: r.plantName,
    state: r.state,
    countyName: r.countyName,
    fips: lookupFips(r.state, r.countyName),
    generatorId: r.generatorId,
    status: r.status,
    nameplateMw: r.nameplateMw,
    energySource: r.energySource,
    operatingYear: r.operatingYear,
    fetchedAt,
    sourceUrl: EIA860_URL,
  }));

  // Insert in batches — SQLite has a 32k parameter cap.
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const chunk = insertRows.slice(i, i + BATCH);
    db.insert(rawEiaGenerators).values(chunk).run();
    inserted += chunk.length;
  }

  // Provenance rollup: mark every county that has EIA data.
  // We only stamp existingDcCapacityMw as "real" here — it's a plant-count proxy, not the DC-only figure.
  const perCounty = db
    .select({
      fips: rawEiaGenerators.fips,
      totalMw: sql<number>`SUM(${rawEiaGenerators.nameplateMw})`,
      genCount: sql<number>`COUNT(*)`,
    })
    .from(rawEiaGenerators)
    .where(sql`${rawEiaGenerators.status} = 'OP' AND ${rawEiaGenerators.fips} IS NOT NULL`)
    .groupBy(rawEiaGenerators.fips)
    .all();

  // Clear + insert provenance for this factor.
  db.delete(dataProvenance).where(sql`${dataProvenance.factorKey} = 'gridGenerationMw'`).run();
  const provRows = perCounty
    .filter((r) => r.fips)
    .map((r) => ({
      fips: r.fips as string,
      factorKey: "gridGenerationMw",
      quality: "real" as const,
      sourceName: `EIA-860 (${EIA860_VINTAGE})`,
      sourceUrl: EIA860_URL,
      fetchedAt,
      rawValue: JSON.stringify({ totalMw: r.totalMw, generatorCount: r.genCount }),
      note: `Operating generators aggregated by county from EIA-860 vintage ${EIA860_VINTAGE}.`,
    }));
  for (let i = 0; i < provRows.length; i += BATCH) {
    db.insert(dataProvenance).values(provRows.slice(i, i + BATCH)).run();
  }

  console.log("[eia860] Done. inserted=", inserted, "counties=", perCounty.length);
  return { inserted, countiesTouched: perCounty.length };
}

// Run directly with: npx tsx server/ingest/eia860.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestEia860()
    .then((r) => {
      console.log("Done:", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
