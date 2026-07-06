import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// Counties — the primary unit of prediction
// ============================================================================
export const counties = sqliteTable("counties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fips: text("fips").notNull().unique(),           // 5-digit county FIPS
  name: text("name").notNull(),                     // "Loudoun"
  state: text("state").notNull(),                   // "VA"
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),

  // ISO/utility zone
  iso: text("iso"),                                 // ERCOT, PJM, MISO, SPP, CAISO, SERC, ...
  utility: text("utility"),                         // Primary utility

  // Grid signal
  queuedLoadMw: real("queued_load_mw").default(0),  // Interconnection queue MW attributed to this county
  substationHeadroomMva: real("substation_headroom_mva"),
  timeToPowerMonths: real("time_to_power_months"),  // Median energization time
  onsiteGenerationFriendly: integer("onsite_generation_friendly", { mode: "boolean" }).default(false),

  // Fiber / connectivity
  fiberDensityScore: real("fiber_density_score").default(0),      // 0-100
  peeringExchangeCount: integer("peering_exchange_count").default(0),

  // Land
  largeParcelCount: integer("large_parcel_count").default(0),     // Parcels >500 acres
  medianLandPricePerAcre: real("median_land_price_per_acre"),
  floodplainPctBlock: real("floodplain_pct_block").default(0),    // % of large parcels in floodplain
  hazardScore: real("hazard_score").default(0),                    // 0-100 (higher = more risk)

  // Water
  waterStressScore: real("water_stress_score").default(0),         // 0-100 (higher = more stressed)

  // Climate / cooling (NOAA NCEI 1991-2020 Climate Normals)
  coolingDegreeDays: real("cooling_degree_days"),                  // annual CDD (base 65F); higher = more cooling load
  heatingDegreeDays: real("heating_degree_days"),                  // annual HDD; higher = colder = more free-cooling potential
  coolingScore: real("cooling_score"),                            // 0-100 (higher = better DC cooling climate)

  // Fiscal / policy
  taxIncentiveScore: real("tax_incentive_score").default(0),       // 0-100
  moratoriumStatus: text("moratorium_status").default("none"),     // none | proposed | active
  rightToBuildZoning: integer("right_to_build_zoning", { mode: "boolean" }).default(false),

  // Cluster effects
  existingDcCount: integer("existing_dc_count").default(0),
  existingDcCapacityMw: real("existing_dc_capacity_mw").default(0),

  // Derived
  landingProbability: real("landing_probability").default(0),      // 0-100
  scoreTier: text("score_tier").default("cold"),                   // hot | warm | emerging | cold
  updatedAt: text("updated_at").default("2026-07-04"),
});

// ============================================================================
// Signals — individual events feeding the parcel trigger layer
// ============================================================================
export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countyFips: text("county_fips").notNull(),
  signalType: text("signal_type").notNull(),        // llc_land_purchase | rezoning | substation_filing | water_permit | interconnection_request | building_permit | incentive_deal | codename_resolved
  weight: real("weight").notNull(),                 // How predictive (0-1) — used by scoring
  leadTimeMonths: real("lead_time_months"),         // Typical lead time
  headline: text("headline").notNull(),
  detail: text("detail"),
  suspectedOperator: text("suspected_operator"),    // Meta, Google, Microsoft, ... or "unknown"
  shellLlc: text("shell_llc"),                      // "Raven Northbrook LLC"
  parcelAcres: real("parcel_acres"),
  detectedAt: text("detected_at").notNull(),        // ISO date
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  confidence: real("confidence").default(0.5),      // 0-1
});

// ============================================================================
// Parcels — parcel-level candidates within hot counties
// ============================================================================
export const parcels = sqliteTable("parcels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countyFips: text("county_fips").notNull(),
  apn: text("apn"),                                 // Assessor parcel number
  acres: real("acres").notNull(),
  ownerName: text("owner_name"),
  ownerIsShellLlc: integer("owner_is_shell_llc", { mode: "boolean" }).default(false),
  resolvedOperator: text("resolved_operator"),      // Cross-referenced hyperscaler
  substationDistanceMi: real("substation_distance_mi"),
  fiberDistanceMi: real("fiber_distance_mi"),
  zoning: text("zoning"),
  landPrice: real("land_price"),
  lastTransferDate: text("last_transfer_date"),
  parcelScore: real("parcel_score").default(0),     // 0-100
  status: text("status").default("watch"),          // watch | assembling | rezoning | announced
});

