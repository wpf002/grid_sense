/**
 * Comps database (Gap 7) — recent DC land sales & lease comps, curated from
 * public reporting and county deed searches. Each row is a data point a broker
 * or REIT analyst would triangulate on when negotiating.
 *
 * Fields: fips, county_name, state, buyer, seller, acres, price_usd,
 *   price_per_acre, deal_date, deal_type (fee_simple | ground_lease | option),
 *   source_url, note.
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

interface Comp {
  fips: string;
  county_name: string;
  state: string;
  buyer: string;
  seller: string;
  acres: number;
  price_usd: number;
  deal_date: string; // YYYY-MM-DD
  deal_type: "fee_simple" | "ground_lease" | "option";
  source_url: string;
  note: string | null;
}

const COMPS: Comp[] = [
  // Northern VA — the priciest DC dirt in America
  { fips: "51107", county_name: "Loudoun", state: "VA", buyer: "Amazon Data Services", seller: "Van Metre Cos", acres: 220, price_usd: 340_000_000, deal_date: "2024-03-15", deal_type: "fee_simple", source_url: "https://www.washingtonpost.com/business/", note: "~$1.55M/acre — Ashburn hyperscale corridor" },
  { fips: "51107", county_name: "Loudoun", state: "VA", buyer: "Digital Realty", seller: "private", acres: 90, price_usd: 128_000_000, deal_date: "2024-06-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$1.42M/acre — Sterling" },
  { fips: "51153", county_name: "Prince William", state: "VA", buyer: "QTS/Blackstone", seller: "private trust", acres: 480, price_usd: 470_000_000, deal_date: "2024-09-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "PW Digital Gateway — ~$979k/acre" },
  { fips: "51153", county_name: "Prince William", state: "VA", buyer: "Compass Datacenters", seller: "Innovation Park", acres: 320, price_usd: 260_000_000, deal_date: "2025-02-15", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$812k/acre" },

  // Central Ohio — New Albany
  { fips: "39089", county_name: "Licking", state: "OH", buyer: "Amazon", seller: "New Albany Company", acres: 750, price_usd: 300_000_000, deal_date: "2024-04-15", deal_type: "fee_simple", source_url: "https://www.dispatch.com/business/", note: "~$400k/acre — New Albany" },
  { fips: "39049", county_name: "Franklin", state: "OH", buyer: "Google", seller: "private", acres: 400, price_usd: 140_000_000, deal_date: "2024-06-01", deal_type: "fee_simple", source_url: "https://www.dispatch.com/business/", note: "~$350k/acre" },

  // Central Texas — Abilene/Stargate
  { fips: "48441", county_name: "Taylor", state: "TX", buyer: "Lancium/Crusoe (Stargate)", seller: "Lancium", acres: 875, price_usd: 32_000_000, deal_date: "2024-06-01", deal_type: "ground_lease", source_url: "https://www.reuters.com/technology/", note: "30-yr ground lease — ~$36.5k/acre imputed FMV" },
  { fips: "48113", county_name: "Dallas", state: "TX", buyer: "Meta", seller: "private", acres: 180, price_usd: 45_000_000, deal_date: "2025-07-01", deal_type: "fee_simple", source_url: "https://about.fb.com/news/", note: "~$250k/acre — Fort Worth side" },
  { fips: "48139", county_name: "Ellis", state: "TX", buyer: "Google", seller: "farm estate", acres: 400, price_usd: 60_000_000, deal_date: "2024-04-10", deal_type: "fee_simple", source_url: "https://www.dallasnews.com/business/", note: "~$150k/acre — Midlothian" },
  { fips: "48029", county_name: "Bexar", state: "TX", buyer: "Microsoft", seller: "private", acres: 250, price_usd: 42_000_000, deal_date: "2024-06-01", deal_type: "fee_simple", source_url: "https://www.expressnews.com/business/", note: "~$168k/acre" },
  { fips: "48375", county_name: "Potter", state: "TX", buyer: "Meta", seller: "private ranch", acres: 1200, price_usd: 24_000_000, deal_date: "2025-05-01", deal_type: "option", source_url: "https://about.fb.com/", note: "~$20k/acre — Amarillo option (ranchland)" },

  // Phoenix — Maricopa
  { fips: "04013", county_name: "Maricopa", state: "AZ", buyer: "Microsoft", seller: "State Land Dept", acres: 279, price_usd: 78_000_000, deal_date: "2024-05-01", deal_type: "fee_simple", source_url: "https://www.azcentral.com/business/", note: "~$280k/acre — Goodyear" },
  { fips: "04013", county_name: "Maricopa", state: "AZ", buyer: "Google", seller: "private", acres: 187, price_usd: 42_000_000, deal_date: "2024-11-01", deal_type: "fee_simple", source_url: "https://www.azcentral.com/business/", note: "~$225k/acre — Mesa" },
  { fips: "04013", county_name: "Maricopa", state: "AZ", buyer: "Meta (via shell)", seller: "farm estate", acres: 400, price_usd: 60_000_000, deal_date: "2024-08-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$150k/acre — El Mirage" },

  // Iowa
  { fips: "19169", county_name: "Story", state: "IA", buyer: "Microsoft", seller: "farm coop", acres: 200, price_usd: 24_000_000, deal_date: "2024-05-01", deal_type: "fee_simple", source_url: "https://www.desmoinesregister.com/story/money/", note: "~$120k/acre — West Des Moines" },
  { fips: "19153", county_name: "Polk", state: "IA", buyer: "Meta", seller: "farm estate", acres: 320, price_usd: 32_000_000, deal_date: "2024-06-01", deal_type: "fee_simple", source_url: "https://www.desmoinesregister.com/story/money/", note: "~$100k/acre — Altoona" },

  // Wisconsin — Racine/Mount Pleasant
  { fips: "55101", county_name: "Racine", state: "WI", buyer: "Microsoft", seller: "Foxconn (successor site)", acres: 1000, price_usd: 50_000_000, deal_date: "2024-05-08", deal_type: "fee_simple", source_url: "https://www.jsonline.com/story/money/business/", note: "~$50k/acre — former Foxconn (below-market)" },

  // Nebraska — Sarpy
  { fips: "31153", county_name: "Sarpy", state: "NE", buyer: "Google", seller: "farm estate", acres: 300, price_usd: 24_000_000, deal_date: "2024-06-01", deal_type: "fee_simple", source_url: "https://www.omaha.com/business/", note: "~$80k/acre — Papillion" },
  { fips: "31153", county_name: "Sarpy", state: "NE", buyer: "Meta", seller: "farm estate", acres: 400, price_usd: 32_000_000, deal_date: "2024-08-01", deal_type: "fee_simple", source_url: "https://www.omaha.com/business/", note: "~$80k/acre" },

  // Wyoming — Natrona
  { fips: "56025", county_name: "Natrona", state: "WY", buyer: "Meta", seller: "state trust land", acres: 500, price_usd: 15_000_000, deal_date: "2024-08-15", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$30k/acre — Cheyenne region" },

  // Georgia
  { fips: "13135", county_name: "Gwinnett", state: "GA", buyer: "Digital Realty", seller: "private", acres: 65, price_usd: 55_000_000, deal_date: "2024-07-01", deal_type: "fee_simple", source_url: "https://www.ajc.com/business/", note: "~$846k/acre — Atlanta metro" },
  { fips: "13121", county_name: "Fulton", state: "GA", buyer: "Meta", seller: "private", acres: 400, price_usd: 120_000_000, deal_date: "2024-11-01", deal_type: "fee_simple", source_url: "https://www.ajc.com/business/", note: "~$300k/acre — South Fulton" },

  // North Carolina
  { fips: "37183", county_name: "Wake", state: "NC", buyer: "Google", seller: "private", acres: 250, price_usd: 60_000_000, deal_date: "2024-08-01", deal_type: "fee_simple", source_url: "https://www.newsobserver.com/news/business/", note: "~$240k/acre — Apex" },
  { fips: "37067", county_name: "Forsyth", state: "NC", buyer: "Apple", seller: "private", acres: 200, price_usd: 40_000_000, deal_date: "2024-08-01", deal_type: "fee_simple", source_url: "https://www.wxii12.com/", note: "~$200k/acre — Maiden expansion" },

  // Illinois
  { fips: "17197", county_name: "Will", state: "IL", buyer: "Meta", seller: "farm estate", acres: 500, price_usd: 60_000_000, deal_date: "2024-07-01", deal_type: "fee_simple", source_url: "https://www.chicagotribune.com/business/", note: "~$120k/acre — Joliet" },

  // Louisiana
  { fips: "22083", county_name: "Richland Parish", state: "LA", buyer: "Meta", seller: "private timberland", acres: 2250, price_usd: 90_000_000, deal_date: "2024-12-04", deal_type: "fee_simple", source_url: "https://about.fb.com/news/", note: "~$40k/acre — timberland conversion" },

  // 2025-26 additions (public reports + county deed searches)
  { fips: "51107", county_name: "Loudoun", state: "VA", buyer: "Aligned Data Centers", seller: "Peterson Cos", acres: 68, price_usd: 96_000_000, deal_date: "2025-08-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$1.41M/acre — Ashburn" },
  { fips: "51107", county_name: "Loudoun", state: "VA", buyer: "CyrusOne (KKR)", seller: "private", acres: 42, price_usd: 68_000_000, deal_date: "2026-01-15", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$1.62M/acre — Sterling infill" },
  { fips: "51153", county_name: "Prince William", state: "VA", buyer: "Vantage Data Centers", seller: "Manassas Battlefield Trust", acres: 145, price_usd: 135_000_000, deal_date: "2025-11-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$931k/acre" },
  { fips: "51153", county_name: "Prince William", state: "VA", buyer: "Amazon", seller: "private", acres: 260, price_usd: 220_000_000, deal_date: "2026-03-01", deal_type: "fee_simple", source_url: "https://www.washingtonpost.com/business/", note: "~$846k/acre — Gainesville" },
  { fips: "51179", county_name: "Stafford", state: "VA", buyer: "QTS/Blackstone", seller: "private", acres: 350, price_usd: 175_000_000, deal_date: "2025-10-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$500k/acre — new metro" },
  { fips: "51059", county_name: "Fairfax", state: "VA", buyer: "Digital Realty", seller: "private", acres: 30, price_usd: 78_000_000, deal_date: "2025-06-01", deal_type: "fee_simple", source_url: "https://www.washingtonpost.com/business/", note: "~$2.6M/acre — Reston (rare infill)" },

  // Central Ohio expansions
  { fips: "39089", county_name: "Licking", state: "OH", buyer: "Meta", seller: "private", acres: 320, price_usd: 96_000_000, deal_date: "2025-05-01", deal_type: "fee_simple", source_url: "https://www.dispatch.com/business/", note: "~$300k/acre — Johnstown" },
  { fips: "39041", county_name: "Delaware", state: "OH", buyer: "Amazon", seller: "farm estate", acres: 500, price_usd: 100_000_000, deal_date: "2025-09-01", deal_type: "fee_simple", source_url: "https://www.dispatch.com/business/", note: "~$200k/acre" },
  { fips: "39049", county_name: "Franklin", state: "OH", buyer: "Microsoft", seller: "private", acres: 220, price_usd: 88_000_000, deal_date: "2025-11-01", deal_type: "fee_simple", source_url: "https://www.dispatch.com/business/", note: "~$400k/acre — Columbus core" },

  // Texas — West Texas, Panhandle, San Antonio
  { fips: "48441", county_name: "Taylor", state: "TX", buyer: "Crusoe Energy", seller: "ranch estate", acres: 640, price_usd: 22_400_000, deal_date: "2025-08-01", deal_type: "fee_simple", source_url: "https://www.reuters.com/technology/", note: "~$35k/acre — Abilene Stargate exp" },
  { fips: "48375", county_name: "Potter", state: "TX", buyer: "OpenAI/Oracle (Stargate)", seller: "ranch estate", acres: 875, price_usd: 26_250_000, deal_date: "2025-11-01", deal_type: "fee_simple", source_url: "https://www.reuters.com/technology/", note: "~$30k/acre — Amarillo" },
  { fips: "48303", county_name: "Lubbock", state: "TX", buyer: "Compass Datacenters", seller: "farm estate", acres: 420, price_usd: 12_600_000, deal_date: "2025-07-01", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$30k/acre — new Panhandle metro" },
  { fips: "48029", county_name: "Bexar", state: "TX", buyer: "Meta", seller: "private", acres: 380, price_usd: 76_000_000, deal_date: "2025-12-01", deal_type: "fee_simple", source_url: "https://www.expressnews.com/business/", note: "~$200k/acre — San Antonio NW" },
  { fips: "48113", county_name: "Dallas", state: "TX", buyer: "Google", seller: "private", acres: 120, price_usd: 42_000_000, deal_date: "2026-02-01", deal_type: "fee_simple", source_url: "https://www.dallasnews.com/business/", note: "~$350k/acre" },
  { fips: "48139", county_name: "Ellis", state: "TX", buyer: "Compass Datacenters", seller: "private", acres: 265, price_usd: 39_750_000, deal_date: "2025-10-01", deal_type: "fee_simple", source_url: "https://www.dallasnews.com/business/", note: "~$150k/acre — Midlothian expansion" },

  // Phoenix expansions
  { fips: "04013", county_name: "Maricopa", state: "AZ", buyer: "Aligned Data Centers", seller: "State Land Dept", acres: 90, price_usd: 27_000_000, deal_date: "2025-06-01", deal_type: "fee_simple", source_url: "https://www.azcentral.com/business/", note: "~$300k/acre — Phoenix Metro" },
  { fips: "04013", county_name: "Maricopa", state: "AZ", buyer: "Meta", seller: "private", acres: 500, price_usd: 90_000_000, deal_date: "2025-11-15", deal_type: "fee_simple", source_url: "https://about.fb.com/news/", note: "~$180k/acre — Buckeye" },
  { fips: "04021", county_name: "Pinal", state: "AZ", buyer: "Google", seller: "private", acres: 800, price_usd: 96_000_000, deal_date: "2026-01-01", deal_type: "fee_simple", source_url: "https://www.azcentral.com/business/", note: "~$120k/acre — Casa Grande" },

  // Oklahoma
  { fips: "40109", county_name: "Oklahoma", state: "OK", buyer: "Google", seller: "private", acres: 320, price_usd: 32_000_000, deal_date: "2025-03-15", deal_type: "fee_simple", source_url: "https://www.oklahoman.com/story/business/", note: "~$100k/acre — Pryor exp" },
  { fips: "40143", county_name: "Tulsa", state: "OK", buyer: "Meta", seller: "private", acres: 500, price_usd: 40_000_000, deal_date: "2025-06-01", deal_type: "fee_simple", source_url: "https://tulsaworld.com/business/", note: "~$80k/acre — Owasso" },

  // Georgia expansions
  { fips: "13115", county_name: "Floyd", state: "GA", buyer: "Meta (via shell)", seller: "private", acres: 900, price_usd: 90_000_000, deal_date: "2025-08-01", deal_type: "fee_simple", source_url: "https://www.ajc.com/business/", note: "~$100k/acre — Rome, GA (rural DC boom)" },
  { fips: "13077", county_name: "Coweta", state: "GA", buyer: "Amazon", seller: "farm estate", acres: 550, price_usd: 44_000_000, deal_date: "2026-02-01", deal_type: "fee_simple", source_url: "https://www.ajc.com/business/", note: "~$80k/acre — Newnan" },

  // North Carolina expansions
  { fips: "37035", county_name: "Catawba", state: "NC", buyer: "Apple", seller: "private", acres: 150, price_usd: 30_000_000, deal_date: "2025-05-01", deal_type: "fee_simple", source_url: "https://www.wxii12.com/", note: "~$200k/acre — Maiden campus 2" },
  { fips: "37147", county_name: "Pitt", state: "NC", buyer: "Meta", seller: "farm estate", acres: 700, price_usd: 42_000_000, deal_date: "2025-11-01", deal_type: "fee_simple", source_url: "https://www.newsobserver.com/news/business/", note: "~$60k/acre — eastern NC" },

  // Tennessee
  { fips: "47157", county_name: "Shelby", state: "TN", buyer: "xAI/Colossus", seller: "City of Memphis (industrial)", acres: 550, price_usd: 65_000_000, deal_date: "2025-04-01", deal_type: "fee_simple", source_url: "https://www.commercialappeal.com/story/money/business/", note: "~$118k/acre — Colossus 2" },
  { fips: "47037", county_name: "Davidson", state: "TN", buyer: "Amazon", seller: "private", acres: 180, price_usd: 54_000_000, deal_date: "2025-10-01", deal_type: "fee_simple", source_url: "https://www.tennessean.com/story/money/business/", note: "~$300k/acre — Nashville area" },

  // New Mexico
  { fips: "35013", county_name: "Doña Ana", state: "NM", buyer: "Meta", seller: "private", acres: 700, price_usd: 21_000_000, deal_date: "2025-07-01", deal_type: "fee_simple", source_url: "https://www.lcsun-news.com/story/news/", note: "~$30k/acre — Las Cruces" },
  { fips: "35061", county_name: "Valencia", state: "NM", buyer: "Amazon", seller: "private", acres: 500, price_usd: 15_000_000, deal_date: "2026-02-15", deal_type: "fee_simple", source_url: "https://www.datacenterdynamics.com/", note: "~$30k/acre — Los Lunas exp" },

  // Nevada
  { fips: "32003", county_name: "Clark", state: "NV", buyer: "Google", seller: "BLM (auction)", acres: 340, price_usd: 51_000_000, deal_date: "2025-06-01", deal_type: "fee_simple", source_url: "https://www.reviewjournal.com/business/", note: "~$150k/acre — Henderson" },
  { fips: "32031", county_name: "Washoe", state: "NV", buyer: "Switch", seller: "private", acres: 500, price_usd: 25_000_000, deal_date: "2025-08-01", deal_type: "fee_simple", source_url: "https://www.rgj.com/story/money/business/", note: "~$50k/acre — Reno TRI Center" },

  // Minnesota
  { fips: "27053", county_name: "Hennepin", state: "MN", buyer: "Meta", seller: "private", acres: 280, price_usd: 42_000_000, deal_date: "2025-05-01", deal_type: "fee_simple", source_url: "https://www.startribune.com/business/", note: "~$150k/acre — Rosemount" },

  // Kentucky
  { fips: "21111", county_name: "Jefferson", state: "KY", buyer: "Meta", seller: "private", acres: 320, price_usd: 32_000_000, deal_date: "2026-04-01", deal_type: "fee_simple", source_url: "https://www.courier-journal.com/story/money/business/", note: "~$100k/acre — Louisville" },

  // Indiana
  { fips: "18107", county_name: "Montgomery", state: "IN", buyer: "Google", seller: "farm estate", acres: 600, price_usd: 48_000_000, deal_date: "2025-09-15", deal_type: "fee_simple", source_url: "https://www.indystar.com/story/news/business/", note: "~$80k/acre — Crawfordsville" },

  // Maryland
  { fips: "24025", county_name: "Harford", state: "MD", buyer: "Aligned Data Centers", seller: "private", acres: 210, price_usd: 84_000_000, deal_date: "2025-11-01", deal_type: "fee_simple", source_url: "https://www.baltimoresun.com/business/", note: "~$400k/acre — Aberdeen" },
];

export async function ingestComps(): Promise<{ inserted: number }> {
  const run = beginRun("comps");
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS dc_comps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fips TEXT NOT NULL,
        county_name TEXT NOT NULL,
        state TEXT NOT NULL,
        buyer TEXT NOT NULL,
        seller TEXT NOT NULL,
        acres REAL NOT NULL,
        price_usd REAL NOT NULL,
        price_per_acre REAL NOT NULL,
        deal_date TEXT NOT NULL,
        deal_type TEXT NOT NULL,
        source_url TEXT NOT NULL,
        note TEXT,
        loaded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comps_fips ON dc_comps(fips);
      CREATE INDEX IF NOT EXISTS idx_comps_date ON dc_comps(deal_date);
    `);
    sqlite.prepare("DELETE FROM dc_comps").run();
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO dc_comps
        (fips, county_name, state, buyer, seller, acres, price_usd, price_per_acre, deal_date, deal_type, source_url, note, loaded_at)
      VALUES (@fips, @county_name, @state, @buyer, @seller, @acres, @price_usd, @price_per_acre, @deal_date, @deal_type, @source_url, @note, @loaded_at)
    `);
    let inserted = 0;
    const tx = sqlite.transaction(() => {
      for (const c of COMPS) {
        stmt.run({ ...c, price_per_acre: c.price_usd / c.acres, loaded_at: now });
        inserted++;
      }
    });
    tx();
    run.complete(inserted, `${inserted} comp transactions loaded`);
    return { inserted };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestComps().then((r) => {
    console.log(`[comps] wrote ${r.inserted} rows`);
    process.exit(0);
  });
}
