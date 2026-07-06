// SEC EDGAR full-text search pipeline.
// Searches recent 8-K filings for data-center-relevant terms and stores
// filings by hyperscaler and adjacent public companies. These filings
// often surface site announcements, LLC formations, and permit references
// weeks before they hit news wires.
//
// Source: https://efts.sec.gov/LATEST/search-index — SEC EDGAR public search API.
// SEC requires a descriptive User-Agent (fair-access policy).

import { db } from "../storage.js";
import { rawEdgarFilings } from "@shared/schema";
import { fetchJson, nowIso } from "./util.js";
import { sql } from "drizzle-orm";

const QUERIES = [
  "data center campus",
  "hyperscale data center",
  "megawatt data center facility",
  "greenfield data center",
  "gigawatt campus",
];

const HYPERSCALER_CIKS: Record<string, string> = {
  "0001326801": "Meta Platforms",
  "0001652044": "Alphabet",
  "0000789019": "Microsoft",
  "0001018724": "Amazon",
  "0001045810": "NVIDIA",
  "0000320193": "Apple",
  "0000019617": "JPMorgan",       // large capex + real estate footprint
  "0001045609": "CoreSite",
  "0001594805": "Digital Realty",
  "0001057352": "Equinix",
  "0001769833": "Iron Mountain",
};

// Recent-year window
const START_DATE = "2024-01-01";
const END_DATE = "2026-07-04";

type EdgarHit = {
  _id: string;
  _source: {
    ciks: string[];
    display_names: string[];
    file_date: string;
    form: string;
    adsh: string;      // accession
    root_form: string;
    id: string;
  };
  highlight?: { text?: string[] };
};

async function searchOne(query: string): Promise<EdgarHit[]> {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: "8-K",
    dateRange: "custom",
    startdt: START_DATE,
    enddt: END_DATE,
  });
  const url = `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
  try {
    const data = await fetchJson<{ hits: { hits: EdgarHit[] } }>(url, {
      cacheKey: `edgar_${query.replace(/[^a-z0-9]+/gi, "_")}.json`,
      timeoutMs: 30_000,
    });
    return data.hits?.hits ?? [];
  } catch (e) {
    console.warn(`[edgar] Query failed: ${query}`, (e as Error).message);
    return [];
  }
}

function filingUrl(cik: string, accession: string): string {
  const cikNoPad = String(parseInt(cik, 10));
  const accNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNoPad}&type=8-K&dateb=&owner=include&count=40&action=getcompany`;
  // The direct filing url would be:
  // https://www.sec.gov/Archives/edgar/data/{cikNoPad}/{accNoDash}/{accession}-index.htm
  // We use the browse URL because it's stable and works for humans.
  // If you want to link directly to the filing itself, prefix with:
  // `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accNoDash}/`;
  void accNoDash; // keep compiler happy about intended use
}

function directFilingUrl(cik: string, accession: string): string {
  const cikNoPad = String(parseInt(cik, 10));
  const accNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accNoDash}/${accession}-index.htm`;
}

export async function ingestEdgar(): Promise<{ inserted: number; totalHits: number }> {
  const fetchedAt = nowIso();
  let inserted = 0;
  let totalHits = 0;

  // Clear existing rows within window so we always reflect the latest search.
  db.delete(rawEdgarFilings).run();

  for (const q of QUERIES) {
    console.log("[edgar] Searching:", q);
    const hits = await searchOne(q);
    console.log("[edgar] Hits:", hits.length);
    totalHits += hits.length;
    for (const h of hits) {
      const src = h._source;
      if (!src) continue;
      const accession = src.adsh;
      const cik = (src.ciks?.[0] ?? "").padStart(10, "0");
      const company = src.display_names?.[0] ?? "";
      const snippet = (h.highlight?.text ?? [])[0]?.slice(0, 500) ?? null;
      try {
        db.insert(rawEdgarFilings)
          .values({
            accessionNo: accession,
            cik,
            company,
            formType: src.form ?? "8-K",
            filedDate: src.file_date,
            matchedQuery: q,
            snippet,
            filingUrl: directFilingUrl(cik, accession),
            fetchedAt,
          })
          .onConflictDoNothing()
          .run();
        inserted++;
      } catch (e) {
        // Ignore uniqueness conflicts
      }
    }
  }

  // Bonus: pull recent 8-Ks for known hyperscaler CIKs regardless of keyword.
  for (const [cik, name] of Object.entries(HYPERSCALER_CIKS)) {
    try {
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const data = await fetchJson<any>(url, {
        cacheKey: `edgar_submissions_${cik}.json`,
        timeoutMs: 30_000,
      });
      const recent = data.filings?.recent;
      if (!recent) continue;
      const forms: string[] = recent.form ?? [];
      const dates: string[] = recent.filingDate ?? [];
      const accessions: string[] = recent.accessionNumber ?? [];
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] !== "8-K") continue;
        if (dates[i] < START_DATE) continue;
        try {
          db.insert(rawEdgarFilings)
            .values({
              accessionNo: accessions[i],
              cik,
              company: name,
              formType: "8-K",
              filedDate: dates[i],
              matchedQuery: "hyperscaler_recent_8k",
              snippet: null,
              filingUrl: directFilingUrl(cik, accessions[i]),
              fetchedAt,
            })
            .onConflictDoNothing()
            .run();
          inserted++;
        } catch {}
      }
    } catch (e) {
      console.warn(`[edgar] Failed submissions for ${name}:`, (e as Error).message);
    }
  }

  const finalCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawEdgarFilings).get() as { c: number }).c;
  console.log("[edgar] Done. inserted=", inserted, "totalHits=", totalHits, "finalCount=", finalCount);
  return { inserted, totalHits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestEdgar()
    .then((r) => { console.log("Done:", r); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