// ============================================================================
// Watchlist — user-tracked counties (persistent, with notes)
// ============================================================================
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countyFips: text("county_fips").notNull().unique(),
  addedAt: text("added_at").notNull(),
  note: text("note"),
  priority: text("priority").default("normal"), // low | normal | high
});

// ============================================================================
// Alert subscriptions — user-defined trigger rules
// ============================================================================
export const alertSubscriptions = sqliteTable("alert_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  scope: text("scope").notNull(),                  // county | tier | global
  scopeValue: text("scope_value"),                  // FIPS code, tier name, or null for global
  triggerType: text("trigger_type").notNull(),      // score_crosses | signal_burst | moratorium_change | new_operator | tier_upgrade
  thresholdNumeric: real("threshold_numeric"),      // e.g., score threshold, signal count
  thresholdWindow: integer("threshold_window"),     // days for signal burst
  createdAt: text("created_at").notNull(),
  active: integer("active", { mode: "boolean" }).default(true),
});

// ============================================================================
// Alerts — fired instances of subscriptions
// ============================================================================
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subscriptionId: integer("subscription_id").notNull(),
  countyFips: text("county_fips").notNull(),
  firedAt: text("fired_at").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  severity: text("severity").default("info"),       // info | warning | critical
  acknowledged: integer("acknowledged", { mode: "boolean" }).default(false),
});

// ============================================================================
// Score history — monthly snapshot of landing probability per county
// ============================================================================
export const scoreHistory = sqliteTable("score_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  countyFips: text("county_fips").notNull(),
  month: text("month").notNull(),                    // YYYY-MM
  score: real("score").notNull(),                     // 0-100 landing probability
});

// ============================================================================
// Raw ingest staging tables — one row per fetched fact, source-linked
// ============================================================================
export const rawEiaGenerators = sqliteTable("raw_eia_generators", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plantCode: text("plant_code").notNull(),
  plantName: text("plant_name"),
  state: text("state").notNull(),
  countyName: text("county_name").notNull(),
  fips: text("fips"),                     // Joined post-fetch
  generatorId: text("generator_id"),
  status: text("status"),                 // OP=operating, TS=test, SB=standby, ...
  nameplateMw: real("nameplate_mw"),
  energySource: text("energy_source"),    // NG, SUB, WND, SUN, ...
  operatingYear: integer("operating_year"),
  fetchedAt: text("fetched_at").notNull(),
  sourceUrl: text("source_url").notNull(),
});

export const rawHifldTransmission = sqliteTable("raw_hifld_transmission", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fips: text("fips").notNull(),
  linesCount: integer("lines_count").notNull(),           // Total lines intersecting county envelope
  hvLinesCount: integer("hv_lines_count").notNull(),      // >=230kV
  ehvLinesCount: integer("ehv_lines_count").notNull(),    // >=345kV
  maxVoltage: integer("max_voltage"),
  owners: text("owners"),                                  // JSON array of owner strings
  fetchedAt: text("fetched_at").notNull(),
  sourceUrl: text("source_url").notNull(),
});

export const rawEdgarFilings = sqliteTable("raw_edgar_filings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accessionNo: text("accession_no").notNull().unique(),
  cik: text("cik").notNull(),
  company: text("company").notNull(),
  formType: text("form_type").notNull(),
  filedDate: text("filed_date").notNull(),
  matchedQuery: text("matched_query").notNull(),         // "data center campus" | "hyperscale" | ...
  snippet: text("snippet"),
  filingUrl: text("filing_url").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

export const rawDcNews = sqliteTable("raw_dc_news", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  guid: text("guid").notNull().unique(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  publishedAt: text("published_at").notNull(),
  source: text("source").notNull(),                       // "Data Center Dynamics" | "Data Center Frontier"
  summary: text("summary"),
  mentionedStates: text("mentioned_states"),              // JSON array e.g. ["VA","TX"]
  mentionedCounties: text("mentioned_counties"),          // JSON array of FIPS
  category: text("category"),                             // announcement | rumor | permit | opposition | expansion
  fetchedAt: text("fetched_at").notNull(),
});

export const rawIsoQueue = sqliteTable("raw_iso_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  iso: text("iso").notNull(),                             // PJM | ERCOT | MISO
  queueNo: text("queue_no").notNull(),
  projectName: text("project_name"),
  state: text("state"),
  county: text("county"),
  fips: text("fips"),
  mw: real("mw"),
  fuelType: text("fuel_type"),                            // Solar | Wind | Storage | Gas | Load | ...
  status: text("status"),
  submittedDate: text("submitted_date"),
  expectedInService: text("expected_in_service"),
  fetchedAt: text("fetched_at").notNull(),
  sourceUrl: text("source_url").notNull(),
});

