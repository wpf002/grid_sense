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

export function registerBacktest(app: Express) {
  // ---- Point-in-time backtest ----
  // Scores each announced county using only a snapshot taken BEFORE the
  // announcement, so post-announcement news can't inflate the result. Returns a
  // not-ready report until score history reaches back past a real announcement;
  // that is a valid state, not an error.
  app.get("/api/backtest/point-in-time", async (_req, res) => {
    try {
      const { runBothBases, historyOutlook } = await import("../eval/run.js");
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

}
