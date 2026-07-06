// USDA ERS — Rural-Urban Continuum Codes 2023
// -----------------------------------------------------------------------------
// The RUCC is the standard federal county-level rurality classification.
// Every county gets a code 1-9:
//   1  Metro, pop 1M+
//   2  Metro, pop 250K-1M
//   3  Metro, pop <250K
//   4  Non-metro, urban pop 20K+, adjacent to metro
//   5  Non-metro, urban pop 20K+, not adjacent
//   6  Non-metro, urban pop 5K-20K, adjacent
//   7  Non-metro, urban pop 5K-20K, not adjacent
//   8  Non-metro, urban pop <5K, adjacent
//   9  Non-metro, urban pop <5K, not adjacent
//
// For AI data-center land availability, rural counties have vastly more
// large-parcel supply — a hyperscaler can find 500-1500 acre contiguous
// tracts far more easily in RUCC 4-7 (semi-rural but connected) than in
// RUCC 1-2 (dense metro). RUCC 8-9 (completely rural) technically have
// plenty of land but poor grid/fiber for hyperscale operations.
//
// GridSense large_parcel_count proxy formula:
//   RUCC 1  -> 5   (dense metro, land is scarce and expensive)
//   RUCC 2  -> 10
//   RUCC 3  -> 18
//   RUCC 4  -> 30  (sweet spot: semi-rural near metro)
//   RUCC 5  -> 28
//   RUCC 6  -> 35  (peak large-parcel availability)
//   RUCC 7  -> 32
//   RUCC 8  -> 40
//   RUCC 9  -> 40
//
// Source: https://www.ers.usda.gov/data-products/rural-urban-continuum-codes
// Direct: https://www.ers.usda.gov/media/5767/2023-rural-urban-continuum-codes.xlsx
// Vintage: 2023 (based on 2020 Census data)

import * as XLSX from "xlsx";
import { fetchBuffer, nowIso, withRun, USER_AGENT } from "./util.js";
import { sqlite } from "../storage.js";

const RUCC_XLSX_URL =
  "https://www.ers.usda.gov/media/5767/2023-rural-urban-continuum-codes.xlsx?v=56650";

const PARCEL_BY_RUCC: Record<number, number> = {
  1: 5,   // Metro 1M+
  2: 10,  // Metro 250K-1M
  3: 18,  // Metro <250K
  4: 30,  // Non-metro urban 20K+, adjacent
  5: 28,  // Non-metro urban 20K+, not adjacent
  6: 35,  // Non-metro urban 5K-20K, adjacent  ← peak
  7: 32,  // Non-metro urban 5K-20K, not adjacent
  8: 40,  // Completely rural, adjacent
  9: 40,  // Completely rural, not adjacent
};

interface RuccRow {
  fips: string;
  state: string;
  county: string;
  population2020: number;
  ruccCode: number;
}

function parseRuccXlsx(buf: Buffer): RuccRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: null });

  const out: RuccRow[] = [];
  for (const r of rows) {
    // Field names in ERS RUCC XLSX: FIPS, State, County_Name, Population_2020, RUCC_2023, Description
    const fips = String(r.FIPS ?? "").padStart(5, "0");
    if (!/^\d{5}$/.test(fips)) continue;
    const code = Number(r.RUCC_2023);
    if (!Number.isFinite(code) || code < 1 || code > 9) continue;
    out.push({
      fips,
      state: String(r.State ?? "").trim(),
      county: String(r.County_Name ?? "").trim(),
      population2020: Number(r.Population_2020) || 0,
      ruccCode: code,
    });
  }
  return out;
}

export async function ingestUsdaRucc(): Promise<null> {
  return withRun("usda_rucc", async () => {
    console.log(`[usda_rucc] ${nowIso()} — fetching USDA ERS RUCC 2023`);
    console.log(`[usda_rucc] source: ${RUCC_XLSX_URL}`);
    console.log(`[usda_rucc] UA: ${USER_AGENT}`);

    const buf = await fetchBuffer(RUCC_XLSX_URL, {
      cacheKey: "usda_rucc_2023.xlsx",
      timeoutMs: 60_000,
    });
    console.log(`[usda_rucc] downloaded ${buf.length} bytes`);

    const rows = parseRuccXlsx(buf);
    console.log(`[usda_rucc] parsed ${rows.length} counties`);

    const byFips = new Map<string, RuccRow>();
    for (const r of rows) byFips.set(r.fips, r);

    const tracked = (
      sqlite.prepare("SELECT fips FROM counties").all() as { fips: string }[]
    ).map((r) => r.fips);

    const upd = sqlite.prepare(
      "UPDATE counties SET large_parcel_count = ?, updated_at = ? WHERE fips = ?",
    );
    const today = new Date().toISOString().slice(0, 10);

    let updated = 0;
    let missing = 0;
    const codeCounts: Record<number, number> = {};

    const txn = sqlite.transaction(() => {
      for (const fips of tracked) {
        const r = byFips.get(fips);
        if (!r) {
          missing += 1;
          continue;
        }
        const parcels = PARCEL_BY_RUCC[r.ruccCode] ?? 15;
        upd.run(parcels, today, fips);
        updated += 1;
        codeCounts[r.ruccCode] = (codeCounts[r.ruccCode] ?? 0) + 1;
      }
    });
    txn();

    console.log(
      `[usda_rucc] updated ${updated}/${tracked.length} tracked counties (${missing} unmatched)`,
    );
    console.log(`[usda_rucc] RUCC distribution across tracked counties:`);
    for (const code of Object.keys(codeCounts).sort()) {
      const n = codeCounts[Number(code)];
      console.log(`  RUCC ${code}: ${n} counties`);
    }

    return {
      rows: updated,
      note: `USDA ERS RUCC 2023 · ${rows.length} US counties · large_parcel_count set from RUCC 1-9 mapping`,
    };
  });
}