// ============================================================================
// Data provenance — audit trail for every real value shown in the UI
// ============================================================================
export const dataProvenance = sqliteTable("data_provenance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fips: text("fips").notNull(),
  factorKey: text("factor_key").notNull(),                // e.g. "existingDcCapacityMw" | "transmissionDensity"
  quality: text("quality").notNull(),                     // real | partial | synthetic
  sourceName: text("source_name").notNull(),              // "EIA-860 (2024)" | "HIFLD Electric Transmission"
  sourceUrl: text("source_url").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  rawValue: text("raw_value"),                            // Serialized original value for audit
  note: text("note"),
});

export type RawEiaGenerator = typeof rawEiaGenerators.$inferSelect;
export type RawHifldTransmission = typeof rawHifldTransmission.$inferSelect;
export type RawEdgarFiling = typeof rawEdgarFilings.$inferSelect;
export type RawDcNews = typeof rawDcNews.$inferSelect;
export type RawIsoQueue = typeof rawIsoQueue.$inferSelect;
export type DataProvenance = typeof dataProvenance.$inferSelect;

export type DataQuality = "real" | "partial" | "synthetic";

// ============================================================================
// Operators — hyperscaler / shell LLC resolution registry
// ============================================================================
export const operators = sqliteTable("operators", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),                     // "Meta"
  shellLlcs: text("shell_llcs").notNull(),          // JSON array of known LLCs
  codenames: text("codenames").notNull(),           // JSON array
  annualCapexBillions: real("annual_capex_billions"),
  activeMarkets: text("active_markets"),            // JSON array of state codes
});

// ============================================================================
// Zod insert schemas
// ============================================================================
export const insertCountySchema = createInsertSchema(counties).omit({ id: true });
export const insertSignalSchema = createInsertSchema(signals).omit({ id: true });
export const insertParcelSchema = createInsertSchema(parcels).omit({ id: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true, addedAt: true });
export const insertOperatorSchema = createInsertSchema(operators).omit({ id: true });
export const insertAlertSubscriptionSchema = createInsertSchema(alertSubscriptions).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, firedAt: true });

export type County = typeof counties.$inferSelect;
export type InsertCounty = z.infer<typeof insertCountySchema>;
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Parcel = typeof parcels.$inferSelect;
export type InsertParcel = z.infer<typeof insertParcelSchema>;
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Operator = typeof operators.$inferSelect;
export type InsertOperator = z.infer<typeof insertOperatorSchema>;
export type ScoreHistoryRow = typeof scoreHistory.$inferSelect;
export type AlertSubscription = typeof alertSubscriptions.$inferSelect;
export type InsertAlertSubscription = z.infer<typeof insertAlertSubscriptionSchema>;
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

// ============================================================================
// Trigger DTO — county with recent signal cluster
// ============================================================================
export type TriggerCounty = {
  fips: string;
  name: string;
  state: string;
  landingProbability: number;
  scoreTier: string;
  recentSignalCount: number;   // count of signals in the trigger window
  weightedSignalScore: number; // sum of (weight * confidence) for recent signals
  signalTypes: string[];       // unique signal types in window
  latestSignalDate: string;
};

// ============================================================================
// Score-breakdown DTO (computed on read, not stored)
// ============================================================================
export type ScoreFactor = {
  key: string;
  label: string;
  weight: number;
  value: number;   // 0-100 factor score
  contribution: number; // weight * value
};

export type CountyDetail = County & {
  factors: ScoreFactor[];
  signals: Signal[];
  parcels: Parcel[];
};
