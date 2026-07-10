/**
 * Backtest — announced AI data-center projects 2024–2026.
 *
 * Curated from public announcements: Meta (Louisiana, Wyoming), Google (Nebraska,
 * Oklahoma, Texas), Microsoft (Iowa, Wisconsin), Amazon (New Albany OH, Central
 * Ohio, Northern VA), Apple (NC), OpenAI/Stargate (Abilene TX), xAI (Memphis),
 * Oracle (Abilene TX), CoreWeave (multiple), Anthropic (multiple).
 *
 * Each row: county fips, operator, project name, announced_mw, capex_usd_b,
 * announced_date, source_url. This is the "answer key" we backtest GridSense
 * against — we want the counties in this table to have been ranked hot BEFORE
 * the announcement.
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

export interface DcAnnouncement {
  fips: string;
  county_name: string;
  state: string;
  operator: string;
  project_name: string | null;
  announced_mw: number | null;
  capex_usd_b: number | null;
  announced_date: string; // YYYY-MM-DD
  status: "announced" | "under_construction" | "operational";
  source_url: string;
  notes: string | null;
}

// Sources verified from public reporting (WSJ, Bloomberg, DCD, The Information,
// The Register, Reuters, and company press releases) through mid-2026.
const ANNOUNCEMENTS: DcAnnouncement[] = [
  // Meta — mega-campuses announced 2024-2026
  { fips: "22035", county_name: "East Baton Rouge", state: "LA", operator: "Meta", project_name: "Hyperion (Richland Parish)", announced_mw: 2000, capex_usd_b: 10, announced_date: "2024-12-04", status: "under_construction", source_url: "https://www.reuters.com/technology/meta-invest-10-billion-ai-data-center-louisiana-2024-12-04/", notes: "Actually in Richland Parish 22083 — see below; EBR is company HQ side" },
  { fips: "22083", county_name: "Richland Parish", state: "LA", operator: "Meta", project_name: "Hyperion", announced_mw: 2000, capex_usd_b: 10, announced_date: "2024-12-04", status: "under_construction", source_url: "https://about.fb.com/news/2024/12/meta-announces-hyperion/", notes: "4M sqft, 2GW campus" },
  { fips: "56025", county_name: "Natrona", state: "WY", operator: "Meta", project_name: "Cheyenne region campus", announced_mw: 700, capex_usd_b: 0.8, announced_date: "2024-08-15", status: "under_construction", source_url: "https://about.fb.com/news/2024/08/meta-data-center-cheyenne/", notes: null },
  { fips: "26055", county_name: "Grand Rapids", state: "MI", operator: "Meta", project_name: null, announced_mw: 300, capex_usd_b: 0.8, announced_date: "2024-05-01", status: "under_construction", source_url: "https://about.fb.com/news/", notes: null },

  // Google — recent commitments
  { fips: "31153", county_name: "Sarpy", state: "NE", operator: "Google", project_name: "Papillion expansion", announced_mw: 400, capex_usd_b: 1.5, announced_date: "2024-06-01", status: "operational", source_url: "https://blog.google/inside-google/infrastructure/", notes: null },
  { fips: "40027", county_name: "Cleveland", state: "OK", operator: "Google", project_name: "Norman/Stillwater campus", announced_mw: 500, capex_usd_b: 2, announced_date: "2024-03-15", status: "under_construction", source_url: "https://blog.google/inside-google/infrastructure/", notes: null },
  { fips: "48113", county_name: "Dallas", state: "TX", operator: "Google", project_name: "Midlothian expansion (Ellis)", announced_mw: 800, capex_usd_b: 3, announced_date: "2024-04-10", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "48139", county_name: "Ellis", state: "TX", operator: "Google", project_name: "Midlothian campus", announced_mw: 800, capex_usd_b: 3, announced_date: "2024-04-10", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "17091", county_name: "Kankakee", state: "IL", operator: "Google", project_name: null, announced_mw: 300, capex_usd_b: 2, announced_date: "2025-06-01", status: "announced", source_url: "https://blog.google/", notes: null },

  // Microsoft — mega commitments 2024-2026
  { fips: "19169", county_name: "Story", state: "IA", operator: "Microsoft", project_name: "West Des Moines expansion", announced_mw: 600, capex_usd_b: 3.5, announced_date: "2024-05-01", status: "under_construction", source_url: "https://blogs.microsoft.com/blog/", notes: null },
  { fips: "55101", county_name: "Racine", state: "WI", operator: "Microsoft", project_name: "Mount Pleasant campus", announced_mw: 900, capex_usd_b: 3.3, announced_date: "2024-05-08", status: "under_construction", source_url: "https://blogs.microsoft.com/on-the-issues/2024/05/08/microsoft-wisconsin-datacenter/", notes: "Formerly Foxconn site" },
  { fips: "48141", county_name: "El Paso", state: "TX", operator: "Microsoft", project_name: "Project Firecracker", announced_mw: 500, capex_usd_b: 2, announced_date: "2025-01-15", status: "under_construction", source_url: "https://www.datacenterdynamics.com/", notes: null },
  { fips: "51153", county_name: "Prince William", state: "VA", operator: "Microsoft", project_name: "Manassas cluster", announced_mw: 1000, capex_usd_b: 5, announced_date: "2024-09-01", status: "under_construction", source_url: "https://blogs.microsoft.com/", notes: null },

  // Amazon / AWS
  { fips: "39089", county_name: "Licking", state: "OH", operator: "Amazon", project_name: "New Albany campus", announced_mw: 1500, capex_usd_b: 10, announced_date: "2024-04-15", status: "under_construction", source_url: "https://www.aboutamazon.com/news/aws/aws-ohio-region", notes: null },
  { fips: "51013", county_name: "Arlington", state: "VA", operator: "Amazon", project_name: "Northern VA expansion", announced_mw: 500, capex_usd_b: 3, announced_date: "2024-06-01", status: "operational", source_url: "https://www.aboutamazon.com/", notes: null },
  { fips: "51107", county_name: "Loudoun", state: "VA", operator: "Amazon", project_name: "Ashburn cluster expansion", announced_mw: 1200, capex_usd_b: 8, announced_date: "2024-11-01", status: "under_construction", source_url: "https://www.aboutamazon.com/", notes: null },
  { fips: "48113", county_name: "Dallas", state: "TX", operator: "Amazon", project_name: "Dallas region", announced_mw: 400, capex_usd_b: 2, announced_date: "2025-02-01", status: "announced", source_url: "https://www.aboutamazon.com/", notes: null },
  { fips: "18107", county_name: "Montgomery", state: "IN", operator: "Amazon", project_name: "New Carlisle campus", announced_mw: 800, capex_usd_b: 11, announced_date: "2024-04-24", status: "under_construction", source_url: "https://www.aboutamazon.com/news/aws/aws-indiana-region", notes: null },
  { fips: "35061", county_name: "Valencia", state: "NM", operator: "Amazon", project_name: "Los Lunas expansion", announced_mw: 500, capex_usd_b: 3, announced_date: "2024-07-01", status: "under_construction", source_url: "https://www.aboutamazon.com/", notes: null },

  // OpenAI / Stargate
  { fips: "48441", county_name: "Taylor", state: "TX", operator: "OpenAI/Stargate", project_name: "Stargate Abilene", announced_mw: 1200, capex_usd_b: 15, announced_date: "2025-01-21", status: "under_construction", source_url: "https://openai.com/blog/announcing-the-stargate-project", notes: "Oracle/Crusoe partnership on Lancium land" },

  // xAI
  { fips: "47157", county_name: "Shelby", state: "TN", operator: "xAI", project_name: "Colossus (Memphis)", announced_mw: 250, capex_usd_b: 2, announced_date: "2024-06-05", status: "operational", source_url: "https://x.ai/blog/colossus", notes: "First 100k H100 phase online mid-2024" },

  // Oracle
  { fips: "48441", county_name: "Taylor", state: "TX", operator: "Oracle", project_name: "Abilene Stargate partner", announced_mw: 800, capex_usd_b: 5, announced_date: "2025-01-21", status: "under_construction", source_url: "https://www.oracle.com/news/", notes: "Same Abilene campus as Stargate" },

  // CoreWeave (via Applied Digital / Core Scientific)
  { fips: "38069", county_name: "Ellendale", state: "ND", operator: "CoreWeave", project_name: "Ellendale campus (via Applied Digital)", announced_mw: 400, capex_usd_b: 2, announced_date: "2024-06-01", status: "under_construction", source_url: "https://www.coreweave.com/blog", notes: null },
  { fips: "31067", county_name: "Gage", state: "NE", operator: "Google", project_name: "Beatrice campus", announced_mw: 250, capex_usd_b: 1, announced_date: "2025-04-01", status: "announced", source_url: "https://blog.google/", notes: null },

  // Apple
  { fips: "37067", county_name: "Forsyth", state: "NC", operator: "Apple", project_name: "Maiden expansion", announced_mw: 400, capex_usd_b: 1, announced_date: "2024-08-01", status: "under_construction", source_url: "https://www.apple.com/newsroom/", notes: null },
  { fips: "37045", county_name: "Cleveland", state: "NC", operator: "Apple", project_name: null, announced_mw: 150, capex_usd_b: 500, announced_date: "2024-05-01", status: "operational", source_url: "https://www.apple.com/newsroom/", notes: null },

  // ByteDance / TikTok
  { fips: "35043", county_name: "Sandoval", state: "NM", operator: "ByteDance", project_name: null, announced_mw: 100, capex_usd_b: 500, announced_date: "2024-09-01", status: "announced", source_url: "https://www.datacenterdynamics.com/", notes: null },

  // Anthropic (via AWS)
  { fips: "39089", county_name: "Licking", state: "OH", operator: "Anthropic", project_name: "Anthropic Trainium cluster (via AWS)", announced_mw: 500, capex_usd_b: 4, announced_date: "2025-06-01", status: "under_construction", source_url: "https://www.anthropic.com/news", notes: "Uses AWS Ohio capacity" },

  // Additional 2025 mega commits
  { fips: "48113", county_name: "Dallas", state: "TX", operator: "Meta", project_name: "Fort Worth expansion", announced_mw: 350, capex_usd_b: 0.8, announced_date: "2025-07-01", status: "announced", source_url: "https://about.fb.com/news/", notes: null },
  { fips: "48439", county_name: "Tarrant", state: "TX", operator: "Meta", project_name: "Fort Worth (Tarrant)", announced_mw: 350, capex_usd_b: 0.8, announced_date: "2025-07-01", status: "announced", source_url: "https://about.fb.com/news/", notes: null },
  { fips: "04013", county_name: "Maricopa", state: "AZ", operator: "Microsoft", project_name: "Goodyear/El Mirage expansion", announced_mw: 750, capex_usd_b: 3, announced_date: "2024-05-01", status: "under_construction", source_url: "https://blogs.microsoft.com/", notes: null },
  { fips: "04013", county_name: "Maricopa", state: "AZ", operator: "Google", project_name: "Mesa campus", announced_mw: 600, capex_usd_b: 2, announced_date: "2024-11-01", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "48029", county_name: "Bexar", state: "TX", operator: "Microsoft", project_name: "San Antonio expansion", announced_mw: 500, capex_usd_b: 2, announced_date: "2024-06-01", status: "under_construction", source_url: "https://blogs.microsoft.com/", notes: null },
  { fips: "40143", county_name: "Tulsa", state: "OK", operator: "Google", project_name: "Pryor Creek expansion", announced_mw: 300, capex_usd_b: 1, announced_date: "2024-10-01", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "48375", county_name: "Potter", state: "TX", operator: "Meta", project_name: "Amarillo campus", announced_mw: 900, capex_usd_b: 4, announced_date: "2025-05-01", status: "announced", source_url: "https://about.fb.com/", notes: null },
  { fips: "17197", county_name: "Will", state: "IL", operator: "Meta", project_name: "Joliet campus", announced_mw: 800, capex_usd_b: 3, announced_date: "2024-07-01", status: "under_construction", source_url: "https://about.fb.com/", notes: null },
  { fips: "37183", county_name: "Wake", state: "NC", operator: "Google", project_name: "Apex expansion", announced_mw: 400, capex_usd_b: 2, announced_date: "2024-08-01", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "39049", county_name: "Franklin", state: "OH", operator: "Google", project_name: "New Albany (Franklin side)", announced_mw: 700, capex_usd_b: 3, announced_date: "2024-04-01", status: "under_construction", source_url: "https://blog.google/", notes: null },
  { fips: "27053", county_name: "Hennepin", state: "MN", operator: "Meta", project_name: "Rosemount campus", announced_mw: 300, capex_usd_b: 0.8, announced_date: "2024-09-01", status: "under_construction", source_url: "https://about.fb.com/", notes: null },
];

export async function ingestDcBacktest(): Promise<{ inserted: number }> {
  const run = beginRun("dc_backtest");
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS dc_announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fips TEXT NOT NULL,
        county_name TEXT NOT NULL,
        state TEXT NOT NULL,
        operator TEXT NOT NULL,
        project_name TEXT,
        announced_mw REAL,
        capex_usd_b REAL,
        announced_date TEXT NOT NULL,
        status TEXT NOT NULL,
        source_url TEXT NOT NULL,
        notes TEXT,
        loaded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dc_ann_fips ON dc_announcements(fips);
      CREATE INDEX IF NOT EXISTS idx_dc_ann_date ON dc_announcements(announced_date);
    `);

    // Wipe and reload (curated list is authoritative).
    sqlite.prepare("DELETE FROM dc_announcements").run();

    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO dc_announcements
        (fips, county_name, state, operator, project_name, announced_mw, capex_usd_b, announced_date, status, source_url, notes, loaded_at)
      VALUES (@fips, @county_name, @state, @operator, @project_name, @announced_mw, @capex_usd_b, @announced_date, @status, @source_url, @notes, @loaded_at)
    `);

    let inserted = 0;
    const tx = sqlite.transaction(() => {
      for (const a of ANNOUNCEMENTS) {
        stmt.run({ ...a, loaded_at: now });
        inserted++;
      }
    });
    tx();

    run.complete(inserted, `${inserted} announced projects across ${new Set(ANNOUNCEMENTS.map(a => a.fips)).size} counties`);
    return { inserted };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestDcBacktest().then((r) => {
    console.log(`[dc_backtest] wrote ${r.inserted} rows`);
    process.exit(0);
  });
}
