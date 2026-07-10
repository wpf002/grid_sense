// Display names for ingest pipelines.
//
// The generic humanize() turns "fema_nri" into "Fema nri", which is wrong on
// both counts: acronyms stay uppercase, and every word is Title Case. Pipeline
// names are almost entirely acronyms (EIA, FEMA, HIFLD, PJM...), so they get
// their own formatter.

/** Tokens that must render in a fixed casing rather than Title Case. */
const SPECIAL_TOKENS: Record<string, string> = {
  arcgis: "ArcGIS",
  bdc: "BDC",
  caiso: "CAISO",
  dc: "DC",
  edgar: "EDGAR",
  eia: "EIA",
  eia860: "EIA-860",
  eia861: "EIA-861",
  epa: "EPA",
  ercot: "ERCOT",
  fcc: "FCC",
  fema: "FEMA",
  hifld: "HIFLD",
  iso: "ISO",
  isone: "ISO-NE",
  lbnl: "LBNL",
  llcs: "LLCs",
  miso: "MISO",
  noaa: "NOAA",
  nri: "NRI",
  nyiso: "NYISO",
  osm: "OSM",
  peeringdb: "PeeringDB",
  pjm: "PJM",
  rucc: "RUCC",
  sec: "SEC",
  spp: "SPP",
  usda: "USDA",
  usgs: "USGS",
};

/** Whole-pipeline overrides where token-wise formatting still reads badly. */
const PIPELINE_NAMES: Record<string, string> = {
  comps: "Land Comps",
  dc_announcements_real: "DC Announcements",
  dc_backtest: "DC Backtest",
  dc_news: "DC News",
  competitive_from_announcements: "Competitive Bids",
  enrich: "Rescore Counties",
  expand_counties: "Expand Counties",
  generate_alerts: "Generate Alerts",
  score_history_daily: "Daily Score Snapshot",
  shell_llcs: "Shell LLC Resolver",
  wholesale_price: "Wholesale Power Prices",
  eia_power_price: "EIA Retail Power Price",
  iso_queue_history: "ISO Queue History",
  state_energy_factors: "State Energy Factors",
  state_incentives: "State Tax Incentives",
  water_stress: "Water Stress",
  overpass_parcels: "OSM Overpass Parcels",
};

/**
 * "fema_nri" -> "FEMA NRI", "arcgis_parcels" -> "ArcGIS Parcels".
 * Unknown pipelines fall back to Title Case rather than rendering raw snake_case.
 */
export function pipelineLabel(name: string): string {
  if (!name) return "";
  const override = PIPELINE_NAMES[name];
  if (override) return override;

  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((tok) => {
      const lower = tok.toLowerCase();
      if (SPECIAL_TOKENS[lower]) return SPECIAL_TOKENS[lower];
      // Trailing-digit forms like "eia860" that aren't in the token table.
      const m = lower.match(/^([a-z]+)(\d+)$/);
      if (m && SPECIAL_TOKENS[m[1]]) return `${SPECIAL_TOKENS[m[1]]}-${m[2]}`;
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    })
    .join(" ");
}
