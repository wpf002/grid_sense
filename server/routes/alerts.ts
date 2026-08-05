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

export function registerAlerts(app: Express) {
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

}
