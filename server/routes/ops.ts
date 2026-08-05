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

export function registerOps(app: Express) {
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
      const { isRetriable, staleAfterDays } = await import("../ingest/scheduler.js");
      const withFresh = rows.map(r => {
        const ageMs = now - Number(r.last_started ?? 0);
        const ageDays = ageMs / (86400 * 1000);
        // Behind only if past its own cadence — matches the freshness banner and
        // the scheduler, rather than a flat 8-day rule.
        const stale = ageDays > staleAfterDays(r.pipeline);
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
      const { staleAfterDays } = await import("../ingest/scheduler.js");
      const enriched = rows.map((r) => {
        const ts = Number(r.last_started ?? 0);
        const ageMs = now - ts;
        const ageHours = ageMs / 3_600_000;
        const p = String(r.pipeline);
        // "Behind schedule" means past the feed's OWN refresh cadence — the same
        // table the scheduler uses to decide what to re-run — not a flat cutoff.
        // A quarterly feed at 27 days is on schedule, so it isn't flagged.
        const staleAfterHours = staleAfterDays(p) * 24;
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
      const { triggerPipeline } = await import("../ingest/scheduler.js");
      const result = triggerPipeline(pipeline);
      if (!result.started) return res.status(409).json({ error: result.reason ?? "could not start" });
      res.json({ started: true, pipeline });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "retry failed" });
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
  // In-memory webhook registry, starts empty. Users register their own; we don't
  // seed fake demo entries. (Persist to a table when webhooks graduate past MVP.)
  const WEBHOOKS: Webhook[] = [];

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

}
