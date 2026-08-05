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

export function registerSiteIntel(app: Express) {
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

}
