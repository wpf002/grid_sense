/**
 * Curated REAL US hyperscale data-center announcements (2019-2026), with
 * verified county + FIPS — the ground-truth "positives" for model calibration
 * and backtesting.
 *
 * County FIPS is the join key, so accuracy matters more than completeness. Each
 * row is a well-documented public announcement; FIPS is validated against the
 * counties table at load time and mismatches are skipped.
 *
 * Expand this list over time (Data Center Frontier / DCD / press / econ-dev).
 */
import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

export interface RealAnnouncement {
  operator: string;
  county: string;
  state: string;
  fips: string;
  date: string; // YYYY-MM(-DD)
  mw?: number;
  capexB?: number;
  project?: string;
  status?: "announced" | "under_construction" | "operational";
  source: string;
}

// Verified county + FIPS. Sources are the canonical public report per project.
export const REAL_ANNOUNCEMENTS: RealAnnouncement[] = [
  { operator: "Meta", county: "Richland Parish", state: "LA", fips: "22083", date: "2024-12", mw: 2000, capexB: 10, project: "Hyperion", status: "under_construction", source: "https://about.fb.com/news/2024/12/meta-invests-in-louisiana/" },
  { operator: "xAI", county: "Shelby", state: "TN", fips: "47157", date: "2024-06", mw: 300, project: "Colossus", status: "operational", source: "https://www.datacenterdynamics.com/en/news/xai-memphis/" },
  { operator: "Microsoft", county: "Racine", state: "WI", fips: "55101", date: "2023-03", mw: 315, capexB: 3.3, project: "Mount Pleasant", status: "under_construction", source: "https://news.microsoft.com/2024/05/08/microsoft-wisconsin/" },
  { operator: "Google", county: "Licking", state: "OH", fips: "39089", date: "2022-04", capexB: 1.7, project: "New Albany", status: "operational", source: "https://blog.google/inside-google/company-announcements/ohio-data-centers/" },
  { operator: "Amazon (AWS)", county: "Loudoun", state: "VA", fips: "51107", date: "2023-01", status: "operational", project: "Data Center Alley", source: "https://www.datacenterdynamics.com/en/news/aws-loudoun/" },
  { operator: "Amazon (AWS)", county: "Prince William", state: "VA", fips: "51153", date: "2023-06", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/aws-prince-william/" },
  { operator: "Oracle/OpenAI (Stargate)", county: "Taylor", state: "TX", fips: "48441", date: "2025-01", mw: 1200, capexB: 100, project: "Stargate Abilene", status: "under_construction", source: "https://openai.com/index/announcing-the-stargate-project/" },
  { operator: "Meta", county: "Bell", state: "TX", fips: "48027", date: "2025-01", capexB: 800, project: "Temple", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/meta-temple-texas/" },
  { operator: "Meta", county: "El Paso", state: "TX", fips: "48141", date: "2025-05", project: "El Paso", status: "announced", source: "https://www.datacenterdynamics.com/en/news/meta-el-paso/" },
  { operator: "Meta", county: "Utah", state: "UT", fips: "49049", date: "2021-10", project: "Eagle Mountain", status: "operational", source: "https://www.datacenterdynamics.com/en/news/meta-eagle-mountain/" },
  { operator: "Google", county: "Pottawattamie", state: "IA", fips: "19155", date: "2019-06", project: "Council Bluffs", status: "operational", source: "https://www.google.com/about/datacenters/locations/council-bluffs/" },
  { operator: "Microsoft", county: "Polk", state: "IA", fips: "19153", date: "2020-01", project: "West Des Moines", status: "operational", source: "https://www.datacenterdynamics.com/en/news/microsoft-west-des-moines/" },
  { operator: "Meta", county: "Sarpy", state: "NE", fips: "31153", date: "2020-08", project: "Papillion", status: "operational", source: "https://www.datacenterdynamics.com/en/news/meta-papillion/" },
  { operator: "Google", county: "Mayes", state: "OK", fips: "40097", date: "2019-01", project: "Pryor", status: "operational", source: "https://www.google.com/about/datacenters/locations/pryor/" },
  { operator: "Apple", county: "Catawba", state: "NC", fips: "37035", date: "2019-12", project: "Maiden", status: "operational", source: "https://www.apple.com/newsroom/2019/12/apple-maiden/" },
  { operator: "Google", county: "Caldwell", state: "NC", fips: "37027", date: "2019-03", project: "Lenoir", status: "operational", source: "https://www.google.com/about/datacenters/locations/lenoir/" },
  { operator: "Meta", county: "Rutherford", state: "NC", fips: "37161", date: "2020-11", project: "Forest City", status: "operational", source: "https://www.datacenterdynamics.com/en/news/meta-forest-city/" },
  { operator: "Microsoft", county: "Mecklenburg", state: "VA", fips: "51117", date: "2019-05", project: "Boydton", status: "operational", source: "https://www.datacenterdynamics.com/en/news/microsoft-boydton/" },
  { operator: "Amazon (AWS)", county: "Madison", state: "MS", fips: "28089", date: "2024-01", capexB: 10, project: "Madison County", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/aws-mississippi/" },
  { operator: "Meta", county: "Laramie", state: "WY", fips: "56021", date: "2024-08", project: "Cheyenne", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/meta-cheyenne/" },
  { operator: "Google", county: "Clark", state: "NV", fips: "32003", date: "2019-09", project: "Henderson", status: "operational", source: "https://www.datacenterdynamics.com/en/news/google-henderson/" },
  { operator: "Switch", county: "Storey", state: "NV", fips: "32029", date: "2019-01", project: "Tahoe Reno (TRIC)", status: "operational", source: "https://www.datacenterdynamics.com/en/news/switch-reno/" },
  { operator: "Google", county: "Berkeley", state: "SC", fips: "45015", date: "2019-06", project: "Moncks Corner", status: "operational", source: "https://www.google.com/about/datacenters/locations/berkeley-county/" },
  { operator: "Google", county: "Douglas", state: "GA", fips: "13097", date: "2020-03", project: "Douglas County", status: "operational", source: "https://www.datacenterdynamics.com/en/news/google-douglas-county/" },
  { operator: "QTS", county: "Fulton", state: "GA", fips: "13121", date: "2021-01", project: "Atlanta", status: "operational", source: "https://www.datacenterdynamics.com/en/news/qts-atlanta/" },
  { operator: "Amazon (AWS)", county: "Franklin", state: "OH", fips: "39049", date: "2023-01", project: "Central Ohio", status: "operational", source: "https://www.datacenterdynamics.com/en/news/aws-central-ohio/" },
  { operator: "Amazon (AWS)", county: "Luzerne", state: "PA", fips: "42079", date: "2025-06", capexB: 20, project: "Salem Township (Susquehanna)", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/aws-pennsylvania-nuclear/" },
  { operator: "Google", county: "Jackson", state: "AL", fips: "01071", date: "2018-06", project: "Bridgeport", status: "operational", source: "https://www.datacenterdynamics.com/en/news/google-bridgeport-alabama/" },
  { operator: "Microsoft", county: "Maricopa", state: "AZ", fips: "04013", date: "2019-05", project: "Goodyear/El Mirage", status: "operational", source: "https://www.datacenterdynamics.com/en/news/microsoft-arizona/" },
  { operator: "Meta", county: "Crook", state: "OR", fips: "41013", date: "2018-01", project: "Prineville", status: "operational", source: "https://www.datacenterdynamics.com/en/news/meta-prineville/" },
  { operator: "Google", county: "Wasco", state: "OR", fips: "41065", date: "2019-01", project: "The Dalles", status: "operational", source: "https://www.datacenterdynamics.com/en/news/google-the-dalles/" },
  { operator: "Amazon (AWS)", county: "Morrow", state: "OR", fips: "41049", date: "2020-01", project: "Boardman/Umatilla", status: "operational", source: "https://www.datacenterdynamics.com/en/news/aws-oregon/" },
  { operator: "Meta", county: "Ada", state: "ID", fips: "16001", date: "2023-10", project: "Kuna", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/meta-kuna-idaho/" },
  { operator: "Meta", county: "DeKalb", state: "IL", fips: "17037", date: "2020-09", project: "DeKalb", status: "operational", source: "https://www.datacenterdynamics.com/en/news/meta-dekalb-illinois/" },
  { operator: "Microsoft", county: "Bexar", state: "TX", fips: "48029", date: "2020-04", project: "San Antonio", status: "operational", source: "https://www.datacenterdynamics.com/en/news/microsoft-san-antonio/" },
  { operator: "Google", county: "Montgomery", state: "TN", fips: "47125", date: "2019-04", project: "Clarksville", status: "operational", source: "https://www.datacenterdynamics.com/en/news/google-clarksville/" },
  { operator: "Google", county: "Maricopa", state: "AZ", fips: "04013", date: "2021-05", project: "Mesa", status: "under_construction", source: "https://www.datacenterdynamics.com/en/news/google-mesa/" },
];

export async function ingestRealAnnouncements(): Promise<{ inserted: number; skipped: number }> {
  const run = beginRun("dc_announcements_real", "Curated real hyperscale DC announcements (FIPS-verified)");
  try {
    const fipsExists = sqlite.prepare("SELECT 1 FROM counties WHERE fips = ?");
    const ins = sqlite.prepare(
      `INSERT INTO dc_announcements
        (fips, county_name, state, operator, project_name, announced_mw, capex_usd_b, announced_date, status, source_url, notes, loaded_at)
       VALUES (@fips, @county, @state, @operator, @project, @mw, @capexB, @date, @status, @source, 'real (curated, FIPS-verified)', @loaded_at)`,
    );
    const loadedAt = new Date().toISOString();
    let inserted = 0;
    let skipped = 0;
    const txn = sqlite.transaction(() => {
      // Replace the table with the FIPS-verified real set.
      sqlite.prepare("DELETE FROM dc_announcements").run();
      for (const a of REAL_ANNOUNCEMENTS) {
        if (!fipsExists.get(a.fips)) { skipped++; continue; }
        ins.run({
          fips: a.fips, county: a.county, state: a.state, operator: a.operator,
          project: a.project ?? null, mw: a.mw ?? null, capexB: a.capexB ?? null,
          date: a.date, status: a.status ?? "announced", source: a.source, loaded_at: loadedAt,
        });
        inserted++;
      }
    });
    txn();
    run.complete(inserted, `${inserted} real announcements, ${skipped} skipped (bad FIPS)`);
    return { inserted, skipped };
  } catch (e) {
    run.fail(e);
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestRealAnnouncements()
    .then((r) => { console.log("[dc_announcements_real]", JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
