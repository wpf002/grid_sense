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
import { loadOperatorDicts } from "./_helpers";

export function registerSignals(app: Express) {
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

}
