import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import path from "node:path";
import fs from "node:fs";
import { storage, db, sqlite } from "../storage";
import { insertWatchlistSchema, insertAlertSubscriptionSchema, dataProvenance, rawEiaGenerators, rawHifldTransmission, rawEdgarFilings, rawDcNews, rawIsoQueue } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { registerExportRoutes } from "../exports";
import { registerAuth } from "../auth";
import { computeCountyFactorsV5, scoreTierFor } from "../scoring";
import { buildOverlayFor, warmOverlayCaches } from "../ingest/overlay";
import { attributeFiling, type OperatorDict } from "../edgar-attribution";
import { computePowerHeadroom } from "../headroom";
import { requireAuth } from "../auth";
import { createApiKey, listApiKeys, revokeApiKey, type Plan } from "../apikeys";

// Load operator shell-LLC / codename dictionaries (JSON-text columns → arrays).

export function registerCounties(app: Express) {
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

  // EPA AirData annual AQI for one county. Null when the county has no monitor.
  app.get("/api/counties/:fips/air-quality", async (req, res) => {
    try {
      const row = sqlite.prepare(
        `SELECT fips, year, days_with_aqi AS daysWithAqi, good_days AS goodDays,
                moderate_days AS moderateDays, unhealthy_sensitive_days AS unhealthySensitiveDays,
                unhealthy_days AS unhealthyDays, very_unhealthy_days AS veryUnhealthyDays,
                hazardous_days AS hazardousDays, max_aqi AS maxAqi, median_aqi AS medianAqi,
                days_ozone AS daysOzone, days_pm25 AS daysPm25, source_url AS sourceUrl
         FROM county_air_quality WHERE fips = ?`
      ).get(req.params.fips) as any;
      res.json(row ?? null);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "air-quality failed" });
    }
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
      const { lookupWholesalePrice } = await import("../ingest/wholesale_price.js");
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
      const { inspectCounty } = await import("../ingest/osm_parcels.js");
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
      const { waterStressForState } = await import("../ingest/water_stress.js");
      const ws = waterStressForState(county.state);
      res.json({ fips: req.params.fips, state: county.state, waterStress: ws });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "water-stress failed" });
    }
  });

  // ---- ISO queue history (Gap 5: withdrawal / study status tracking) ----
  app.get("/api/counties/:fips/queue-history", async (req, res) => {
    try {
      const { queueHistoryForCounty } = await import("../ingest/iso_queue_history.js");
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
      const { transmissionLinesInBbox } = await import("../ingest/hifld_transmission.js");
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

}
