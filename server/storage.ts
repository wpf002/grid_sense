import {
  counties, signals, parcels, watchlist, operators, scoreHistory,
  alertSubscriptions, alerts,
} from '@shared/schema';
import type {
  County, InsertCounty, Signal, InsertSignal, Parcel, InsertParcel,
  Watchlist, InsertWatchlist, Operator, InsertOperator, CountyDetail,
  ScoreHistoryRow, TriggerCounty,
  AlertSubscription, InsertAlertSubscription, Alert,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, sql, and, gte, asc } from "drizzle-orm";
import { computeCountyFactors, computeLandingProbability, scoreTierFor } from "./scoring";
import { SEED_COUNTIES, SEED_SIGNALS, SEED_PARCELS, SEED_OPERATORS } from "./seed-data";

export const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// ---- Schema bootstrap (dev-only auto-migrate) ----
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS counties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fips TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, state TEXT NOT NULL,
    lat REAL NOT NULL, lng REAL NOT NULL,
    iso TEXT, utility TEXT,
    queued_load_mw REAL DEFAULT 0,
    substation_headroom_mva REAL,
    time_to_power_months REAL,
    onsite_generation_friendly INTEGER DEFAULT 0,
    fiber_density_score REAL DEFAULT 0,
    peering_exchange_count INTEGER DEFAULT 0,
    large_parcel_count INTEGER DEFAULT 0,
    median_land_price_per_acre REAL,
    floodplain_pct_block REAL DEFAULT 0,
    hazard_score REAL DEFAULT 0,
    water_stress_score REAL DEFAULT 0,
    cooling_degree_days REAL,
    heating_degree_days REAL,
    cooling_score REAL,
    carbon_intensity_score REAL,
    gas_access_score REAL,
    tax_incentive_score REAL DEFAULT 0,
    moratorium_status TEXT DEFAULT 'none',
    right_to_build_zoning INTEGER DEFAULT 0,
    existing_dc_count INTEGER DEFAULT 0,
    existing_dc_capacity_mw REAL DEFAULT 0,
    landing_probability REAL DEFAULT 0,
    score_tier TEXT DEFAULT 'cold',
    updated_at TEXT DEFAULT '2026-07-04'
  );
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    county_fips TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    weight REAL NOT NULL,
    lead_time_months REAL,
    headline TEXT NOT NULL,
    detail TEXT,
    suspected_operator TEXT,
    shell_llc TEXT,
    parcel_acres REAL,
    detected_at TEXT NOT NULL,
    source_url TEXT,
    source_name TEXT,
    confidence REAL DEFAULT 0.5
  );
  CREATE TABLE IF NOT EXISTS parcels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    county_fips TEXT NOT NULL,
    apn TEXT,
    acres REAL NOT NULL,
    owner_name TEXT,
    owner_is_shell_llc INTEGER DEFAULT 0,
    resolved_operator TEXT,
    substation_distance_mi REAL,
    fiber_distance_mi REAL,
    zoning TEXT,
    land_price REAL,
    last_transfer_date TEXT,
    parcel_score REAL DEFAULT 0,
    status TEXT DEFAULT 'watch'
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    county_fips TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL,
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    shell_llcs TEXT NOT NULL,
    codenames TEXT NOT NULL,
    annual_capex_billions REAL,
    active_markets TEXT
  );
  CREATE TABLE IF NOT EXISTS score_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    county_fips TEXT NOT NULL,
    month TEXT NOT NULL,
    score REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_score_history_fips_month
    ON score_history(county_fips, month);

  CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_value TEXT,
    trigger_type TEXT NOT NULL,
    threshold_numeric REAL,
    threshold_window INTEGER,
    created_at TEXT NOT NULL,
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    county_fips TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    severity TEXT DEFAULT 'info',
    acknowledged INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_fired ON alerts(fired_at DESC);

  CREATE TABLE IF NOT EXISTS raw_eia_generators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_code TEXT NOT NULL,
    plant_name TEXT,
    state TEXT NOT NULL,
    county_name TEXT NOT NULL,
    fips TEXT,
    generator_id TEXT,
    status TEXT,
    nameplate_mw REAL,
    energy_source TEXT,
    operating_year INTEGER,
    fetched_at TEXT NOT NULL,
    source_url TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_raw_eia_fips ON raw_eia_generators(fips);
  CREATE INDEX IF NOT EXISTS idx_raw_eia_state ON raw_eia_generators(state);

  CREATE TABLE IF NOT EXISTS raw_hifld_transmission (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fips TEXT NOT NULL,
    lines_count INTEGER NOT NULL,
    hv_lines_count INTEGER NOT NULL,
    ehv_lines_count INTEGER NOT NULL,
    max_voltage INTEGER,
    owners TEXT,
    fetched_at TEXT NOT NULL,
    source_url TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_raw_hifld_fips ON raw_hifld_transmission(fips);

  CREATE TABLE IF NOT EXISTS raw_edgar_filings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accession_no TEXT NOT NULL UNIQUE,
    cik TEXT NOT NULL,
    company TEXT NOT NULL,
    form_type TEXT NOT NULL,
    filed_date TEXT NOT NULL,
    matched_query TEXT NOT NULL,
    snippet TEXT,
    filing_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_raw_edgar_filed ON raw_edgar_filings(filed_date DESC);

  CREATE TABLE IF NOT EXISTS raw_dc_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    published_at TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT,
    mentioned_states TEXT,
    mentioned_counties TEXT,
    category TEXT,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_raw_dc_news_pub ON raw_dc_news(published_at DESC);

  CREATE TABLE IF NOT EXISTS raw_iso_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    iso TEXT NOT NULL,
    queue_no TEXT NOT NULL,
    project_name TEXT,
    state TEXT,
    county TEXT,
    fips TEXT,
    mw REAL,
    fuel_type TEXT,
    status TEXT,
    submitted_date TEXT,
    expected_in_service TEXT,
    fetched_at TEXT NOT NULL,
    source_url TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_raw_iso_queue_fips ON raw_iso_queue(fips);

  CREATE TABLE IF NOT EXISTS raw_fema_nri (
    fips TEXT PRIMARY KEY,
    county TEXT,
    state TEXT,
    riskScore REAL,
    riskRating TEXT,
    ealScore REAL,
    ealRating TEXT,
    fetchedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL, -- running, ok, error
    rows INTEGER,
    error TEXT,
    note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ingestion_runs_pipe ON ingestion_runs(pipeline, started_at DESC);

  CREATE TABLE IF NOT EXISTS data_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fips TEXT NOT NULL,
    factor_key TEXT NOT NULL,
    quality TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    raw_value TEXT,
    note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_prov_fips_key ON data_provenance(fips, factor_key);
`);

// Add priority column if watchlist existed without it (dev-only migration)
try { sqlite.exec("ALTER TABLE watchlist ADD COLUMN priority TEXT DEFAULT 'normal';"); } catch {}
// Climate/cooling columns (added after v1 — ALTER for existing DBs).
try { sqlite.exec("ALTER TABLE counties ADD COLUMN base_score REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN signal_boost REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN cooling_degree_days REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN heating_degree_days REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN cooling_score REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN carbon_intensity_score REAL;"); } catch {}
try { sqlite.exec("ALTER TABLE counties ADD COLUMN gas_access_score REAL;"); } catch {}

// ---- Seed on empty DB ----
function seedIfEmpty() {
  const countyCount = sqlite.prepare("SELECT COUNT(*) as c FROM counties").get() as { c: number };
  if (countyCount.c > 0) return;

  db.insert(operators).values(SEED_OPERATORS).run();
  db.insert(counties).values(SEED_COUNTIES).run();
  db.insert(signals).values(SEED_SIGNALS).run();
  db.insert(parcels).values(SEED_PARCELS).run();

  // Compute and persist landing probability + tier for each county
  const allCounties = db.select().from(counties).all();
  const allSignals = db.select().from(signals).all();
  for (const c of allCounties) {
    const s = allSignals.filter(x => x.countyFips === c.fips);
    const p = computeLandingProbability(c, s);
    const tier = scoreTierFor(p);
    db.update(counties).set({ landingProbability: p, scoreTier: tier }).where(eq(counties.id, c.id)).run();
  }
  // Seed synthetic 12-month score history: interpolate a plausible trajectory
  // ending at the current landing probability, with tier-based volatility.
  seedScoreHistory();
}

function seedScoreHistory() {
  const existing = sqlite.prepare("SELECT COUNT(*) as c FROM score_history").get() as { c: number };
  if (existing.c > 0) return;

  const all = db.select().from(counties).all();
  // Anchor month: 2026-07 = current, go back 11 months to 2025-08
  const months: string[] = [];
  const endYear = 2026, endMonth = 7;
  for (let i = 11; i >= 0; i--) {
    const totalMonths = endYear * 12 + (endMonth - 1) - i;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }

  const rows: { countyFips: string; month: string; score: number }[] = [];
  for (const c of all) {
    const final = c.landingProbability ?? 0;
    // Tier-based trajectory: hot counties rose, cold stayed flat, warm/emerging trended up
    let deltaTotal: number;
    switch (c.scoreTier) {
      case "hot":      deltaTotal = -14 - Math.random() * 8; break;  // started 14-22 pts lower
      case "warm":     deltaTotal = -9 - Math.random() * 6; break;
      case "emerging": deltaTotal = -6 - Math.random() * 5; break;
      default:         deltaTotal = -2 - Math.random() * 4; break;
    }
    const start = Math.max(15, final + deltaTotal);
    for (let idx = 0; idx < months.length; idx++) {
      const t = idx / (months.length - 1); // 0..1
      // Slightly S-curve interpolation with jitter
      const smooth = t * t * (3 - 2 * t);
      const jitter = (Math.random() - 0.5) * 3.2;
      const s = start + (final - start) * smooth + jitter;
      rows.push({ countyFips: c.fips, month: months[idx], score: Math.max(0, Math.min(100, s)) });
    }
    // Ensure the final month is exactly current probability
    rows[rows.length - 1].score = final;
  }
  // Batch insert
  db.insert(scoreHistory).values(rows).run();
}
seedIfEmpty();

export interface IStorage {
  listCounties(): Promise<County[]>;
  getCounty(fips: string): Promise<CountyDetail | undefined>;
  listSignals(limit?: number): Promise<Signal[]>;
  listSignalsForCounty(fips: string): Promise<Signal[]>;
  listOperators(): Promise<Operator[]>;
  getWatchlist(): Promise<Watchlist[]>;
  addToWatchlist(input: InsertWatchlist): Promise<Watchlist>;
  removeFromWatchlist(fips: string): Promise<{ removed: number }>;
  overallStats(): Promise<{
    totalCounties: number; hot: number; warm: number; emerging: number; cold: number;
    totalSignals: number; totalQueuedMw: number;
  }>;
  getScoreHistory(fips: string): Promise<ScoreHistoryRow[]>;
  getTriggers(minCount: number, windowDays: number): Promise<TriggerCounty[]>;
  updateWatchlistNote(fips: string, note: string, priority?: string): Promise<Watchlist | undefined>;
  isOnWatchlist(fips: string): Promise<boolean>;
  listAlertSubscriptions(): Promise<AlertSubscription[]>;
  createAlertSubscription(input: InsertAlertSubscription): Promise<AlertSubscription>;
  deleteAlertSubscription(id: number): Promise<{ removed: number }>;
  toggleAlertSubscription(id: number, active: boolean): Promise<AlertSubscription | undefined>;
  listAlerts(limit?: number): Promise<Alert[]>;
  countUnacknowledgedAlerts(): Promise<number>;
  acknowledgeAlert(id: number): Promise<{ updated: number }>;
  acknowledgeAllAlerts(): Promise<{ updated: number }>;
  evaluateSubscriptions(): Promise<{ fired: number }>;
}

export class DatabaseStorage implements IStorage {
  async listCounties(): Promise<County[]> {
    return db.select().from(counties).orderBy(desc(counties.landingProbability)).all();
  }

  async getCounty(fips: string): Promise<CountyDetail | undefined> {
    const c = db.select().from(counties).where(eq(counties.fips, fips)).get();
    if (!c) return undefined;
    const sigs = db.select().from(signals).where(eq(signals.countyFips, fips))
      .orderBy(desc(signals.detectedAt)).all();
    const pcs = db.select().from(parcels).where(eq(parcels.countyFips, fips))
      .orderBy(desc(parcels.parcelScore)).all();
    const factors = computeCountyFactors(c);
    return { ...c, factors, signals: sigs, parcels: pcs };
  }

  async listSignals(limit = 50): Promise<Signal[]> {
    // Dedupe by headline. A single article can be attached to more than one
    // county at ingest, so the feed must collapse to distinct stories (keeping
    // the most recent copy) instead of showing the same headline repeatedly.
    const rows = db.select().from(signals)
      .orderBy(desc(signals.detectedAt), desc(signals.id)).all();
    const seen = new Set<string>();
    const out: Signal[] = [];
    for (const r of rows) {
      const key = (r.headline ?? "").trim().toLowerCase() || `id:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  async listSignalsForCounty(fips: string): Promise<Signal[]> {
    return db.select().from(signals).where(eq(signals.countyFips, fips))
      .orderBy(desc(signals.detectedAt)).all();
  }

  async listOperators(): Promise<Operator[]> {
    return db.select().from(operators).all();
  }

  async getWatchlist(): Promise<Watchlist[]> {
    return db.select().from(watchlist).orderBy(desc(watchlist.addedAt)).all();
  }

  async addToWatchlist(input: InsertWatchlist): Promise<Watchlist> {
    const now = new Date().toISOString();
    // upsert-lite
    const existing = db.select().from(watchlist)
      .where(eq(watchlist.countyFips, input.countyFips)).get();
    if (existing) return existing;
    return db.insert(watchlist).values({ ...input, addedAt: now }).returning().get();
  }

  async removeFromWatchlist(fips: string): Promise<{ removed: number }> {
    const r = db.delete(watchlist).where(eq(watchlist.countyFips, fips)).run();
    return { removed: r.changes };
  }

  async updateWatchlistNote(fips: string, note: string, priority?: string): Promise<Watchlist | undefined> {
    const patch: Partial<Watchlist> = { note };
    if (priority) patch.priority = priority;
    const r = db.update(watchlist).set(patch).where(eq(watchlist.countyFips, fips)).returning().get();
    return r;
  }

  async isOnWatchlist(fips: string): Promise<boolean> {
    const r = db.select().from(watchlist).where(eq(watchlist.countyFips, fips)).get();
    return !!r;
  }

  // ---- Alert subscriptions ----
  async listAlertSubscriptions(): Promise<AlertSubscription[]> {
    return db.select().from(alertSubscriptions).orderBy(desc(alertSubscriptions.createdAt)).all();
  }

  async createAlertSubscription(input: InsertAlertSubscription): Promise<AlertSubscription> {
    const now = new Date().toISOString();
    const row = db.insert(alertSubscriptions).values({ ...input, createdAt: now }).returning().get();
    // Immediately evaluate to seed initial alerts if any current state already matches
    await this.evaluateSubscriptions();
    return row;
  }

  async deleteAlertSubscription(id: number): Promise<{ removed: number }> {
    const r = db.delete(alertSubscriptions).where(eq(alertSubscriptions.id, id)).run();
    // cascade delete related alerts
    db.delete(alerts).where(eq(alerts.subscriptionId, id)).run();
    return { removed: r.changes };
  }

  async toggleAlertSubscription(id: number, active: boolean): Promise<AlertSubscription | undefined> {
    return db.update(alertSubscriptions).set({ active }).where(eq(alertSubscriptions.id, id)).returning().get();
  }

  async listAlerts(limit = 100): Promise<Alert[]> {
    return db.select().from(alerts).orderBy(desc(alerts.firedAt)).limit(limit).all();
  }

  async countUnacknowledgedAlerts(): Promise<number> {
    const r = sqlite.prepare("SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0").get() as { c: number };
    return r.c;
  }

  async acknowledgeAlert(id: number): Promise<{ updated: number }> {
    const r = db.update(alerts).set({ acknowledged: true }).where(eq(alerts.id, id)).run();
    return { updated: r.changes };
  }

  async acknowledgeAllAlerts(): Promise<{ updated: number }> {
    const r = db.update(alerts).set({ acknowledged: true }).where(eq(alerts.acknowledged, false)).run();
    return { updated: r.changes };
  }

  // Rule engine: for each active subscription, decide if it should have a fresh alert.
  // De-dupes by title+countyFips+subscriptionId (no duplicate identical alerts).
  async evaluateSubscriptions(): Promise<{ fired: number }> {
    const subs = db.select().from(alertSubscriptions).where(eq(alertSubscriptions.active, true)).all();
    if (subs.length === 0) return { fired: 0 };

    const allCounties = db.select().from(counties).all();
    const countyByFips = new Map(allCounties.map(c => [c.fips, c]));
    let fired = 0;

    const emit = (subId: number, fips: string, title: string, detail: string, severity: string) => {
      const dup = sqlite.prepare(
        "SELECT id FROM alerts WHERE subscription_id = ? AND county_fips = ? AND title = ?"
      ).get(subId, fips, title);
      if (dup) return;
      db.insert(alerts).values({
        subscriptionId: subId,
        countyFips: fips,
        firedAt: new Date().toISOString(),
        title, detail, severity,
        acknowledged: false,
      }).run();
      fired++;
    };

    for (const sub of subs) {
      // Scope: county | tier | global
      let targets: County[];
      if (sub.scope === "county" && sub.scopeValue) {
        const c = countyByFips.get(sub.scopeValue);
        targets = c ? [c] : [];
      } else if (sub.scope === "tier" && sub.scopeValue) {
        targets = allCounties.filter(c => c.scoreTier === sub.scopeValue);
      } else {
        targets = allCounties;
      }

      for (const c of targets) {
        switch (sub.triggerType) {
          case "score_crosses": {
            const t = sub.thresholdNumeric ?? 75;
            if ((c.landingProbability ?? 0) >= t) {
              emit(sub.id, c.fips,
                `${c.name}, ${c.state} ≥ ${t.toFixed(0)} landing probability`,
                `Landing probability now ${(c.landingProbability ?? 0).toFixed(1)}, threshold ${t.toFixed(0)}.`,
                t >= 80 ? "critical" : "warning");
            }
            break;
          }
          case "signal_burst": {
            const minCount = Math.round(sub.thresholdNumeric ?? 3);
            const windowDays = sub.thresholdWindow ?? 90;
            const now = new Date("2026-07-04T00:00:00Z");
            const cutoff = new Date(now.getTime() - windowDays * 86400_000).toISOString().slice(0, 10);
            const cnt = sqlite.prepare(
              "SELECT COUNT(*) as c FROM signals WHERE county_fips = ? AND detected_at >= ?"
            ).get(c.fips, cutoff) as { c: number };
            if (cnt.c >= minCount) {
              emit(sub.id, c.fips,
                `${c.name}, ${c.state}: ${cnt.c} signals in ${windowDays}d`,
                `Signal burst detected. Threshold ${minCount} in ${windowDays} days.`,
                cnt.c >= minCount + 2 ? "critical" : "warning");
            }
            break;
          }
          case "moratorium_change": {
            if (c.moratoriumStatus && c.moratoriumStatus !== "none") {
              emit(sub.id, c.fips,
                `${c.name}, ${c.state}: moratorium ${c.moratoriumStatus}`,
                `Zoning risk flagged. Status: ${c.moratoriumStatus}.`,
                c.moratoriumStatus === "active" ? "critical" : "warning");
            }
            break;
          }
          case "new_operator": {
            const withOp = sqlite.prepare(
              "SELECT COUNT(*) as c FROM signals WHERE county_fips = ? AND suspected_operator IS NOT NULL AND suspected_operator != 'unknown'"
            ).get(c.fips) as { c: number };
            if (withOp.c > 0) {
              const ops = sqlite.prepare(
                "SELECT DISTINCT suspected_operator FROM signals WHERE county_fips = ? AND suspected_operator IS NOT NULL AND suspected_operator != 'unknown'"
              ).all(c.fips) as { suspected_operator: string }[];
              const opList = ops.map(o => o.suspected_operator).join(", ");
              emit(sub.id, c.fips,
                `${c.name}, ${c.state}: operator activity (${opList})`,
                `Identified operators tied to signals in this county.`,
                "info");
            }
            break;
          }
          case "tier_upgrade": {
            const targetTier = sub.scopeValue ?? "hot";
            if (c.scoreTier === targetTier) {
              emit(sub.id, c.fips,
                `${c.name}, ${c.state} entered ${targetTier} tier`,
                `Current landing probability: ${(c.landingProbability ?? 0).toFixed(1)}.`,
                targetTier === "hot" ? "critical" : "warning");
            }
            break;
          }
        }
      }
    }
    return { fired };
  }

  async getScoreHistory(fips: string): Promise<ScoreHistoryRow[]> {
    return db.select().from(scoreHistory)
      .where(eq(scoreHistory.countyFips, fips))
      .orderBy(asc(scoreHistory.month))
      .all();
  }

  async getTriggers(minCount = 3, windowDays = 90): Promise<TriggerCounty[]> {
    // "Now" reference: 2026-07-04 (matches seed data horizon). Anything within windowDays counts.
    const now = new Date("2026-07-04T00:00:00Z");
    const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    const recentSignals = db.select().from(signals)
      .where(gte(signals.detectedAt, cutoffIso))
      .all();

    // Aggregate per county
    const byCounty = new Map<string, {
      count: number; weighted: number; types: Set<string>; latest: string;
    }>();
    for (const s of recentSignals) {
      const g = byCounty.get(s.countyFips) ?? { count: 0, weighted: 0, types: new Set<string>(), latest: "" };
      g.count += 1;
      g.weighted += (s.weight ?? 0) * (s.confidence ?? 0.5);
      g.types.add(s.signalType);
      if (s.detectedAt > g.latest) g.latest = s.detectedAt;
      byCounty.set(s.countyFips, g);
    }

    const clusters = Array.from(byCounty.entries()).filter(([, v]) => v.count >= minCount);
    if (clusters.length === 0) return [];

    const fipsList = clusters.map(([f]) => f);
    const cs = db.select().from(counties)
      .where(sql`${counties.fips} IN (${sql.join(fipsList.map(f => sql`${f}`), sql`, `)})`)
      .all();
    const cMap = new Map(cs.map(c => [c.fips, c]));

    const result: TriggerCounty[] = clusters
      .map(([fips, v]) => {
        const c = cMap.get(fips);
        if (!c) return null;
        return {
          fips,
          name: c.name,
          state: c.state,
          landingProbability: c.landingProbability ?? 0,
          scoreTier: c.scoreTier ?? "cold",
          recentSignalCount: v.count,
          weightedSignalScore: Math.round(v.weighted * 100) / 100,
          signalTypes: Array.from(v.types).sort(),
          latestSignalDate: v.latest,
        };
      })
      .filter((x): x is TriggerCounty => x !== null)
      .sort((a, b) => b.weightedSignalScore - a.weightedSignalScore);

    return result;
  }

  async overallStats() {
    const all = await this.listCounties();
    const totalSigs = sqlite.prepare("SELECT COUNT(*) as c FROM signals").get() as { c: number };
    const totalMw = sqlite.prepare("SELECT SUM(queued_load_mw) as m FROM counties").get() as { m: number };
    return {
      totalCounties: all.length,
      hot: all.filter(c => c.scoreTier === "hot").length,
      warm: all.filter(c => c.scoreTier === "warm").length,
      emerging: all.filter(c => c.scoreTier === "emerging").length,
      cold: all.filter(c => c.scoreTier === "cold").length,
      totalSignals: totalSigs.c,
      totalQueuedMw: Math.round(totalMw.m ?? 0),
    };
  }
}

export const storage = new DatabaseStorage();
