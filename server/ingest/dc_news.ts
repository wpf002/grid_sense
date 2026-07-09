// Data-center news pipeline. Parses the Data Center Dynamics RSS feed and
// extracts announcements, permits, opposition, and expansion signals.
// Every item is timestamped and state/county-tagged when identifiable.
//
// Source: https://www.datacenterdynamics.com/en/rss/
// License: RSS is public; we store headline + link + our own summary only.

import { db } from "../storage.js";
import { rawDcNews } from "@shared/schema";
import { fetchText, nowIso, STATE_FIPS } from "./util.js";
import { XMLParser } from "fast-xml-parser";
import { lookupFips } from "./counties_ref.js";

const DCD_RSS_URL = "https://www.datacenterdynamics.com/en/rss/";

// Additional data-center-relevant RSS sources.
// All are public feeds; we store headline + link + summary only.
const RSS_SOURCES: Array<{ url: string; source: string }> = [
  { url: "https://www.datacenterdynamics.com/en/rss/", source: "Data Center Dynamics" },
  { url: "https://www.bisnow.com/rss/data-center", source: "Bisnow Data Center" },
  { url: "https://www.datacenterknowledge.com/rss.xml", source: "Data Center Knowledge" },
  { url: "https://www.utilitydive.com/feeds/news/", source: "Utility Dive" },
];

const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/oppos|protest|reject|moratorium|ban\b|halt|paus/i, "opposition"],
  [/permit|approved|approval|zoning|rezone/i, "permit"],
  [/announce|unveil|to build|reveal|breaks ground|acquir(e|ed)/i, "announcement"],
  [/expand|expansion|phase|new campus|adds \d/i, "expansion"],
  [/rumor|reported|speculat/i, "rumor"],
];

const STATE_NAMES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "District of Columbia": "DC",
};

function classifyCategory(text: string): string {
  for (const [re, cat] of CATEGORY_PATTERNS) {
    if (re.test(text)) return cat;
  }
  return "news";
}

function extractStates(text: string): string[] {
  const found = new Set<string>();
  for (const [name, abbr] of Object.entries(STATE_NAMES)) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    if (re.test(text)) found.add(abbr);
  }
  // Also look for 2-letter state abbreviations following a comma (", VA")
  const abbrMatches = text.matchAll(/,\s*([A-Z]{2})\b/g);
  for (const m of abbrMatches) {
    if (STATE_FIPS[m[1]]) found.add(m[1]);
  }
  return Array.from(found);
}

function extractCountyFips(text: string, states: string[]): string[] {
  const fipsList: string[] = [];
  // Look for "X County" or "X Parish" patterns
  const countyRe = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(County|Parish)\b/g;
  for (const m of text.matchAll(countyRe)) {
    const cname = m[1];
    for (const st of states) {
      const f = lookupFips(st, cname);
      if (f) fipsList.push(f);
    }
  }
  return Array.from(new Set(fipsList));
}

async function ingestOneFeed(url: string, source: string): Promise<{ inserted: number; total: number }> {
  console.log(`[dc_news] Fetching ${source}`);
  let xml: string;
  try {
    xml = await fetchText(url, { cacheKey: `rss_${source.replace(/\W+/g, "_")}.xml`, forceRefresh: true });
  } catch (e: any) {
    console.warn(`[dc_news] Failed to fetch ${source}:`, e.message);
    return { inserted: 0, total: 0 };
  }
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const items: any[] = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const fetchedAt = nowIso();
  let inserted = 0;
  for (const item of items) {
    const title = String(item.title?.["#text"] ?? item.title ?? "").trim();
    const link = String(
      typeof item.link === "string" ? item.link :
      item.link?.["@_href"] ?? item.link?.href ?? item.link?.["#text"] ?? ""
    ).trim();
    const guid = String(item.guid?.["#text"] ?? item.guid ?? item.id ?? link).trim();
    const desc = String(item.description ?? item.summary ?? item.content ?? "").replace(/<[^>]*>/g, "").trim();
    const pubDate = new Date(item.pubDate ?? item.published ?? item.updated ?? Date.now()).toISOString();
    if (!title || !link) continue;

    const fullText = `${title} ${desc}`;
    // For general-purpose feeds (utility/reuters), only keep items that mention DC keywords
    const isGeneral = source === "Utility Dive" || source === "Reuters Energy";
    if (isGeneral && !/data center|hyperscale|gigawatt|megawatt|interconnect|substation|electricity load/i.test(fullText)) {
      continue;
    }

    const states = extractStates(fullText);
    const fips = extractCountyFips(fullText, states);
    const category = classifyCategory(fullText);
    try {
      db.insert(rawDcNews)
        .values({
          guid,
          title,
          link,
          publishedAt: pubDate,
          source,
          summary: desc.slice(0, 500),
          mentionedStates: JSON.stringify(states),
          mentionedCounties: JSON.stringify(fips),
          category,
          fetchedAt,
        })
        .onConflictDoNothing()
        .run();
      inserted++;
    } catch (e) {
      // Uniqueness conflict OK
    }
  }
  console.log(`[dc_news] ${source}: ${inserted}/${items.length} inserted`);
  return { inserted, total: items.length };
}

export async function ingestDcNews(): Promise<{ inserted: number; total: number }> {
  let totalInserted = 0;
  let totalItems = 0;
  for (const { url, source } of RSS_SOURCES) {
    const r = await ingestOneFeed(url, source);
    totalInserted += r.inserted;
    totalItems += r.total;
  }
  console.log("[dc_news] Done. inserted=", totalInserted);
  return { inserted: totalInserted, total: totalItems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ingestDcNews()
    .then((r) => { console.log("Done:", r); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
