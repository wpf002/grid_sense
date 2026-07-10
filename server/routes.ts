import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import path from "node:path";
import fs from "node:fs";
import { storage, db, sqlite } from "./storage";
import { insertWatchlistSchema, insertAlertSubscriptionSchema, dataProvenance, rawEiaGenerators, rawHifldTransmission, rawEdgarFilings, rawDcNews, rawIsoQueue } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { registerExportRoutes } from "./exports";
import { registerAuth } from "./auth";
import { computeCountyFactorsV5, scoreTierFor } from "./scoring";
import { buildOverlayFor, warmOverlayCaches } from "./ingest/overlay";
import { attributeFiling, type OperatorDict } from "./edgar-attribution";
import { computePowerHeadroom } from "./headroom";
import { requireAuth } from "./auth";
import { createApiKey, listApiKeys, revokeApiKey, type Plan } from "./apikeys";

// Load operator shell-LLC / codename dictionaries (JSON-text columns → arrays).
// Cached for the process; operators change rarely (monthly ingest).
let _operatorDicts: OperatorDict[] | null = null;
function loadOperatorDicts(): OperatorDict[] {
  if (_operatorDicts) return _operatorDicts;
  const rows = sqlite
    .prepare("SELECT name, shell_llcs, codenames FROM operators")
    .all() as Array<{ name: string; shell_llcs: string | null; codenames: string | null }>;
  const parse = (s: string | null): string[] => {
    try {
      const v = JSON.parse(s || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  _operatorDicts = rows.map((r) => ({
    name: r.name,
    shellLlcs: parse(r.shell_llcs),
    codenames: parse(r.codenames),
  }));
  return _operatorDicts;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/stats", async (_req, res) => {
    const stats = await storage.overallStats();
    res.json(stats);
  });

  // ---- Live counts for the public landing page (no hardcoded marketing numbers) ----
  app.get("/api/landing-stats", async (_req, res) => {
    try {
      const n = (sql: string) => ((sqlite.prepare(sql).get() as any)?.n ?? 0) as number;
      res.json({
        counties: n("SELECT COUNT(*) n FROM counties"),
        emergingPlus: n("SELECT COUNT(*) n FROM counties WHERE landing_probability >= 45"),
        parcels: n("SELECT COUNT(*) n FROM parcels"),
        parcelCounties: n("SELECT COUNT(DISTINCT county_fips) n FROM parcels"),
        permits: n("SELECT COUNT(*) n FROM permits"),
        competitiveBids: n("SELECT COUNT(*) n FROM competitive_bids"),
        operators: n("SELECT COUNT(*) n FROM operators"),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "landing stats failed" });
    }
  });

  // ---- Point-in-time backtest ----
  // Scores each announced county using only a snapshot taken BEFORE the
  // announcement, so post-announcement news can't inflate the result. Returns a
  // not-ready report until score history reaches back past a real announcement;
  // that is a valid state, not an error.
  app.get("/api/backtest/point-in-time", async (_req, res) => {
    try {
      const { runBothBases, historyOutlook } = await import("./eval/run.js");
      const bases = runBothBases();
      const outlook = historyOutlook();
      // The evaluated/uncovered arrays can be long; the UI only needs summaries.
      const slim = (r: (typeof bases)["total"]) => ({
        basis: r.basis,
        ready: r.ready,
        notReady: r.notReady,
        coverage: r.coverage,
        evaluatedCount: r.evaluated.length,
        totalAnnouncements: r.totalAnnouncements,
        earliestSnapshot: r.earliestSnapshot,
        latestSnapshot: r.latestSnapshot,
        metrics: r.metrics,
      });
      res.json({
        total: slim(bases.total),
        factorsOnly: slim(bases.factorsOnly),
        outlook,
        uncoveredReasons: bases.total.uncovered.reduce<Record<string, number>>((acc, u) => {
          acc[u.reason] = (acc[u.reason] ?? 0) + 1;
          return acc;
        }, {}),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "point-in-time backtest failed" });
    }
  });

  // ---- Ranking quality, with and without the signal boost ----
  // The signal boost is heavily concentrated in announced counties (news about an
  // announcement lands in that county), so the boosted number is optimistic.
  // Report both, plus the leakage magnitude, rather than only the flattering one.
  app.get("/api/backtest/rank-quality", async (_req, res) => {
    try {
      const rows = sqlite.prepare(
        "SELECT fips, landing_probability AS total, base_score AS base, COALESCE(signal_boost,0) AS boost FROM counties WHERE landing_probability IS NOT NULL AND base_score IS NOT NULL",
      ).all() as { fips: string; total: number; base: number; boost: number }[];
      if (rows.length < 2) return res.json({ available: false, note: "base_score not yet computed — run enrich" });

      const positives = new Set(
        (sqlite.prepare("SELECT DISTINCT fips FROM dc_announcements").all() as { fips: string }[]).map((r) => r.fips),
      );
      const pos = rows.filter((r) => positives.has(r.fips));

      const meanPct = (key: "total" | "base") => {
        const sorted = [...rows].sort((a, b) => a[key] - b[key]);
        const rank = new Map(sorted.map((r, i) => [r.fips, (i / (sorted.length - 1)) * 100]));
        return pos.reduce((s, r) => s + rank.get(r.fips)!, 0) / pos.length;
      };
      const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

      res.json({
        available: true,
        totalCounties: rows.length,
        positives: pos.length,
        meanPercentileWithSignals: meanPct("total"),
        meanPercentileFactorsOnly: meanPct("base"),
        meanBoostPositives: mean(pos.map((r) => r.boost)),
        meanBoostAllCounties: mean(rows.map((r) => r.boost)),
        positivesWithSignal: pos.filter((r) => r.boost > 0).length,
        note: "Scores are current, not point-in-time. Signal boost comes partly from news published AFTER an announcement, so 'with signals' is optimistic. 'Factors only' is the leakage-free ranking metric.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "rank-quality failed" });
    }
  });

  app.get("/api/counties", async (_req, res) => {
    const rows = await storage.listCounties();
    res.json(rows);
  });

  // Bulk export — filter by tier/state/iso, return CSV or JSON.
  app.get("/api/exports/counties", async (req, res) => {
    const format = (req.query.format as string) || "csv";
    const tier = req.query.tier as string | undefined;
    const state = req.query.state as string | undefined;
    const iso = req.query.iso as string | undefined;
    const minScore = req.query.min_score ? Number(req.query.min_score) : null;
    const clauses: string[] = [];
    const args: any[] = [];
    if (tier) { clauses.push("score_tier = ?"); args.push(tier); }
    if (state) { clauses.push("state = ?"); args.push(state); }
    if (iso) { clauses.push("iso = ?"); args.push(iso); }
    if (minScore != null) { clauses.push("landing_probability >= ?"); args.push(minScore); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = sqlite.prepare(
      `SELECT fips, name, state, iso, landing_probability, score_tier, queued_load_mw, hazard_score, water_stress_score, moratorium_status, time_to_power_months FROM counties ${where} ORDER BY landing_probability DESC NULLS LAST LIMIT 5000`
    ).all(...args) as any[];
    if (format === "json") {
      res.json({ count: rows.length, filters: { tier, state, iso, min_score: minScore }, rows });
      return;
    }
    const header = ["fips","name","state","iso","landing_probability","score_tier","queued_load_mw","hazard_score","water_stress_score","moratorium_status","time_to_power_months"];
    const esc = (v: any) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [header.join(","), ...rows.map(r => header.map(k => esc(r[k])).join(","))];
    res.setHeader("content-type", "text/csv");
    res.setHeader("content-disposition", `attachment; filename="gridsense-counties-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join("\n"));
  });

  // Provenance for every scored factor on a county (used by the popover).
  app.get("/api/counties/:fips/provenance", async (req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT factor_key, quality, source_name, source_url, fetched_at, note
        FROM data_provenance
        WHERE fips = ?
        ORDER BY factor_key
      `).all(req.params.fips);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Lightweight payload for the national map view.
  app.get("/api/counties/map", async (_req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT fips, name, state, lat, lng,
               landing_probability, score_tier,
               queued_load_mw, existing_dc_count, iso
        FROM counties
        ORDER BY landing_probability DESC
      `).all();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/counties/:fips", async (req, res) => {
    const c = await storage.getCounty(req.params.fips);
    if (!c) return res.status(404).json({ error: "County not found" });
    res.json(c);
  });

  app.get("/api/counties/:fips/history", async (req, res) => {
    const rows = await storage.getScoreHistory(req.params.fips);
    res.json(rows);
  });

  // ---- Retail utilities serving a county (EIA-861) ----
  app.get("/api/counties/:fips/utilities", async (req, res) => {
    try {
      const rows = sqlite.prepare(
        `SELECT utility_number, utility_name, vintage FROM utility_service_territory
         WHERE fips = ? ORDER BY utility_name ASC`
      ).all(req.params.fips) as any[];
      res.json({
        fips: req.params.fips,
        vintage: rows[0]?.vintage ?? null,
        utilities: rows.map((r) => ({ number: r.utility_number, name: r.utility_name })),
      });
    } catch {
      res.json({ fips: req.params.fips, vintage: null, utilities: [] });
    }
  });

  // ---- Shell LLC activity by county ----
  app.get("/api/counties/:fips/shell-activity", async (req, res) => {
    try {
      const row = sqlite.prepare(
        "SELECT fips, operators_json, llc_names_json, total_llc_count, updated_at FROM shell_llc_activity WHERE fips = ?"
      ).get(req.params.fips) as any;
      if (!row) return res.json({ fips: req.params.fips, operators: [], llcNames: [], totalLlcCount: 0 });
      res.json({
        fips: row.fips,
        operators: JSON.parse(row.operators_json || "[]"),
        llcNames: JSON.parse(row.llc_names_json || "[]"),
        totalLlcCount: row.total_llc_count,
        updatedAt: row.updated_at,
      });
    } catch (e: any) {
      // Table may not exist yet on fresh DB
      res.json({ fips: req.params.fips, operators: [], llcNames: [], totalLlcCount: 0 });
    }
  });

  // ---- Transmission aggregate for a county (HIFLD via NETL DOE) ----
  // Synthesized deliverable-power / time-to-power headroom for a county.
  app.get("/api/counties/:fips/power-headroom", async (req, res) => {
    const fips = req.params.fips;
    const c = sqlite.prepare(
      `SELECT substation_headroom_mva, time_to_power_months, queued_load_mw
       FROM counties WHERE fips = ?`,
    ).get(fips) as any;
    if (!c) return res.status(404).json({ error: "county not found" });
    const overlay = buildOverlayFor(fips);
    const headroom = computePowerHeadroom({
      substationHeadroomMva: c.substation_headroom_mva,
      timeToPowerMonths: c.time_to_power_months,
      queuedMw: overlay.queue?.queuedMw ?? c.queued_load_mw ?? 0,
      withdrawnMw: overlay.queue?.withdrawnMw ?? 0,
      maxVoltageKv: overlay.hifld?.maxVoltage ?? null,
      ehvKm: overlay.hifld?.ehvLinesCount ?? null,
      hvKm: overlay.hifld?.hvLinesCount ?? null,
      existingGenMw: overlay.eia?.totalMw ?? null,
      hasRealSubstation: c.substation_headroom_mva != null,
      hasRealTransmission: !!overlay.hifld,
      hasRealQueue: !!overlay.queue,
    });
    res.json({ fips, ...headroom });
  });

  app.get("/api/counties/:fips/transmission", async (req, res) => {
    try {
      const row = sqlite.prepare(
        `SELECT total_km, max_voltage_kv, km_lt_100, km_100_161, km_220_287,
                km_345, km_500, km_735_up, segment_count, updated_at
         FROM transmission_county_agg WHERE fips = ?`
      ).get(req.params.fips) as any;
      if (!row) {
        return res.json({ fips: req.params.fips, totalKm: 0, maxVoltageKv: null, segmentCount: 0, byClass: {} });
      }
      res.json({
        fips: req.params.fips,
        totalKm: row.total_km,
        maxVoltageKv: row.max_voltage_kv,
        segmentCount: row.segment_count,
        byClass: {
          "<100kV": row.km_lt_100,
          "100-161kV": row.km_100_161,
          "220-287kV": row.km_220_287,
          "345kV": row.km_345,
          "500kV": row.km_500,
          "735kV+": row.km_735_up,
        },
        updatedAt: row.updated_at,
      });
    } catch {
      res.json({ fips: req.params.fips, totalKm: 0, maxVoltageKv: null, segmentCount: 0, byClass: {} });
    }
  });

  // ---- Power price: real wholesale hub price + EIA state retail rate ----
  app.get("/api/counties/:fips/power-price", async (req, res) => {
    try {
      const county = sqlite.prepare("SELECT state, iso, lat FROM counties WHERE fips = ?").get(req.params.fips) as any;
      if (!county) return res.json({ fips: req.params.fips, price: null });

      // Real traded wholesale price for the hub that actually prices this county.
      // Null where no hub is published (SPP / NYISO / TVA / FRCC / Southeast).
      const { lookupWholesalePrice } = await import("./ingest/wholesale_price.js");
      const wholesale = lookupWholesalePrice(county.iso ?? null, county.state, county.lat ?? null);

      const row = sqlite.prepare(
        "SELECT industrial_cents_per_kwh, commercial_cents_per_kwh, period, industrial_yoy_pct FROM state_power_price WHERE state = ?"
      ).get(county.state) as any;
      const industrial = row?.industrial_cents_per_kwh ?? null;
      // convert ¢/kWh to $/MWh (¢ * 10)
      res.json({
        fips: req.params.fips,
        state: county.state,
        wholesale, // { region, hub, usdPerMwh, period, sourceUrl } | null
        period: row?.period ?? null,
        industrialCentsPerKwh: industrial,
        industrialDollarsPerMwh: industrial != null ? industrial * 10 : null,
        commercialCentsPerKwh: row?.commercial_cents_per_kwh ?? null,
        yoyPct: row?.industrial_yoy_pct ?? null,
      });
    } catch {
      res.json({ fips: req.params.fips, price: null });
    }
  });

  // ---- Comps: recent DC land deals for a county + neighboring benchmark (Gap 7) ----
  app.get("/api/counties/:fips/comps", async (req, res) => {
    try {
      const own = sqlite
        .prepare(`SELECT * FROM dc_comps WHERE fips = ? ORDER BY deal_date DESC`)
        .all(req.params.fips) as any[];
      const county = sqlite.prepare("SELECT state FROM counties WHERE fips = ?").get(req.params.fips) as any;
      const stateBenchmark = county
        ? (sqlite
            .prepare(`SELECT * FROM dc_comps WHERE state = ? AND fips != ? ORDER BY deal_date DESC LIMIT 20`)
            .all(county.state, req.params.fips) as any[])
        : [];
      const allInState = county
        ? (sqlite
            .prepare(`SELECT AVG(price_per_acre) AS avg_ppa, MIN(price_per_acre) AS min_ppa, MAX(price_per_acre) AS max_ppa, COUNT(*) AS n FROM dc_comps WHERE state = ?`)
            .get(county.state) as any)
        : null;
      res.json({ own, stateBenchmark, stateStats: allInState });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "comps failed" });
    }
  });

  // ---- OSM parcel/zoning inspector (Gaps 6 + 8, scaffolds Gap 15) ----
  app.get("/api/counties/:fips/parcels", async (req, res) => {
    try {
      const { inspectCounty } = await import("./ingest/osm_parcels.js");
      const forceRefresh = req.query.refresh === "1";
      const inspection = await inspectCounty(req.params.fips, forceRefresh);
      if (!inspection) return res.status(404).json({ error: "county not found or overpass failed" });
      res.json(inspection);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "parcels failed" });
    }
  });

  // ---- Water rights / adjudicated basins overlay (Gap 3) ----
  app.get("/api/counties/:fips/water-stress", async (req, res) => {
    try {
      const county = sqlite.prepare("SELECT state FROM counties WHERE fips = ?").get(req.params.fips) as any;
      if (!county) return res.json({ fips: req.params.fips, waterStress: null });
      const { waterStressForState } = await import("./ingest/water_stress.js");
      const ws = waterStressForState(county.state);
      res.json({ fips: req.params.fips, state: county.state, waterStress: ws });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "water-stress failed" });
    }
  });

  // ---- Backtest: DC announcements vs. GridSense score at time of announcement (Gap 13) ----
  app.get("/api/backtest/announcements", async (_req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT a.*, c.landing_probability AS score, c.score_tier AS tier, c.name AS current_name
        FROM dc_announcements a
        LEFT JOIN counties c ON c.fips = a.fips
        ORDER BY a.announced_date DESC
      `).all() as any[];
      // Bucket score-at-announcement using CURRENT score as a proxy (we don't have historical scores loaded).
      // Report both the raw score and a hit/miss classification.
      const enriched = rows.map((r) => {
        const scored = typeof r.score === "number";
        const hit = scored && r.score >= 70;
        const near = scored && r.score >= 55 && r.score < 70;
        return {
          ...r,
          scored,
          hit,
          near,
          miss: scored && r.score < 55,
          notTracked: !scored,
        };
      });
      const total = enriched.length;
      const hits = enriched.filter((r) => r.hit).length;
      const nears = enriched.filter((r) => r.near).length;
      const misses = enriched.filter((r) => r.miss).length;
      const notTracked = enriched.filter((r) => r.notTracked).length;
      res.json({
        rows: enriched,
        summary: {
          total,
          hits,
          nears,
          misses,
          not_tracked: notTracked,
          hit_rate: total > 0 ? hits / (total - notTracked || 1) : 0,
          hit_plus_near_rate: total > 0 ? (hits + nears) / (total - notTracked || 1) : 0,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "backtest failed" });
    }
  });

  // ---- ISO queue history (Gap 5: withdrawal / study status tracking) ----
  app.get("/api/counties/:fips/queue-history", async (req, res) => {
    try {
      const { queueHistoryForCounty } = await import("./ingest/iso_queue_history.js");
      const rows = queueHistoryForCounty(req.params.fips, 180);
      // Also compute a rollup across all ISOs per date, plus latest totals.
      type Roll = { active_mw: number; withdrawn_mw: number; active_projects: number; withdrawn_projects: number };
      const byDate = new Map<string, Roll>();
      for (const r of rows) {
        let a = byDate.get(r.snapshot_date);
        if (!a) { a = { active_mw: 0, withdrawn_mw: 0, active_projects: 0, withdrawn_projects: 0 }; byDate.set(r.snapshot_date, a); }
        a.active_mw += r.active_mw;
        a.withdrawn_mw += r.withdrawn_mw;
        a.active_projects += r.active_projects;
        a.withdrawn_projects += r.withdrawn_projects;
      }
      const timeline = Array.from(byDate.entries())
        .map(([snapshot_date, a]) => ({ snapshot_date, ...a }))
        .sort((x, y) => x.snapshot_date.localeCompare(y.snapshot_date));
      const latest = timeline[timeline.length - 1] ?? null;
      const withdrawalRatio = latest && latest.active_projects + latest.withdrawn_projects > 0
        ? latest.withdrawn_projects / (latest.active_projects + latest.withdrawn_projects)
        : null;
      res.json({
        fips: req.params.fips,
        rows,
        timeline,
        latest,
        withdrawalRatio,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "queue-history failed" });
    }
  });

  // ---- Transmission lines within a bbox (for map viewport) ----
  app.get("/api/transmission/lines", async (req, res) => {
    const b = String(req.query.bbox ?? "").split(",").map(Number);
    if (b.length !== 4 || b.some((n) => Number.isNaN(n))) {
      return res.status(400).json({ error: "bbox=minLng,minLat,maxLng,maxLat required" });
    }
    try {
      const { transmissionLinesInBbox } = await import("./ingest/hifld_transmission.js");
      const fc = await transmissionLinesInBbox({
        minLng: b[0], minLat: b[1], maxLng: b[2], maxLat: b[3],
      });
      res.json(fc);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "failed" });
    }
  });

  // ---- Data provenance ----
  app.get("/api/provenance/:fips", async (req, res) => {
    const rows = db.select().from(dataProvenance)
      .where(eq(dataProvenance.fips, req.params.fips))
      .all();
    res.json(rows);
  });

  app.get("/api/provenance/:fips/:factorKey", async (req, res) => {
    const row = db.select().from(dataProvenance)
      .where(sql`${dataProvenance.fips} = ${req.params.fips} AND ${dataProvenance.factorKey} = ${req.params.factorKey}`)
      .get();
    if (!row) return res.status(404).json({ error: "No provenance" });
    res.json(row);
  });

  // ---- Data-quality summary across the DB ----
  app.get("/api/data-quality", async (_req, res) => {
    const byQuality = db
      .select({
        quality: dataProvenance.quality,
        count: sql<number>`COUNT(*)`,
      })
      .from(dataProvenance)
      .groupBy(dataProvenance.quality)
      .all();
    const byFactor = db
      .select({
        factorKey: dataProvenance.factorKey,
        quality: dataProvenance.quality,
        count: sql<number>`COUNT(*)`,
      })
      .from(dataProvenance)
      .groupBy(dataProvenance.factorKey, dataProvenance.quality)
      .all();
    const bySource = db
      .select({
        sourceName: dataProvenance.sourceName,
        count: sql<number>`COUNT(*)`,
      })
      .from(dataProvenance)
      .groupBy(dataProvenance.sourceName)
      .all();
    // Ingestion counts
    const eiaCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawEiaGenerators).get() as { c: number }).c;
    const hifldCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawHifldTransmission).get() as { c: number }).c;
    const edgarCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawEdgarFilings).get() as { c: number }).c;
    const newsCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawDcNews).get() as { c: number }).c;
    const queueCount = (db.select({ c: sql<number>`COUNT(*)` }).from(rawIsoQueue).get() as { c: number }).c;
    const nriCount = (sqlite.prepare("SELECT COUNT(*) as c FROM raw_fema_nri").get() as { c: number }).c;
    const latestFetch = db.select({ f: sql<string>`MAX(fetched_at)` }).from(dataProvenance).get() as { f: string };
    res.json({
      byQuality,
      byFactor,
      bySource,
      ingestion: {
        eiaGenerators: eiaCount,
        hifldTransmissionCounties: hifldCount,
        edgarFilings: edgarCount,
        dcNewsItems: newsCount,
        isoQueueRows: queueCount,
        femaNriCounties: nriCount,
      },
      lastFetchedAt: latestFetch?.f ?? null,
    });
  });

  // ---- Ingestion runs ----
  app.get("/api/ingestion-runs", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const rows = sqlite.prepare(
      "SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT ?",
    ).all(limit);
    res.json(rows);
  });

  app.get("/api/ingestion-runs/latest", async (_req, res) => {
    // Latest run per pipeline
    const rows = sqlite.prepare(`
      SELECT r.* FROM ingestion_runs r
      INNER JOIN (
        SELECT pipeline, MAX(started_at) as maxTs FROM ingestion_runs GROUP BY pipeline
      ) latest ON r.pipeline = latest.pipeline AND r.started_at = latest.maxTs
      ORDER BY r.started_at DESC
    `).all();
    res.json(rows);
  });

  // ---- ISO queue rows ----
  app.get("/api/iso-queue", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const iso = (req.query.iso as string)?.toUpperCase();
    const fips = req.query.fips as string;
    let sql1 = "SELECT * FROM raw_iso_queue WHERE 1=1";
    const params: any[] = [];
    if (iso) { sql1 += " AND iso = ?"; params.push(iso); }
    if (fips) { sql1 += " AND fips = ?"; params.push(fips); }
    sql1 += " ORDER BY COALESCE(mw, 0) DESC LIMIT ?";
    params.push(limit);
    res.json(sqlite.prepare(sql1).all(...params));
  });

  app.get("/api/iso-queue/summary", async (_req, res) => {
    const byIso = sqlite.prepare(`
      SELECT iso, COUNT(*) as rows_count, SUM(COALESCE(mw,0)) as total_mw,
             SUM(CASE WHEN LOWER(COALESCE(status,'')) LIKE '%active%' OR LOWER(COALESCE(status,'')) LIKE '%construction%' OR LOWER(COALESCE(status,'')) LIKE '%service%' THEN COALESCE(mw,0) ELSE 0 END) as active_mw
      FROM raw_iso_queue GROUP BY iso ORDER BY total_mw DESC
    `).all();
    const topFips = sqlite.prepare(`
      SELECT fips, COUNT(*) as rows_count, SUM(COALESCE(mw,0)) as total_mw FROM raw_iso_queue
      WHERE fips IS NOT NULL GROUP BY fips ORDER BY total_mw DESC LIMIT 15
    `).all();
    res.json({ byIso, topFips });
  });

  // ---- FEMA NRI ----
  app.get("/api/fema-nri/:fips", async (req, res) => {
    const row = sqlite
      .prepare("SELECT * FROM raw_fema_nri WHERE fips = ?")
      .get(req.params.fips);
    if (!row) return res.status(404).json({ error: "No NRI record for FIPS" });
    res.json(row);
  });

  app.get("/api/edgar-filings", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const rows = db.select().from(rawEdgarFilings)
      .orderBy(desc(rawEdgarFilings.filedDate))
      .limit(limit)
      .all();
    const dicts = loadOperatorDicts();
    // Attach operator attribution so the UI can flag hyperscaler-linked filings.
    const enriched = rows.map((r: any) => ({
      ...r,
      attribution: attributeFiling(r.company ?? "", dicts),
    }));
    res.json(enriched);
  });

  // Hero feed: SEC filings attributed to a tracked hyperscaler/operator via its
  // shell-LLC dictionary, project codenames, or parent name. No competitor
  // productizes EDGAR full-text → operator attribution.
  //
  // Note: anonymous shell LLCs (e.g. "Siculus Inc.") rarely file with the SEC —
  // they surface in county land records, not EDGAR. So in practice the strongest
  // EDGAR signal is the public parent/REIT (Amazon, Microsoft, Equinix, Digital
  // Realty) filing DC-related 8-Ks. We surface both and tag matchType so callers
  // can distinguish shell/codename hits from parent-name hits.
  app.get("/api/edgar/shell-hits", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    // Default includes parent-name matches (>=0.5, now high-precision after
    // full-name matching). Pass ?min_confidence=0.75 for shell/codename only.
    const minConfidence = req.query.min_confidence
      ? Number(req.query.min_confidence)
      : 0.5;
    const dicts = loadOperatorDicts();
    const rows = db.select().from(rawEdgarFilings)
      .orderBy(desc(rawEdgarFilings.filedDate))
      .limit(1000)
      .all();
    const hits = rows
      .map((r: any) => {
        const attribution = attributeFiling(r.company ?? "", dicts);
        return attribution ? { ...r, attribution } : null;
      })
      .filter((r: any): r is any => r != null && r.attribution.confidence >= minConfidence)
      // Shell/codename hits before parent-name hits, newest first.
      .sort((a: any, b: any) =>
        b.attribution.confidence - a.attribution.confidence ||
        (b.filedDate ?? "").localeCompare(a.filedDate ?? ""))
      .slice(0, limit);

    // Rollup by operator for a scannable summary.
    const byOperator: Record<string, number> = {};
    for (const h of hits) byOperator[h.attribution.operator] = (byOperator[h.attribution.operator] ?? 0) + 1;

    res.json({
      count: hits.length,
      byOperator,
      hits,
    });
  });

  app.get("/api/dc-news", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const rows = db.select().from(rawDcNews)
      .orderBy(desc(rawDcNews.publishedAt))
      .limit(limit)
      .all();
    res.json(rows);
  });

  app.get("/api/triggers", async (req, res) => {
    const minCount = req.query.min ? Number(req.query.min) : 3;
    const windowDays = req.query.days ? Number(req.query.days) : 90;
    const rows = await storage.getTriggers(minCount, windowDays);
    res.json(rows);
  });

  app.get("/api/signals", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const rows = await storage.listSignals(limit);
    res.json(rows);
  });

  app.get("/api/operators", async (_req, res) => {
    const rows = await storage.listOperators();
    res.json(rows);
  });

  app.get("/api/watchlist", async (_req, res) => {
    const rows = await storage.getWatchlist();
    res.json(rows);
  });

  app.post("/api/watchlist", async (req, res) => {
    const parsed = insertWatchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const r = await storage.addToWatchlist(parsed.data);
    res.json(r);
  });

  app.delete("/api/watchlist/:fips", async (req, res) => {
    const r = await storage.removeFromWatchlist(req.params.fips);
    res.json(r);
  });

  app.patch("/api/watchlist/:fips", async (req, res) => {
    const schema = z.object({ note: z.string().optional(), priority: z.enum(["low", "normal", "high"]).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const r = await storage.updateWatchlistNote(req.params.fips, parsed.data.note ?? "", parsed.data.priority);
    if (!r) return res.status(404).json({ error: "Not on watchlist" });
    res.json(r);
  });

  // ---- Alert subscriptions ----
  app.get("/api/alert-subscriptions", async (_req, res) => {
    res.json(await storage.listAlertSubscriptions());
  });

  app.post("/api/alert-subscriptions", async (req, res) => {
    const parsed = insertAlertSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const r = await storage.createAlertSubscription(parsed.data);
    res.json(r);
  });

  app.patch("/api/alert-subscriptions/:id", async (req, res) => {
    const schema = z.object({ active: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const r = await storage.toggleAlertSubscription(Number(req.params.id), parsed.data.active);
    if (!r) return res.status(404).json({ error: "Subscription not found" });
    res.json(r);
  });

  app.delete("/api/alert-subscriptions/:id", async (req, res) => {
    const r = await storage.deleteAlertSubscription(Number(req.params.id));
    res.json(r);
  });

  app.post("/api/alert-subscriptions/evaluate", async (_req, res) => {
    const r = await storage.evaluateSubscriptions();
    res.json(r);
  });

  // ---- Alerts (fired) ----
  app.get("/api/alerts", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const rows = await storage.listAlerts(limit);
    res.json(rows);
  });

  app.get("/api/alerts/count-unack", async (_req, res) => {
    res.json({ count: await storage.countUnacknowledgedAlerts() });
  });

  app.post("/api/alerts/:id/ack", async (req, res) => {
    res.json(await storage.acknowledgeAlert(Number(req.params.id)));
  });

  app.post("/api/alerts/ack-all", async (_req, res) => {
    res.json(await storage.acknowledgeAllAlerts());
  });

  // ---- Score history / explainability (Gap 12) ---------------------------
  app.get("/api/counties/:fips/score-history", async (req, res) => {
    try {
      const fips = String(req.params.fips);
      const rows = sqlite
        .prepare(
          `SELECT snapshot_date, score, tier, queued_load_mw, substation_headroom_mva, time_to_power_months, fiber_density_score, hazard_score, water_stress_score, moratorium_status
             FROM score_history_daily WHERE fips = ? ORDER BY snapshot_date ASC`,
        )
        .all(fips) as any[];
      const dayDelta = rows.length >= 2 ? rows[rows.length - 1].score - rows[rows.length - 2].score : 0;
      const weekDelta = rows.length >= 2
        ? rows[rows.length - 1].score - (rows.find(r => r.snapshot_date <= rows[rows.length - 1].snapshot_date && r.snapshot_date >= new Date(new Date(rows[rows.length - 1].snapshot_date).getTime() - 8*86400e3).toISOString().slice(0,10))?.score ?? rows[rows.length - 1].score)
        : 0;
      res.json({ fips, timeline: rows, dayDelta, weekDelta, current: rows[rows.length - 1] ?? null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-factor delta between today's and yesterday's snapshot for one county.
  // Answers "which factor moved the score today?".
  app.get("/api/counties/:fips/factor-deltas", async (req, res) => {
    try {
      const fips = String(req.params.fips);
      const rows = sqlite
        .prepare(
          `SELECT snapshot_date, score, queued_load_mw, substation_headroom_mva, time_to_power_months,
                  fiber_density_score, hazard_score, water_stress_score, moratorium_status
             FROM score_history_daily WHERE fips = ? ORDER BY snapshot_date DESC LIMIT 2`,
        )
        .all(fips) as any[];
      if (rows.length < 2) {
        res.json({ fips, hasHistory: false, deltas: [] });
        return;
      }
      const [today, yday] = rows;
      const num = (a: any, b: any) => (Number(a ?? 0) - Number(b ?? 0));
      // Direction indicates whether an INCREASE in the raw factor is BULLISH (+) or BEARISH (-)
      // for landing probability. Used to color the delta chip in the UI.
      const factors = [
        { key: "queued_load_mw", label: "Queued load (MW)", direction: 1 as const },
        { key: "substation_headroom_mva", label: "Substation headroom (MVA)", direction: 1 as const },
        { key: "time_to_power_months", label: "Time to power (mo)", direction: -1 as const },
        { key: "fiber_density_score", label: "Fiber density", direction: 1 as const },
        { key: "hazard_score", label: "Hazard (FEMA NRI)", direction: -1 as const },
        { key: "water_stress_score", label: "Water stress", direction: -1 as const },
      ];
      const deltas = factors
        .map((f) => {
          const t = Number(today[f.key] ?? 0);
          const y = Number(yday[f.key] ?? 0);
          const delta = num(t, y);
          return { key: f.key, label: f.label, today: t, yesterday: y, delta, direction: f.direction, magnitude: Math.abs(delta) };
        })
        .sort((a, b) => b.magnitude - a.magnitude);
      const moratoriumChanged = String(today.moratorium_status ?? "") !== String(yday.moratorium_status ?? "");
      res.json({
        fips,
        hasHistory: true,
        today: today.snapshot_date,
        yesterday: yday.snapshot_date,
        scoreDelta: num(today.score, yday.score),
        moratoriumChanged,
        moratoriumToday: today.moratorium_status,
        moratoriumYesterday: yday.moratorium_status,
        deltas,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/score-history/daily-diff", async (_req, res) => {
    try {
      const dates = sqlite.prepare(`SELECT DISTINCT snapshot_date FROM score_history_daily ORDER BY snapshot_date DESC LIMIT 2`).all() as any[];
      if (dates.length < 2) { res.json({ today: null, yesterday: null, movers: [] }); return; }
      const [today, yesterday] = [dates[0].snapshot_date, dates[1].snapshot_date];
      const rows = sqlite.prepare(`
        SELECT t.fips, c.name, c.state, t.score AS today_score, y.score AS yesterday_score,
               (t.score - y.score) AS delta
          FROM score_history_daily t
          JOIN score_history_daily y ON y.fips = t.fips AND y.snapshot_date = ?
          JOIN counties c ON c.fips = t.fips
         WHERE t.snapshot_date = ?
         ORDER BY ABS(t.score - y.score) DESC
         LIMIT 40
      `).all(yesterday, today) as any[];
      const gainers = rows.filter(r => r.delta > 0).slice(0, 15);
      const losers = rows.filter(r => r.delta < 0).slice(0, 15);
      res.json({ today, yesterday, gainers, losers });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  registerAuth(app);
  registerExportRoutes(app);

  // ---- Health + heartbeat (Gap 17) ---------------------------------------
  app.get("/api/health", async (_req, res) => {
    try {
      const c = (sqlite.prepare("SELECT COUNT(*) AS n FROM counties").get() as any)?.n ?? 0;
      res.json({ status: "ok", counties: c, ts: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ status: "error", error: err.message });
    }
  });

  app.get("/api/cron/heartbeat", async (_req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT pipeline, MAX(started_at) AS last_started, status
          FROM ingestion_runs
         GROUP BY pipeline
         ORDER BY last_started DESC
      `).all() as any[];
      const now = Date.now();
      const { isRetriable } = await import("./ingest/scheduler.js");
      const withFresh = rows.map(r => {
        const ageMs = now - Number(r.last_started ?? 0);
        const ageDays = ageMs / (86400 * 1000);
        const stale = ageDays > 8;
        return {
          pipeline: r.pipeline,
          last_started: new Date(Number(r.last_started)).toISOString(),
          status: r.status,
          age_hours: ageMs / 3600000,
          stale,
          retriable: isRetriable(r.pipeline),
        };
      });
      const staleCount = withFresh.filter(r => r.stale).length;
      const failing = withFresh.filter(r => r.status === "error").length;
      res.json({ pipelines: withFresh, stale_count: staleCount, failing_count: failing, checked_at: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Backtest v2: precision/recall at cutoffs (Gap: score threshold sensitivity) ----
  app.get("/api/backtest/precision-recall", async (_req, res) => {
    try {
      const cutoffs = [50, 60, 70, 80];
      // Total universe of scored counties
      const totalCounties = (sqlite.prepare(
        "SELECT COUNT(*) AS n FROM counties WHERE landing_probability IS NOT NULL"
      ).get() as any).n as number;
      // All announcements whose fips joins a scored county — these are the "positives"
      const positives = sqlite.prepare(`
        SELECT DISTINCT a.fips, c.landing_probability AS score
        FROM dc_announcements a
        INNER JOIN counties c ON c.fips = a.fips
        WHERE c.landing_probability IS NOT NULL
      `).all() as any[];
      const totalPositives = positives.length;
      const rows = cutoffs.map((cutoff) => {
        // TP = counties with score >= cutoff AND at least one announcement
        // FP = counties with score >= cutoff AND no announcement
        // FN = counties with score <  cutoff AND at least one announcement
        // TN = counties with score <  cutoff AND no announcement
        const flaggedCount = (sqlite.prepare(
          "SELECT COUNT(*) AS n FROM counties WHERE landing_probability >= ?"
        ).get(cutoff) as any).n as number;
        const tp = positives.filter((p) => (p.score ?? 0) >= cutoff).length;
        const fp = flaggedCount - tp;
        const fn = totalPositives - tp;
        const tn = totalCounties - tp - fp - fn;
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        return { cutoff, tp, fp, fn, tn, flagged: flaggedCount, precision, recall, f1 };
      });
      res.json({
        cutoffs: rows,
        total_counties: totalCounties,
        total_positives: totalPositives,
        note: "Positives = counties in dc_announcements. Uses CURRENT score as a proxy for score at announcement time (no historical scores for pre-2026-06 announcements). Interpret precision as 'if I flag every county at this cutoff, what fraction hit?' and recall as 'what fraction of known landings did I catch?'.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "precision-recall failed" });
    }
  });

  // ---- Portfolio scoring: user pastes CSV or list of FIPS codes ----
  app.post("/api/portfolio/score", async (req, res) => {
    try {
      const raw = typeof req.body === "string" ? req.body : (req.body?.csv ?? "");
      const text = String(raw || "").trim();
      if (!text) {
        res.status(400).json({ error: "Empty payload. POST { csv: '...' } or raw text with fips codes." });
        return;
      }
      // Parse a very forgiving CSV: split lines, split cells, find fips column
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Try to detect a header line
      const first = lines[0].toLowerCase();
      const hasHeader = /fips|county|state|lat|lng|lon/.test(first);
      let fipsCol = 0;
      let latCol = -1;
      let lngCol = -1;
      let labelCol = -1;
      if (hasHeader) {
        const cols = first.split(/[,;\t|]/).map((c) => c.trim());
        fipsCol = cols.findIndex((c) => c === "fips" || c === "county_fips" || c === "geoid");
        latCol = cols.findIndex((c) => c === "lat" || c === "latitude");
        lngCol = cols.findIndex((c) => c === "lng" || c === "lon" || c === "longitude");
        labelCol = cols.findIndex((c) => c === "label" || c === "name" || c === "site" || c === "parcel");
        if (fipsCol < 0 && latCol < 0) {
          res.status(400).json({ error: "Header row detected but no 'fips' or 'lat/lng' column found. Provide either a fips column or lat and lng columns." });
          return;
        }
      }
      const dataLines = hasHeader ? lines.slice(1) : lines;
      const results: any[] = [];
      const notFound: any[] = [];
      // Load counties once for nearest-neighbor fallback
      const allCounties = sqlite.prepare(
        "SELECT fips, name, state, lat, lng, landing_probability AS score, score_tier AS tier, queued_load_mw, substation_headroom_mva, time_to_power_months, fiber_density_score, hazard_score, water_stress_score, moratorium_status, iso, utility FROM counties"
      ).all() as any[];
      const countyByFips = new Map<string, any>(allCounties.map((c) => [String(c.fips).padStart(5, "0"), c]));
      const nearest = (lat: number, lng: number) => {
        let best: any = null;
        let bestD = Infinity;
        for (const c of allCounties) {
          const dLat = c.lat - lat;
          const dLng = c.lng - lng;
          const d = dLat * dLat + dLng * dLng;
          if (d < bestD) { bestD = d; best = c; }
        }
        return best;
      };
      for (let i = 0; i < dataLines.length && i < 5000; i++) {
        const line = dataLines[i];
        const cells = line.split(/[,;\t|]/).map((c) => c.trim().replace(/^"|"$/g, ""));
        let county: any = null;
        let label: string | undefined;
        if (fipsCol >= 0) {
          const raw = cells[fipsCol] || "";
          const fips = raw.replace(/[^0-9]/g, "").padStart(5, "0").slice(-5);
          county = countyByFips.get(fips);
        }
        if (!county && latCol >= 0 && lngCol >= 0) {
          const lat = Number(cells[latCol]);
          const lng = Number(cells[lngCol]);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            county = nearest(lat, lng);
          }
        }
        // No header: treat first cell as fips
        if (!hasHeader && !county) {
          const raw = cells[0] || "";
          const fips = raw.replace(/[^0-9]/g, "").padStart(5, "0").slice(-5);
          county = countyByFips.get(fips);
        }
        if (labelCol >= 0) label = cells[labelCol];
        if (county) {
          results.push({ input_line: i + 1, label, ...county });
        } else {
          notFound.push({ input_line: i + 1, raw: line });
        }
      }
      // Summary buckets
      const summary = {
        rows_scored: results.length,
        rows_unmatched: notFound.length,
        hot: results.filter((r) => scoreTierFor(r.score ?? 0) === "hot").length,
        warm: results.filter((r) => scoreTierFor(r.score ?? 0) === "warm").length,
        emerging: results.filter((r) => scoreTierFor(r.score ?? 0) === "emerging").length,
        cold: results.filter((r) => scoreTierFor(r.score ?? 0) === "cold").length,
        avg_score: results.length > 0 ? results.reduce((s, r) => s + (r.score ?? 0), 0) / results.length : 0,
        top_iso: (() => {
          const isoCounts: Record<string, number> = {};
          for (const r of results) if (r.iso) isoCounts[r.iso] = (isoCounts[r.iso] || 0) + 1;
          return Object.entries(isoCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([iso, n]) => ({ iso, n }));
        })(),
      };
      res.json({ results, not_found: notFound, summary });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "portfolio scoring failed" });
    }
  });

  // ---- Score deltas (map heatmap): 7-day change per county ----
  app.get("/api/counties/score-deltas", async (_req, res) => {
    try {
      const dates = sqlite.prepare(
        "SELECT DISTINCT snapshot_date FROM score_history_daily ORDER BY snapshot_date DESC LIMIT 8"
      ).all() as { snapshot_date: string }[];
      if (dates.length < 2) {
        res.json({ rows: [], today: null, prior: null, note: "not enough score history" });
        return;
      }
      const today = dates[0].snapshot_date;
      // Pick the snapshot roughly 7 days back — fall back to earliest available if we don't have that much history
      const prior = dates[dates.length - 1].snapshot_date;
      const rows = sqlite.prepare(`
        SELECT t.fips, c.name, c.state, c.lat, c.lng, c.iso, c.score_tier AS tier,
               t.score AS score_today, p.score AS score_prior,
               (t.score - p.score) AS delta
        FROM score_history_daily t
        INNER JOIN score_history_daily p ON p.fips = t.fips AND p.snapshot_date = ?
        INNER JOIN counties c ON c.fips = t.fips
        WHERE t.snapshot_date = ?
      `).all(prior, today) as any[];
      res.json({ rows, today, prior, days_apart: dates.length - 1 });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "score-deltas failed" });
    }
  });

  // ---- Operator playbook: average county profile per operator ----
  app.get("/api/operators/:name/profile", async (req, res) => {
    try {
      const name = req.params.name;
      const rows = sqlite.prepare(`
        SELECT a.fips, a.announced_date, a.announced_mw, a.capex_usd_b, a.status, a.source_url,
               c.name AS county, c.state, c.landing_probability AS score, c.score_tier AS tier,
               c.queued_load_mw, c.substation_headroom_mva, c.time_to_power_months,
               c.fiber_density_score, c.hazard_score, c.water_stress_score,
               c.tax_incentive_score, c.iso, c.utility
        FROM dc_announcements a
        LEFT JOIN counties c ON c.fips = a.fips
        WHERE LOWER(a.operator) = LOWER(?)
        ORDER BY a.announced_date DESC
      `).all(name) as any[];
      if (rows.length === 0) {
        res.json({ operator: name, sites: [], profile: null, note: "no announcements found for this operator" });
        return;
      }
      const scoredRows = rows.filter((r) => typeof r.score === "number");
      const avg = (key: string) => {
        const vs = scoredRows.map((r) => r[key]).filter((v) => v != null);
        return vs.length > 0 ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
      };
      const isoMix: Record<string, number> = {};
      const utilityMix: Record<string, number> = {};
      const stateMix: Record<string, number> = {};
      for (const r of scoredRows) {
        if (r.iso) isoMix[r.iso] = (isoMix[r.iso] || 0) + 1;
        if (r.utility) utilityMix[r.utility] = (utilityMix[r.utility] || 0) + 1;
        if (r.state) stateMix[r.state] = (stateMix[r.state] || 0) + 1;
      }
      const totalCapex = rows.reduce((s, r) => s + (r.capex_usd_b ?? 0), 0);
      const totalMw = rows.reduce((s, r) => s + (r.announced_mw ?? 0), 0);
      const profile = {
        n_sites: rows.length,
        n_scored: scoredRows.length,
        avg_score: avg("score"),
        avg_queued_load_mw: avg("queued_load_mw"),
        avg_substation_headroom_mva: avg("substation_headroom_mva"),
        avg_time_to_power_months: avg("time_to_power_months"),
        avg_fiber_density_score: avg("fiber_density_score"),
        avg_hazard_score: avg("hazard_score"),
        avg_water_stress_score: avg("water_stress_score"),
        avg_tax_incentive_score: avg("tax_incentive_score"),
        total_mw: totalMw,
        total_capex_usd_b: totalCapex,
        iso_mix: Object.entries(isoMix).sort((a, b) => b[1] - a[1]),
        utility_mix: Object.entries(utilityMix).sort((a, b) => b[1] - a[1]),
        state_mix: Object.entries(stateMix).sort((a, b) => b[1] - a[1]),
      };
      res.json({ operator: name, sites: rows, profile });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "operator profile failed" });
    }
  });

  // ---- Operator activity feed: parcels, permits, bids, signals for one operator ----
  app.get("/api/operators/:name/activity", async (req, res) => {
    try {
      const name = req.params.name;
      const like = `%${name}%`;

      // Get shell LLCs for this operator so we can match them too
      let shellLlcs: string[] = [];
      try {
        const opRow = sqlite.prepare(`SELECT shell_llcs, codenames FROM operators WHERE LOWER(name) = LOWER(?)`).get(name) as any;
        if (opRow) {
          try { shellLlcs = shellLlcs.concat(JSON.parse(opRow.shell_llcs || "[]")); } catch {}
          try { shellLlcs = shellLlcs.concat(JSON.parse(opRow.codenames || "[]")); } catch {}
        }
      } catch {}

      // Build a WHERE clause that matches operator name OR any known shell LLC
      const shellLikes = shellLlcs.map((s) => `%${s}%`);

      // Parcels: match resolved_operator or owner_name against operator/shell LLCs
      let parcels: any[] = [];
      try {
        const conditions = ["p.resolved_operator LIKE ? COLLATE NOCASE", "p.owner_name LIKE ? COLLATE NOCASE"];
        const bindings: any[] = [like, like];
        for (const s of shellLikes) {
          conditions.push("p.owner_name LIKE ? COLLATE NOCASE");
          bindings.push(s);
        }
        parcels = sqlite.prepare(`
          SELECT p.id, p.apn, p.owner_name, p.resolved_operator, p.acres, p.parcel_score,
                 p.status, p.last_transfer_date, p.county_fips,
                 c.name AS county_name, c.state
          FROM parcels p
          LEFT JOIN counties c ON c.fips = p.county_fips
          WHERE ${conditions.join(" OR ")}
          ORDER BY COALESCE(p.last_transfer_date, '1970-01-01') DESC, p.parcel_score DESC
          LIMIT 40
        `).all(...bindings) as any[];
      } catch { /* table optional */ }

      // Permits: match applicant, resolved_operator, description
      let permits: any[] = [];
      try {
        const conditions = [
          "p.resolved_operator LIKE ? COLLATE NOCASE",
          "p.applicant LIKE ? COLLATE NOCASE",
          "p.description LIKE ? COLLATE NOCASE",
        ];
        const bindings: any[] = [like, like, like];
        for (const s of shellLikes) {
          conditions.push("p.applicant LIKE ? COLLATE NOCASE");
          bindings.push(s);
        }
        permits = sqlite.prepare(`
          SELECT p.id, p.permit_type, p.applicant, p.resolved_operator, p.filed_date,
                 p.status, p.megawatts, p.acres, p.description, p.source_url, p.county_fips,
                 c.name AS county_name, c.state
          FROM permits p
          LEFT JOIN counties c ON c.fips = p.county_fips
          WHERE ${conditions.join(" OR ")}
          ORDER BY COALESCE(p.filed_date, '1970-01-01') DESC
          LIMIT 40
        `).all(...bindings) as any[];
      } catch { /* table optional */ }

      // Competitive bids: match competing_operators
      let bids: any[] = [];
      try {
        bids = sqlite.prepare(`
          SELECT b.id, b.county_fips, b.competing_operators, b.recent_deals_90d,
                 b.avg_deal_size_mw, b.heat_score, b.narrative, b.updated_at,
                 c.name AS county_name, c.state
          FROM competitive_bids b
          LEFT JOIN counties c ON c.fips = b.county_fips
          WHERE b.competing_operators LIKE ? COLLATE NOCASE
          ORDER BY b.heat_score DESC
          LIMIT 20
        `).all(like) as any[];
      } catch { /* table optional */ }

      // Signals: match suspected_operator or shell_llc
      let signals: any[] = [];
      try {
        const conditions = ["s.suspected_operator LIKE ? COLLATE NOCASE", "s.shell_llc LIKE ? COLLATE NOCASE", "s.detail LIKE ? COLLATE NOCASE"];
        const bindings: any[] = [like, like, like];
        for (const sh of shellLikes) {
          conditions.push("s.shell_llc LIKE ? COLLATE NOCASE");
          bindings.push(sh);
        }
        signals = sqlite.prepare(`
          SELECT s.id, s.signal_type, s.headline, s.detail, s.suspected_operator,
                 s.shell_llc, s.parcel_acres, s.detected_at, s.source_url, s.source_name,
                 s.county_fips, c.name AS county_name, c.state
          FROM signals s
          LEFT JOIN counties c ON c.fips = s.county_fips
          WHERE ${conditions.join(" OR ")}
          ORDER BY COALESCE(s.detected_at, '1970-01-01') DESC
          LIMIT 30
        `).all(...bindings) as any[];
      } catch { /* table optional */ }

      res.json({
        operator: name,
        shell_llcs: shellLlcs,
        parcels,
        permits,
        bids,
        signals,
        totals: {
          parcels: parcels.length,
          permits: permits.length,
          bids: bids.length,
          signals: signals.length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "operator activity failed" });
    }
  });

  // ---- Data freshness: one row per pipeline with age in hours + stale flag ----
  app.get("/api/data-freshness/summary", async (_req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT pipeline,
               MAX(started_at) AS last_started,
               (SELECT status FROM ingestion_runs r2 WHERE r2.pipeline = r1.pipeline ORDER BY started_at DESC LIMIT 1) AS status,
               (SELECT rows FROM ingestion_runs r2 WHERE r2.pipeline = r1.pipeline ORDER BY started_at DESC LIMIT 1) AS rows_ingested
        FROM ingestion_runs r1
        GROUP BY pipeline
        ORDER BY last_started DESC
      `).all() as any[];
      const now = Date.now();
      const enriched = rows.map((r) => {
        const ts = Number(r.last_started ?? 0);
        const ageMs = now - ts;
        const ageHours = ageMs / 3_600_000;
        // pipeline-specific staleness thresholds
        const p = String(r.pipeline);
        let staleAfterHours = 24 * 8; // default weekly-ish
        if (/queue/i.test(p)) staleAfterHours = 24 * 35; // monthly ISO queues
        else if (/dc_news|sec|edgar/i.test(p)) staleAfterHours = 30; // daily news
        else if (/score_history|score_history_daily/i.test(p)) staleAfterHours = 30; // nightly
        else if (/eia860|fema_nri/i.test(p)) staleAfterHours = 24 * 100; // quarterly
        return {
          pipeline: p,
          last_started_iso: ts ? new Date(ts).toISOString() : null,
          age_hours: ageHours,
          status: r.status,
          rows_ingested: r.rows_ingested,
          stale_after_hours: staleAfterHours,
          stale: ageHours > staleAfterHours,
        };
      });
      res.json({
        pipelines: enriched,
        checked_at: new Date().toISOString(),
        stale_count: enriched.filter((r) => r.stale).length,
        failing_count: enriched.filter((r) => r.status === "error").length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "freshness failed" });
    }
  });

  // ---- Force one pipeline to re-run now (the "Retry Now" button) ----
  // The scheduler already retries a behind feed on its next hourly tick; this
  // skips the wait. Runs in the background and returns immediately.
  app.post("/api/data-freshness/retry", async (req, res) => {
    try {
      const pipeline = String(req.body?.pipeline ?? "").trim();
      if (!pipeline) return res.status(400).json({ error: "pipeline is required" });
      const { triggerPipeline } = await import("./ingest/scheduler.js");
      const result = triggerPipeline(pipeline);
      if (!result.started) return res.status(409).json({ error: result.reason ?? "could not start" });
      res.json({ started: true, pipeline });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "retry failed" });
    }
  });

  // ---- Global search: counties + operators + shell LLCs ----
  app.get("/api/search", async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) {
        res.json({ counties: [], operators: [], signals: [] });
        return;
      }
      const like = `%${q}%`;
      const counties = sqlite.prepare(`
        SELECT fips, name, state, landing_probability AS score, score_tier AS tier, iso
        FROM counties
        WHERE name LIKE ? COLLATE NOCASE OR state LIKE ? COLLATE NOCASE OR fips LIKE ?
        ORDER BY landing_probability DESC
        LIMIT 8
      `).all(like, like, like) as any[];
      const operatorsRaw = sqlite.prepare(`
        SELECT DISTINCT operator AS name, COUNT(*) AS count, SUM(announced_mw) AS total_mw
        FROM dc_announcements
        WHERE operator LIKE ? COLLATE NOCASE
        GROUP BY operator
        ORDER BY total_mw DESC
        LIMIT 6
      `).all(like) as any[];
      const operators = operatorsRaw.map((o) => ({ name: o.name, count: o.count }));
      // Also search dc_news raw table if it exists
      let signals: any[] = [];
      try {
        const rawSignals = sqlite.prepare(`
          SELECT rowid AS id, title AS headline, url, published_at AS publishedAt, source
          FROM raw_dc_news
          WHERE title LIKE ? COLLATE NOCASE
          ORDER BY published_at DESC
          LIMIT 6
        `).all(like) as any[];
        signals = rawSignals.map((s) => ({
          id: String(s.id),
          headline: s.headline,
          url: s.url,
          publishedAt: s.publishedAt ? new Date(s.publishedAt).toISOString() : null,
          source: s.source,
        }));
      } catch { /* table optional */ }

      // Parcels: match APN, owner name, or resolved operator
      let parcels: any[] = [];
      try {
        parcels = sqlite.prepare(`
          SELECT p.id, p.apn, p.owner_name, p.resolved_operator, p.acres, p.parcel_score,
                 p.county_fips, c.name AS county_name, c.state
          FROM parcels p
          LEFT JOIN counties c ON c.fips = p.county_fips
          WHERE p.apn LIKE ? COLLATE NOCASE
             OR p.owner_name LIKE ? COLLATE NOCASE
             OR p.resolved_operator LIKE ? COLLATE NOCASE
          ORDER BY p.parcel_score DESC, p.acres DESC
          LIMIT 6
        `).all(like, like, like) as any[];
      } catch { /* table optional */ }

      // Permits: match applicant, operator, or description
      let permits: any[] = [];
      try {
        permits = sqlite.prepare(`
          SELECT p.id, p.permit_type, p.applicant, p.resolved_operator, p.filed_date,
                 p.status, p.megawatts, p.county_fips, c.name AS county_name, c.state
          FROM permits p
          LEFT JOIN counties c ON c.fips = p.county_fips
          WHERE p.applicant LIKE ? COLLATE NOCASE
             OR p.resolved_operator LIKE ? COLLATE NOCASE
             OR p.description LIKE ? COLLATE NOCASE
             OR p.permit_type LIKE ? COLLATE NOCASE
          ORDER BY p.filed_date DESC
          LIMIT 6
        `).all(like, like, like, like) as any[];
      } catch { /* table optional */ }

      // Competitive bids: match county name or state
      let bids: any[] = [];
      try {
        bids = sqlite.prepare(`
          SELECT b.id, b.county_fips, b.competing_operators, b.recent_deals_90d,
                 b.avg_deal_size_mw, b.heat_score, c.name AS county_name, c.state
          FROM competitive_bids b
          LEFT JOIN counties c ON c.fips = b.county_fips
          WHERE c.name LIKE ? COLLATE NOCASE
             OR c.state LIKE ? COLLATE NOCASE
             OR b.competing_operators LIKE ? COLLATE NOCASE
          ORDER BY b.heat_score DESC
          LIMIT 6
        `).all(like, like, like) as any[];
      } catch { /* table optional */ }

      res.json({ counties, operators, signals, parcels, permits, bids, query: q });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "search failed" });
    }
  });

  // ---- Site-level parcels ----
  app.get("/api/counties/:fips/parcel-list", async (req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT id, apn, acres, owner_name, owner_is_shell_llc, resolved_operator,
               substation_distance_mi, fiber_distance_mi, zoning, land_price,
               last_transfer_date, parcel_score, status
        FROM parcels
        WHERE county_fips = ?
        ORDER BY parcel_score DESC, acres DESC
      `).all(req.params.fips);
      res.json({ fips: req.params.fips, parcels: rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "parcel-list failed" });
    }
  });

  app.get("/api/parcels/top", async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(10, parseInt(String(req.query.limit ?? "50"), 10) || 50));
      const rows = sqlite.prepare(`
        SELECT p.*, c.name AS county_name, c.state, c.landing_probability AS county_score, c.iso
        FROM parcels p
        JOIN counties c ON c.fips = p.county_fips
        ORDER BY p.parcel_score DESC, p.acres DESC
        LIMIT ?
      `).all(limit);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "top parcels failed" });
    }
  });

  // ---- Permit tracker ----
  app.get("/api/counties/:fips/permits", async (req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT id, permit_type, applicant, resolved_operator, parcel_apn,
               filed_date, status, megawatts, acres, description, source_url
        FROM permits
        WHERE county_fips = ?
        ORDER BY filed_date DESC
      `).all(req.params.fips);
      res.json({ fips: req.params.fips, permits: rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "permits failed" });
    }
  });

  app.get("/api/permits/recent", async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(10, parseInt(String(req.query.limit ?? "50"), 10) || 50));
      const rows = sqlite.prepare(`
        SELECT p.*, c.name AS county_name, c.state, c.landing_probability AS county_score
        FROM permits p
        JOIN counties c ON c.fips = p.county_fips
        ORDER BY p.filed_date DESC
        LIMIT ?
      `).all(limit);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "recent permits failed" });
    }
  });

  // ---- Competitive bid intel ----
  app.get("/api/counties/:fips/competitive-bids", async (req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT id, operator, stage, megawatts, observed_date, source, source_url, confidence, notes
        FROM competitive_bids
        WHERE county_fips = ?
        ORDER BY observed_date DESC
      `).all(req.params.fips);
      const total = rows.length;
      const operatorSet = new Set(rows.map((r: any) => r.operator));
      const activeStages = rows.filter((r: any) => ["loi","option","under_contract","closed"].includes(r.stage)).length;
      res.json({
        fips: req.params.fips,
        bids: rows,
        summary: { total, unique_operators: operatorSet.size, active_stages: activeStages },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "competitive-bids failed" });
    }
  });

  app.get("/api/competitive-bids/heat", async (_req, res) => {
    try {
      // Which counties are seeing the most competitive activity in the last 90 days?
      const rows = sqlite.prepare(`
        SELECT b.county_fips AS fips, c.name, c.state, c.landing_probability AS score,
               COUNT(*) AS bid_count,
               COUNT(DISTINCT b.operator) AS unique_operators,
               GROUP_CONCAT(DISTINCT b.operator) AS operators,
               SUM(CASE WHEN b.stage IN ('loi','option','under_contract','closed') THEN 1 ELSE 0 END) AS active_count
        FROM competitive_bids b
        JOIN counties c ON c.fips = b.county_fips
        WHERE date(b.observed_date) >= date('now', '-1095 days')
        GROUP BY b.county_fips
        ORDER BY active_count DESC, bid_count DESC
        LIMIT 50
      `).all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "heat failed" });
    }
  });

  // ---- Notification digest: user alerts history + operator/permit feed ----
  app.get("/api/digest/recent", async (_req, res) => {
    try {
      // Last 48h of high-signal events: hot permits, new bids in top counties, price/queue movers, shell-LLC hits
      const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
      const permits = sqlite.prepare(`
        SELECT p.filed_date, p.county_fips, c.name AS county, c.state,
               p.permit_type, p.applicant, p.resolved_operator, p.megawatts, p.acres, p.status, p.description, p.source_url
        FROM permits p JOIN counties c ON c.fips = p.county_fips
        WHERE p.filed_date >= ? AND (p.resolved_operator IS NOT NULL OR p.megawatts >= 200 OR p.acres >= 500)
        ORDER BY p.filed_date DESC LIMIT 20
      `).all(since);
      const bids = sqlite.prepare(`
        SELECT b.observed_date, b.county_fips, c.name AS county, c.state,
               b.operator, b.stage, b.megawatts, b.source, b.notes, b.confidence, b.source_url
        FROM competitive_bids b JOIN counties c ON c.fips = b.county_fips
        WHERE b.observed_date >= ? AND b.stage IN ('loi','option','under_contract','closed')
        ORDER BY b.observed_date DESC LIMIT 20
      `).all(since);
      const movers = sqlite.prepare(`
        SELECT s.fips, c.name, c.state, s.score - sp.score AS delta, s.score AS score_today, sp.score AS score_prior, s.snapshot_date AS today, sp.snapshot_date AS prior
        FROM score_history_daily s
        JOIN score_history_daily sp ON sp.fips = s.fips AND sp.snapshot_date = (SELECT MAX(snapshot_date) FROM score_history_daily WHERE snapshot_date < s.snapshot_date)
        JOIN counties c ON c.fips = s.fips
        WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM score_history_daily)
          AND ABS(s.score - sp.score) >= 3
        ORDER BY ABS(s.score - sp.score) DESC LIMIT 15
      `).all();
      res.json({ since, permits, bids, movers });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "digest failed" });
    }
  });

  // ---- Score explainability: per-county factor breakdown ----
  let overlayWarmed = false;
  const ensureOverlayWarm = () => {
    if (!overlayWarmed) {
      try { warmOverlayCaches(); overlayWarmed = true; } catch (e) { console.error("[factors] warm failed", e); }
    }
  };
  app.get("/api/counties/:fips/factors", async (req, res) => {
    try {
      const c = await storage.getCounty(req.params.fips);
      if (!c) return res.status(404).json({ error: "County not found" });
      ensureOverlayWarm();
      const overlay = buildOverlayFor(c.fips);
      const factors = computeCountyFactorsV5(c as any, overlay);
      const totalContribution = factors.reduce((s, f) => s + (f.contribution ?? 0), 0);
      const factorsWithShare = factors.map((f) => ({
        key: f.key,
        label: f.label,
        weight: f.weight,
        value: f.value,
        contribution: f.contribution,
        share: totalContribution > 0 ? (f.contribution ?? 0) / totalContribution : 0,
        dataQuality: f.dataQuality,
        sourceHint: f.sourceHint,
      }));
      factorsWithShare.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
      const score = c.landingProbability ?? 0;
      const strengths = factorsWithShare.filter((f) => f.value >= 60).slice(0, 3);
      const weaknesses = factorsWithShare.filter((f) => f.value < 40).sort((a, b) => a.value - b.value).slice(0, 3);
      res.json({
        fips: c.fips,
        name: c.name,
        state: c.state,
        score,
        tier: c.scoreTier,
        factors: factorsWithShare,
        strengths,
        weaknesses,
        totalContribution,
      });
    } catch (e: any) {
      console.error("[factors]", e);
      res.status(500).json({ error: e?.message ?? "factors failed" });
    }
  });

  // ============================================================================
  // Admin stats — system-level view (db size, users, pipelines, uptime)
  // ============================================================================
  const START_TIME = Date.now();
  app.get("/api/admin/stats", (_req, res) => {
    try {
      const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[];
      const tableStats = tables.map((t) => {
        try {
          const c = sqlite.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get() as { n: number };
          return { name: t.name, row_count: c.n };
        } catch {
          return { name: t.name, row_count: 0 };
        }
      }).sort((a, b) => b.row_count - a.row_count);

      let dbSize = 0;
      try {
        const dbPath = path.join(process.cwd(), "data.db");
        dbSize = fs.statSync(dbPath).size / 1024 / 1024;
      } catch { /* ignore */ }

      const pipelines = sqlite.prepare(`
        SELECT pipeline, MAX(started_at) AS last_started,
               (SELECT status FROM ingestion_runs r2 WHERE r2.pipeline = r1.pipeline ORDER BY started_at DESC LIMIT 1) AS status
        FROM ingestion_runs r1 GROUP BY pipeline ORDER BY last_started DESC
      `).all() as any[];
      const now = Date.now();
      const pipelineRows = pipelines.map((r) => {
        const ts = Number(r.last_started ?? 0);
        const ageHours = ts ? (now - ts) / 3_600_000 : 999;
        const p = String(r.pipeline);
        let staleAfter = 24 * 8;
        if (/queue/i.test(p)) staleAfter = 24 * 35;
        else if (/dc_news|sec|edgar/i.test(p)) staleAfter = 30;
        else if (/score_history/i.test(p)) staleAfter = 30;
        else if (/eia860|fema_nri/i.test(p)) staleAfter = 24 * 100;
        return { pipeline: p, status: r.status, last_started_iso: ts ? new Date(ts).toISOString() : null, age_hours: ageHours, stale: ageHours > staleAfter };
      });

      const ingest24 = sqlite.prepare(`SELECT COUNT(*) as n FROM ingestion_runs WHERE started_at > ?`).get(Date.now() - 86400_000) as { n: number };
      const users = sqlite.prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number };
      const operators = sqlite.prepare(`SELECT COUNT(*) as n FROM operators`).get() as { n: number };
      const tierRows = sqlite.prepare(`SELECT score_tier as tier, COUNT(*) as n FROM counties GROUP BY score_tier`).all() as { tier: string; n: number }[];
      const countiesByTier: Record<string, number> = {};
      for (const t of tierRows) countiesByTier[t.tier] = t.n;

      res.json({
        db_size_mb: dbSize,
        tables: tableStats,
        pipelines: pipelineRows,
        ingest_runs_last_24h: ingest24.n,
        users_total: users.n,
        operators_total: operators.n,
        counties_by_tier: countiesByTier,
        api_rate_buckets: 0,
        uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "admin stats failed" });
    }
  });

  // ============================================================================
  // Webhook subscriptions — in-memory demo (production would persist to DB)
  // ============================================================================
  type Webhook = { id: string; url: string; events: string[]; created_at: string; last_ping_at: string | null; last_status: number | null };
  const WEBHOOKS: Webhook[] = [
    { id: "wh_demo_1", url: "https://hooks.slack.com/services/T00/B00/xxx", events: ["tier_upgrade","score_cross"], created_at: "2026-06-15T14:22:00Z", last_ping_at: "2026-07-05T04:12:00Z", last_status: 200 },
    { id: "wh_demo_2", url: "https://api.example.com/gridsense-hook", events: ["new_permit","new_bid"], created_at: "2026-06-28T09:15:00Z", last_ping_at: "2026-07-05T11:03:00Z", last_status: 200 },
  ];

  // ---- API key management (admin only; admin = session userId 0) ----
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.session?.userId === 0) return next();
    return res.status(403).json({ message: "admin only" });
  };
  app.get("/api/keys", requireAuth, requireAdmin, (_req, res) => {
    res.json(listApiKeys());
  });
  app.post("/api/keys", requireAuth, requireAdmin, (req, res) => {
    const plan = (["free", "pro", "enterprise"].includes(req.body?.plan) ? req.body.plan : "pro") as Plan;
    const label = typeof req.body?.label === "string" ? req.body.label.slice(0, 100) : undefined;
    const { key, record } = createApiKey(plan, label);
    // The raw key is returned exactly once.
    res.status(201).json({ key, record, note: "Store this key now — it will not be shown again." });
  });
  app.delete("/api/keys/:id", requireAuth, requireAdmin, (req, res) => {
    const ok = revokeApiKey(Number(req.params.id));
    res.status(ok ? 200 : 404).json({ revoked: ok });
  });

  app.get("/api/webhooks", (_req, res) => res.json(WEBHOOKS));
  app.post("/api/webhooks", (req, res) => {
    const { url, events } = req.body ?? {};
    if (!url || typeof url !== "string" || !url.startsWith("http")) return res.status(400).json({ error: "url required (http/https)" });
    const wh: Webhook = { id: `wh_${Date.now().toString(36)}`, url, events: Array.isArray(events) ? events : ["tier_upgrade"], created_at: new Date().toISOString(), last_ping_at: null, last_status: null };
    WEBHOOKS.push(wh);
    res.status(201).json(wh);
  });
  app.post("/api/webhooks/:id/test", async (req, res) => {
    const wh = WEBHOOKS.find((w) => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: "webhook not found" });
    const nowIso = new Date().toISOString();
    const payload = { event: "webhook.test", delivered_at: nowIso, data: { message: "Test ping from GridSense", webhook_id: wh.id, ts: nowIso } };
    const bodyStr = JSON.stringify(payload);
    const crypto = await import("node:crypto");
    // Per-webhook signing secret (deterministic from id so the customer can look it up).
    const secret = crypto.createHash("sha256").update(`gridsense:${wh.id}`).digest("hex").slice(0, 32);
    const signature = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
    let deliveryStatus: number | null = null;
    let deliveryError: string | null = null;
    try {
      // Attempt real delivery with a short timeout. Fail silently — test-ping should still succeed even for unreachable URLs.
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(wh.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gridsense-signature": `sha256=${signature}`,
          "x-gridsense-event": "webhook.test",
          "x-gridsense-delivery": crypto.randomUUID(),
          "user-agent": "GridSense-Webhook/1.0",
        },
        body: bodyStr,
        signal: ctl.signal,
      });
      clearTimeout(to);
      deliveryStatus = r.status;
    } catch (e: any) {
      deliveryError = e?.name === "AbortError" ? "delivery_timeout" : (e?.message ?? "delivery_failed");
    }
    wh.last_ping_at = nowIso;
    wh.last_status = deliveryStatus ?? 0;
    res.json({
      ok: true,
      delivered_at: nowIso,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
      signature: `sha256=${signature}`,
      signing_algorithm: "HMAC-SHA256",
      signing_secret_preview: `${secret.slice(0, 6)}…${secret.slice(-4)}`,
      payload_preview: payload,
    });
  });
  app.delete("/api/webhooks/:id", (req, res) => {
    const i = WEBHOOKS.findIndex((w) => w.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "webhook not found" });
    WEBHOOKS.splice(i, 1);
    res.json({ ok: true });
  });

  return httpServer;
}
