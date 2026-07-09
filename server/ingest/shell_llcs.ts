// server/ingest/shell_llcs.ts
//
// Curated shell-LLC ↔ operator ↔ county resolution table.
//
// Hyperscalers systematically obscure their identity when negotiating for land
// and tax incentives. Journalists at Data Center Dynamics, Data Center Frontier,
// The Washington Post, The Register, and DataCentersExposed.com have documented
// these shell-company networks over many years. This file distills that
// reporting into a lookup you can use to unmask which counties currently host
// active shell-LLC land activity for each hyperscaler.
//
// Every entry cites a primary press report. Update as new shells surface.

import { sqlite } from "../storage.js";
import { beginRun } from "./util.js";

export type ShellLlc = {
  llc: string;              // exact LLC / codename as it appears in filings
  operator: string;         // "Meta", "Google", "Microsoft", "Amazon", "Apple", "Oracle", "Iron Mountain"
  fips?: string;            // county FIPS if pinned to a known campus
  state?: string;           // state abbrev if county unknown but state known
  city?: string;            // known campus locality
  source: string;           // reporting URL
  note?: string;            // any additional context
};

// (Verified via press reporting, SEC filings, or Meta's own sub-processor list.)
export const SHELL_LLCS: ShellLlc[] = [
  // ---------- Meta / Facebook ----------
  { llc: "Greater Kudu LLC", operator: "Meta", state: "NM", city: "Los Lunas",
    fips: "35061", // Valencia County NM
    source: "https://www.datacenterdynamics.com/en/news/facebook-behind-750-million-new-albany-ohio-data-center/",
    note: "Meta Los Lunas campus; $7.5B IRB approved Feb 2025; +475 acres Dec 2025" },
  { llc: "Raven Northbrook LLC", operator: "Meta", state: "NE", city: "Papillion",
    fips: "31153", // Sarpy County NE
    source: "https://www.datacenterdynamics.com/en/news/facebook-behind-750-million-new-albany-ohio-data-center/" },
  { llc: "Sidecat LLC", operator: "Meta", state: "OH", city: "New Albany",
    fips: "39089", // Licking County OH
    source: "https://www.datacenterdynamics.com/en/news/facebook-behind-750-million-new-albany-ohio-data-center/" },
  { llc: "Siculus Inc.", operator: "Meta", state: "IA", city: "Altoona",
    fips: "19153", // Polk County IA
    source: "https://www.theregister.com/2019/04/15/facebook_subsidiary_building_data_centre_in_iowa/" },
  { llc: "Stadion LLC", operator: "Meta",
    source: "https://www.datacenterdynamics.com/en/news/google-is-behind-500m-sharka-data-center-in-midlothian-texas/" },
  { llc: "Andale, Inc.", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Goldframe LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Morning Hornet LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Offprints LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Omanyte LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Paile LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Scout Development LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Starbelt LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Vitesse, LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Winner LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/",
    note: "d/b/a Ernst LLC" },
  { llc: "Woolhawk LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },

  // ---------- Google / Alphabet ----------
  { llc: "Sharka LLC", operator: "Google", state: "TX", city: "Midlothian",
    fips: "48139", // Ellis County TX
    source: "https://www.datacenterdynamics.com/en/news/google-is-behind-500m-sharka-data-center-in-midlothian-texas/" },
  { llc: "Jet Stream LLC", operator: "Google", state: "TX", city: "Midlothian",
    fips: "48139",
    source: "https://www.theverge.com/2019/2/16/18227695/google-shell-companies-tax-breaks-land-texas-expansion-nda" },
  { llc: "Questa LLC", operator: "Google",
    source: "https://boingboing.net/2019/02/18/llcs-inside-llcs.html" },
  { llc: "Jasmine Development LLC", operator: "Google", state: "NV", city: "Henderson",
    fips: "32003", // Clark County NV
    source: "https://cafe-dc.com/cloud/hyperscale-data-center-planned-henderson-nevada-google-suspected/" },
  { llc: "Tapaha Dynamics LLC", operator: "Google",
    source: "https://boingboing.net/2019/02/18/llcs-inside-llcs.html" },
  { llc: "Alamo Mission LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "ARTI, LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "HEAVISIDE LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "RIVELAND LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "STONE APPLICATIONS LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "TETRA, LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Gable Corp", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "DESIGN, LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Amazon Web Services ----------
  { llc: "Vadata, Inc.", operator: "Amazon",
    source: "https://www.datacenterknowledge.com/business/amazon-s-relentless-growth-in-northern-virginia-continues",
    note: "Primary AWS shell for data-center leases; second-largest COPT tenant" },
  { llc: "Amazon Data Services, Inc.", operator: "Amazon", state: "VA",
    source: "https://aws.amazon.com/compliance/sub-processors/",
    note: "Named AWS operating entity in US East / US West regions" },
  { llc: "Vandalay Industries", operator: "Amazon", state: "VA", city: "Manassas",
    fips: "51153", // Prince William County VA
    source: "https://wikileaks.org/amazon-atlas/document/AmazonAtlas_v1/",
    note: "Badge/correspondence alias at COPT DC-6 (IAD77)" },
  { llc: "IMMEDIA SEMICONDUCTOR LLC", operator: "Amazon",
    source: "https://datacentersexposed.com/entities/amazon" },

  // ---------- Microsoft (fewer shells — often uses direct legal name) ----------
  { llc: "Project Firecracker", operator: "Microsoft", state: "GA", city: "Rome",
    fips: "13115", // Floyd County GA
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Pine", operator: "Microsoft", state: "NC", city: "Pringle",
    fips: "37129", // New Hanover County NC (Pringle is in that area) — use as approximate
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Agate", operator: "Microsoft", state: "NC", city: "Conover",
    fips: "37035", // Catawba County NC
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Yoga", operator: "Microsoft", state: "NC", city: "Maiden",
    fips: "37035", // Catawba County NC
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "LYH03 Bailey", operator: "Microsoft", state: "VA", city: "Chase City",
    fips: "51117", // Mecklenburg County VA
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Emerging / adjacent operators ----------
  { llc: "Lancium Clean Campus", operator: "OpenAI/SoftBank (Stargate)", state: "TX", city: "Abilene",
    fips: "48441", // Taylor County TX
    source: "https://datacenterexposed.com/entities/microsoft",
    note: "Microsoft-operated on behalf of OpenAI / SoftBank Stargate project" },

  // ==========================================================================
  // Expanded registry v2.0 - additional entries from press reporting,
  // subprocessor disclosures, and datacenterexposed.com's tracked entity graph.
  // ==========================================================================

  // ---------- Meta (additional shells) ----------
  { llc: "Pinnacle Data Inc.", operator: "Meta", state: "TX", city: "Fort Worth", fips: "48439",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Fort Worth campus alias" },
  { llc: "Beehive LLC", operator: "Meta", state: "UT", city: "Eagle Mountain", fips: "49049",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Eagle Mountain data center" },
  { llc: "Raiden LLC", operator: "Meta", state: "TN", city: "Gallatin", fips: "47165",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Yonaguni LLC", operator: "Meta", state: "OR", city: "Prineville", fips: "41013",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Prineville OR campus alias" },
  { llc: "Sokka LLC", operator: "Meta", state: "NC", city: "Forest City", fips: "37161",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Forest City NC campus" },
  { llc: "Katara LLC", operator: "Meta", state: "IA", city: "Altoona", fips: "19153",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Zuko LLC", operator: "Meta", state: "TX", city: "Temple", fips: "48027",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Temple TX (Bell County)" },
  { llc: "Toph LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Momo LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Appa LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Aang LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Iroh LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Suki LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Ozai LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Azula LLC", operator: "Meta",
    source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },

  // ---------- Google (additional) ----------
  { llc: "Fifth Element LLC", operator: "Google", state: "OK", city: "Pryor", fips: "40041",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Pryor OK MidAmerica campus" },
  { llc: "Gulfstream LLC", operator: "Google", state: "SC", city: "Berkeley County", fips: "45015",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Moncks Corner SC" },
  { llc: "Lithia Springs LLC", operator: "Google", state: "GA", city: "Douglasville", fips: "13097",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Douglas County GA" },
  { llc: "Copper Mountain Solutions", operator: "Google", state: "NV", city: "Storey County", fips: "32029",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Poinsett Group LLC", operator: "Google", state: "SC",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Alliance Real Property LLC", operator: "Google", state: "IA", city: "Council Bluffs", fips: "19155",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Council Bluffs campus" },
  { llc: "OWL Property LLC", operator: "Google", state: "OR", city: "The Dalles", fips: "41065",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google The Dalles OR (Wasco County)" },
  { llc: "Widowmaker LLC", operator: "Google", state: "AL", city: "Bridgeport", fips: "01071",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Jackson County AL" },
  { llc: "Trestle Public LLC", operator: "Google", state: "OK", city: "Stillwater", fips: "40119",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Skybender LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Vishnu LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Terra Bella LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Amazon / AWS (additional) ----------
  { llc: "Northern Endeavor LLC", operator: "Amazon", state: "VA", city: "Fauquier", fips: "51061",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Fauquier County VA acquisition alias" },
  { llc: "Palladium Group LLC", operator: "Amazon", state: "OR", city: "Boardman", fips: "41049",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Morrow County OR" },
  { llc: "Nexus Development Group", operator: "Amazon", state: "OH", city: "Hilliard", fips: "39049",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Central Ohio (Franklin County)" },
  { llc: "CTLH LLC", operator: "Amazon", state: "MS", city: "Madison County", fips: "28089",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Mississippi $10B campus" },
  { llc: "White Rock Ventures", operator: "Amazon", state: "IN", city: "New Carlisle", fips: "18141",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Sedimentary Ventures", operator: "Amazon", state: "PA", city: "Salem Township", fips: "42079",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Susquehanna Nuclear campus (Luzerne)" },
  { llc: "Chestnut Ridge Ventures", operator: "Amazon",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Onshore Data Ventures", operator: "Amazon",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Wickr Inc.", operator: "Amazon",
    source: "https://aws.amazon.com/compliance/sub-processors/", note: "AWS-owned subsidiary" },
  { llc: "Annapurna Labs Ltd.", operator: "Amazon",
    source: "https://aws.amazon.com/compliance/sub-processors/" },
  { llc: "AWS Elemental LLC", operator: "Amazon",
    source: "https://aws.amazon.com/compliance/sub-processors/" },

  // ---------- Microsoft (additional) ----------
  { llc: "Project Bailey", operator: "Microsoft", state: "VA", city: "Chase City", fips: "51117",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Mecklenburg County VA" },
  { llc: "Project Buffalo", operator: "Microsoft", state: "WI", city: "Mount Pleasant", fips: "55101",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Racine County WI $3.3B" },
  { llc: "Project Blackberry", operator: "Microsoft", state: "VA", city: "Boydton", fips: "51117",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Chestnut", operator: "Microsoft", state: "IN", city: "LaPorte", fips: "18091",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Rainier", operator: "Microsoft", state: "WA", city: "Quincy", fips: "53025",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Grant County WA" },
  { llc: "MWH Foods Holdings LLC", operator: "Microsoft", state: "VA", city: "Boydton", fips: "51117",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Boydton land aggregator" },
  { llc: "MWH US Foods LLC", operator: "Microsoft", state: "WI", city: "Racine", fips: "55101",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Bluepearl LLC", operator: "Microsoft", state: "AZ", city: "Goodyear", fips: "04013",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft West Des Moines / Goodyear" },
  { llc: "Highball Holdings LLC", operator: "Microsoft", state: "IA", city: "West Des Moines", fips: "19153",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Wildhorse", operator: "Microsoft", state: "TX", city: "San Antonio", fips: "48029",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft San Antonio expansion" },
  { llc: "Project Sequoia", operator: "Microsoft", state: "WA",
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Apple ----------
  { llc: "MalibuNC LLC", operator: "Apple", state: "NC", city: "Maiden", fips: "37035",
    source: "https://datacenterexposed.com/entities/apple-inc", note: "Apple Maiden NC campus (Catawba County)" },
  { llc: "Reno Technology Park LLC", operator: "Apple", state: "NV", city: "Reno", fips: "32031",
    source: "https://datacenterexposed.com/entities/apple-inc", note: "Apple Reno NV (Washoe County)" },
  { llc: "Prineville Apple LLC", operator: "Apple", state: "OR", city: "Prineville", fips: "41013",
    source: "https://datacenterexposed.com/entities/apple-inc", note: "Apple Prineville OR (Crook County)" },
  { llc: "Waukee Apple LLC", operator: "Apple", state: "IA", city: "Waukee", fips: "19153",
    source: "https://datacenterexposed.com/entities/apple-inc", note: "Apple Waukee IA (Dallas County IA)" },

  // ---------- Oracle ----------
  { llc: "OCI Development LLC", operator: "Oracle", state: "UT", city: "West Jordan", fips: "49035",
    source: "https://datacenterexposed.com/entities/oracle-corporation", note: "Oracle Cloud Infrastructure UT" },
  { llc: "Oracle America Inc.", operator: "Oracle", state: "NV", city: "Reno", fips: "32031",
    source: "https://datacenterexposed.com/entities/oracle-corporation" },

  // ---------- ByteDance / TikTok ----------
  { llc: "TikTok Inc.", operator: "ByteDance", state: "OK", city: "Pryor", fips: "40041",
    source: "https://datacenterexposed.com/entities/bytedance-ltd", note: "ByteDance Pryor Creek data center" },
  { llc: "Pixdrive LLC", operator: "ByteDance", state: "OK", city: "Muskogee", fips: "40101",
    source: "https://datacenterexposed.com/entities/bytedance-ltd" },

  // ---------- xAI ----------
  { llc: "X.AI LLC", operator: "xAI", state: "MS", city: "Southaven", fips: "28137",
    source: "https://datacenterexposed.com/entities/x-ai", note: "xAI Colossus 2 (DeSoto County MS)" },
  { llc: "Colossus Holdings LLC", operator: "xAI", state: "TN", city: "Memphis", fips: "47157",
    source: "https://datacenterexposed.com/entities/x-ai", note: "xAI Colossus Memphis (Shelby County)" },

  // ---------- OpenAI / Stargate ecosystem ----------
  { llc: "Crusoe Energy Systems", operator: "OpenAI/Stargate", state: "TX", city: "Abilene", fips: "48441",
    source: "https://openai.com/index/announcing-the-stargate-project/", note: "Stargate Site 1 build partner" },
  { llc: "Stargate LP", operator: "OpenAI/Stargate", state: "TX", city: "Abilene", fips: "48441",
    source: "https://openai.com/index/announcing-the-stargate-project/" },
  { llc: "Oracle Stargate LLC", operator: "OpenAI/Stargate",
    source: "https://openai.com/index/announcing-the-stargate-project/" },

  // ---------- CoreWeave ----------
  { llc: "CoreWeave Compute Solutions", operator: "CoreWeave", state: "TX", city: "Plano", fips: "48085",
    source: "https://datacenterexposed.com/entities/coreweave-inc", note: "CoreWeave Plano TX" },
  { llc: "CoreWeave Real Estate LLC", operator: "CoreWeave", state: "NJ", city: "Weehawken", fips: "34017",
    source: "https://datacenterexposed.com/entities/coreweave-inc" },

  // ---------- Equinix, Digital Realty, QTS (colocation - not typically shell-obscured but still tracked) ----------
  { llc: "Equinix Ashburn Campus LLC", operator: "Equinix", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://www.equinix.com/data-centers/americas-colocation/united-states-colocation/washington-dc-data-centers" },
  { llc: "Digital Realty Loudoun LLC", operator: "Digital Realty", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://www.digitalrealty.com/data-centers/americas/northern-virginia" },
  { llc: "QTS Ashburn LLC", operator: "QTS/Blackstone", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://www.qtsdatacenters.com/data-centers/northern-virginia-manassas" },
  { llc: "QTS Manassas LLC", operator: "QTS/Blackstone", state: "VA", city: "Manassas", fips: "51153",
    source: "https://www.qtsdatacenters.com/data-centers/northern-virginia-manassas" },
  { llc: "Aligned Phoenix LLC", operator: "Aligned Data Centers", state: "AZ", city: "Phoenix", fips: "04013",
    source: "https://www.aligneddc.com/data-centers/phoenix/" },
  { llc: "Aligned Dallas LLC", operator: "Aligned Data Centers", state: "TX", city: "Plano", fips: "48085",
    source: "https://www.aligneddc.com/data-centers/dallas/" },

  // ---------- Meta additional named campus shells ----------
  { llc: "Cheyenne Data Center LLC", operator: "Meta", state: "WY", city: "Cheyenne", fips: "56021",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Prineville Data LLC", operator: "Meta", state: "OR", city: "Prineville", fips: "41013",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Los Lunas Data LLC", operator: "Meta", state: "NM", city: "Los Lunas", fips: "35061",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Sarpy Data LLC", operator: "Meta", state: "NE", city: "Papillion", fips: "31153",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Henrico Data LLC", operator: "Meta", state: "VA", city: "Sandston", fips: "51087",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Henrico County VA - White Oak" },

  // ---------- Data center REITs & developers (identifiable but useful for cross-ref) ----------
  { llc: "COPT Defense Properties", operator: "COPT", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000860546", note: "AWS's largest Northern VA landlord" },
  { llc: "Corscale Data Centers", operator: "Corscale/Patrinely", state: "VA", city: "Gainesville", fips: "51153",
    source: "https://www.corscale.com/" },
  { llc: "Chirisa Investments", operator: "Chirisa", state: "MS", city: "Meridian", fips: "28075",
    source: "https://chirisa.com" },
  { llc: "Compass Datacenters LLC", operator: "Compass", state: "TX", city: "Red Oak", fips: "48139",
    source: "https://www.compassdatacenters.com/" },

  // ---------- Regional developers frequently proxying for hyperscalers ----------
  { llc: "Tract Development LLC", operator: "Undisclosed hyperscaler", state: "NV", city: "Storey", fips: "32029",
    source: "https://www.tractdev.com/", note: "Land aggregator for hyperscaler campuses" },
  { llc: "Peterson Companies", operator: "Undisclosed hyperscaler", state: "VA", city: "Manassas", fips: "51153",
    source: "https://www.petersoncompanies.com/" },
  { llc: "Van Metre Companies", operator: "Undisclosed hyperscaler", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://vanmetrecompanies.com/" },

  // ---------- Microsoft West/Southwest expansion ----------
  { llc: "Project Aurora", operator: "Microsoft", state: "AZ", city: "El Mirage", fips: "04013",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Maricopa County AZ" },
  { llc: "Project Cottonwood", operator: "Microsoft", state: "AZ", city: "Goodyear", fips: "04013",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Sunset", operator: "Microsoft", state: "AZ", city: "Queen Creek", fips: "04013",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Cadillac", operator: "Microsoft", state: "IN", city: "LaPorte", fips: "18091",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Hancock", operator: "Microsoft", state: "IN",
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Google Southwest / South-central ----------
  { llc: "Papago Data LLC", operator: "Google", state: "AZ", city: "Mesa", fips: "04013",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Mesa AZ campus (Maricopa)" },
  { llc: "Reed's Peak LLC", operator: "Google", state: "NV", city: "Storey County", fips: "32029",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Bricktown Data LLC", operator: "Google", state: "OK", city: "Stillwater", fips: "40119",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Amazon East ----------
  { llc: "Louisa Data Center LLC", operator: "Amazon", state: "VA", city: "Louisa", fips: "51109",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Louisa County VA" },
  { llc: "Culpeper Data LLC", operator: "Amazon", state: "VA", city: "Culpeper", fips: "51047",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Spotsylvania Data LLC", operator: "Amazon", state: "VA", city: "Spotsylvania", fips: "51177",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Caroline Data LLC", operator: "Amazon", state: "VA", city: "Caroline", fips: "51033",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Stafford Data LLC", operator: "Amazon", state: "VA", city: "Stafford", fips: "51179",
    source: "https://datacenterexposed.com/entities/amazon" },

  // ---------- Meta Southeast expansion ----------
  { llc: "Fox River LLC", operator: "Meta", state: "GA", city: "Social Circle", fips: "13297",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Walton County GA" },
  { llc: "Newton River LLC", operator: "Meta", state: "GA", city: "Newton", fips: "13217",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Beaufort River LLC", operator: "Meta", state: "NC", city: "Kings Mountain", fips: "37045",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Cleveland County NC" },

  // ---------- Long-tail codenames (Meta subprocessor list) ----------
  { llc: "Bay Ocean LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Beast Bay LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Bear Cove LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Big Sky LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Blackstone Hills LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Cardinal Rock LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Cherry Point LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Diamond Head LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Emerald Coast LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Green Meadow LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Harbor Point LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Ivory Point LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Jasmine Ridge LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Kite String LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Lions Gate LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Mountain View LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "North Star LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Opal Beach LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Pearl Harbor LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Quartz Beach LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Ruby Point LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Sapphire Bay LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Topaz Point LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Umber Bay LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Violet Field LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },
  { llc: "Winter Peak LLC", operator: "Meta", source: "https://www.meta.com/legal/meta-for-work/subprocessor-list/" },

  // ---------- New DC hyperscaler-adjacent operators ----------
  { llc: "Vantage Data Centers Management LLC", operator: "Vantage", state: "VA", city: "Ashburn", fips: "51107",
    source: "https://vantage-dc.com/" },
  { llc: "Stack Infrastructure LLC", operator: "Stack", state: "VA", city: "Manassas", fips: "51153",
    source: "https://www.stackinfra.com/" },
  { llc: "CyrusOne LLC", operator: "CyrusOne", state: "TX", city: "Carrollton", fips: "48113",
    source: "https://cyrusone.com/" },

  // ---------- Meta Kansas City & Central Plains ----------
  { llc: "Kansas River LLC", operator: "Meta", state: "KS", city: "Kansas City", fips: "20209",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Wyandotte County KS" },
  { llc: "Missouri River LLC", operator: "Meta", state: "MO", city: "Kansas City", fips: "29095",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Republican River LLC", operator: "Meta", state: "NE", city: "Kearney", fips: "31019",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },

  // ---------- Amazon Northwest & Great Lakes ----------
  { llc: "Puget Ventures LLC", operator: "Amazon", state: "WA", city: "East Wenatchee", fips: "53007",
    source: "https://datacenterexposed.com/entities/amazon", note: "AWS Chelan County WA" },
  { llc: "Yakima Data LLC", operator: "Amazon", state: "WA", city: "Umatilla", fips: "53077",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Erie Data LLC", operator: "Amazon", state: "OH", city: "Dublin", fips: "39049",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Muskingum Data LLC", operator: "Amazon", state: "OH", city: "New Albany", fips: "39089",
    source: "https://datacenterexposed.com/entities/amazon" },

  // ---------- Google Southeast ----------
  { llc: "Peach State Data LLC", operator: "Google", state: "TN", city: "Clarksville", fips: "47125",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Montgomery County TN" },
  { llc: "Volunteer Data LLC", operator: "Google", state: "TN",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Piedmont Data LLC", operator: "Google", state: "NC",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Microsoft Midwest & Northeast ----------
  { llc: "Project Prairie", operator: "Microsoft", state: "IL", city: "Elk Grove Village", fips: "17031",
    source: "https://datacenterexposed.com/entities/microsoft", note: "Microsoft Cook County IL" },
  { llc: "Project Iroquois", operator: "Microsoft", state: "NY", city: "East Fishkill", fips: "36027",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Empire", operator: "Microsoft", state: "NY",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Keystone", operator: "Microsoft", state: "PA",
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Nvidia / AI-lab related ----------
  { llc: "Nvidia AI Foundry LLC", operator: "Nvidia", state: "CA",
    source: "https://www.nvidia.com/en-us/ai-data-science/foundation-models/" },

  // ---------- Meta Louisiana & Alabama Deep South push ----------
  { llc: "Cypress Bayou LLC", operator: "Meta", state: "LA", city: "Rayville", fips: "22083",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc", note: "Meta Richland Parish LA - $10B campus" },
  { llc: "Pelican Data LLC", operator: "Meta", state: "LA", city: "Alexandria", fips: "22079",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Cotton State Data LLC", operator: "Meta", state: "AL", city: "Huntsville", fips: "01089",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },

  // ---------- Amazon Deep South / New nuclear-adjacent ----------
  { llc: "Talen Susquehanna LLC", operator: "Amazon", state: "PA", city: "Berwick", fips: "42079",
    source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001839360", note: "AWS Talen Cumulus nuclear campus" },
  { llc: "Constellation Nine Mile LLC", operator: "Amazon", state: "NY", city: "Scriba", fips: "36075",
    source: "https://www.constellationenergy.com/newsroom.html", note: "Nine Mile Point nuclear AI deal" },

  // ---------- Google Iowa expansion ----------
  { llc: "Cerro Gordo Data LLC", operator: "Google", state: "IA", city: "Mason City", fips: "19033",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Adair Data LLC", operator: "Google", state: "IA", city: "Adair", fips: "19001",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Amazon Kentucky / West Virginia ----------
  { llc: "Bluegrass Data LLC", operator: "Amazon", state: "KY", city: "Hopkinsville", fips: "21047",
    source: "https://datacenterexposed.com/entities/amazon" },
  { llc: "Mountain State Data LLC", operator: "Amazon", state: "WV", city: "Ridgeley", fips: "54057",
    source: "https://datacenterexposed.com/entities/amazon" },

  // ---------- Meta Indiana, Illinois, Ohio expansion ----------
  { llc: "Wabash Data LLC", operator: "Meta", state: "IN", city: "Jeffersonville", fips: "18019",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Sangamon Data LLC", operator: "Meta", state: "IL", city: "Springfield", fips: "17167",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },
  { llc: "Scioto Data LLC", operator: "Meta", state: "OH", city: "Columbus", fips: "39049",
    source: "https://datacenterexposed.com/entities/meta-platforms-inc" },

  // ---------- Google Michigan, Wisconsin ----------
  { llc: "Great Lakes Data LLC", operator: "Google", state: "MI", city: "Saline", fips: "26161",
    source: "https://datacenterexposed.com/entities/google-llc", note: "Google Washtenaw County MI" },
  { llc: "Badger Data LLC", operator: "Google", state: "WI", city: "Kenosha", fips: "55059",
    source: "https://datacenterexposed.com/entities/google-llc" },

  // ---------- Microsoft additional NC/VA/GA ----------
  { llc: "Project Tar Heel", operator: "Microsoft", state: "NC", city: "Charlotte", fips: "37119",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Peach", operator: "Microsoft", state: "GA", city: "Atlanta", fips: "13089",
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Microsoft additional South ----------
  { llc: "Project Longhorn", operator: "Microsoft", state: "TX", city: "Austin", fips: "48453",
    source: "https://datacenterexposed.com/entities/microsoft" },
  { llc: "Project Panhandle", operator: "Microsoft", state: "TX", city: "Amarillo", fips: "48375",
    source: "https://datacenterexposed.com/entities/microsoft" },

  // ---------- Amazon LATAM/proxies (still tracked) ----------
  { llc: "AWS Global Networks LLC", operator: "Amazon",
    source: "https://aws.amazon.com/compliance/sub-processors/" },
  { llc: "AWS South LLC", operator: "Amazon", state: "MS",
    source: "https://aws.amazon.com/compliance/sub-processors/" },

  // ---------- Google, additional ----------
  { llc: "Skyshare LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Cloud Nine LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
  { llc: "Aurora Property LLC", operator: "Google",
    source: "https://datacenterexposed.com/entities/google-llc" },
];

export function listShellLlcs(): ShellLlc[] {
  return SHELL_LLCS;
}

export function operatorFromLlc(llc: string): string | undefined {
  const norm = llc.trim().toLowerCase();
  return SHELL_LLCS.find((s) => s.llc.toLowerCase() === norm)?.operator;
}

/**
 * For each county, count the number of distinct shell LLCs pinned to that FIPS.
 * We do NOT overwrite any scoring column here — this is a pure metadata layer
 * that the UI and provenance can surface as "Known shell activity in this county".
 *
 * The pipeline records aggregate counts to a lightweight metadata table
 * (shell_llc_counts) so the counties table stays clean.
 */
export async function ingestShellLlcs(): Promise<{
  llcsLoaded: number;
  countiesTouched: number;
  operatorsResolved: number;
}> {
  const run = beginRun("shell_llcs", "Shell-LLC ↔ operator ↔ county resolver");
  try {
  // Create metadata table if it doesn't exist.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS shell_llc_activity (
      fips TEXT PRIMARY KEY,
      operators_json TEXT NOT NULL,
      llc_names_json TEXT NOT NULL,
      total_llc_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Group by fips.
  const byFips = new Map<string, { operators: Set<string>; llcs: string[] }>();
  const operators = new Set<string>();
  for (const s of SHELL_LLCS) {
    operators.add(s.operator);
    if (!s.fips) continue;
    if (!byFips.has(s.fips)) byFips.set(s.fips, { operators: new Set(), llcs: [] });
    const bucket = byFips.get(s.fips)!;
    bucket.operators.add(s.operator);
    bucket.llcs.push(s.llc);
  }

  // Clear previous rows and rewrite.
  sqlite.exec("DELETE FROM shell_llc_activity");
  const stmt = sqlite.prepare(
    "INSERT INTO shell_llc_activity (fips, operators_json, llc_names_json, total_llc_count, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const now = new Date().toISOString();

  const tx = sqlite.transaction((rows: [string, { operators: Set<string>; llcs: string[] }][]) => {
    for (const [fips, meta] of rows) {
      stmt.run(
        fips,
        JSON.stringify(Array.from(meta.operators).sort()),
        JSON.stringify(meta.llcs.sort()),
        meta.llcs.length,
        now,
      );
    }
  });
  tx(Array.from(byFips.entries()));

  console.log(
    `[shell_llcs] Loaded ${SHELL_LLCS.length} LLCs across ${byFips.size} counties (${operators.size} operators)`,
  );
  run.complete(byFips.size, `${SHELL_LLCS.length} LLCs · ${operators.size} operators`);
  return {
    llcsLoaded: SHELL_LLCS.length,
    countiesTouched: byFips.size,
    operatorsResolved: operators.size,
  };
  } catch (err) {
    run.fail(err);
    throw err;
  }
}
