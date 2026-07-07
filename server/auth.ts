// Gap 11 + 16 — Session-based auth with per-user watchlist & email alerts.
// Uses bcryptjs for password hashing and express-session (memory store).
// httpOnly cookie transmits the session id; the frontend never touches it.
// Falls back to an "admin" account when GRIDSENSE_ADMIN_PASSWORD is set —
// this satisfies Gap 16 (basic single-user protection for deployed sites).

import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "node:crypto";
import { sqlite } from "./storage.js";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    email?: string;
  }
}

export interface User {
  id: number;
  email: string;
  created_at: string;
}

function ensureSchema() {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS user_watchlist (
      user_id INTEGER NOT NULL,
      fips TEXT NOT NULL,
      note TEXT,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, fips)
    )
  `).run();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS user_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fips TEXT,
      operator TEXT,
      trigger_kind TEXT NOT NULL,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS user_saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    )
  `).run();
}

export function registerAuth(app: Express) {
  ensureSchema();

  const secret = process.env.GRIDSENSE_SESSION_SECRET || "gridsense-dev-secret-change-me";
  app.use(
    session({
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === "production" && process.env.GRIDSENSE_INSECURE_COOKIE !== "1",
      },
    }),
  );

  // ---- Optional site-wide basic gate (Gap 16). Set GRIDSENSE_SITE_PASSWORD.
  // If the env is set, unauthenticated requests to non-auth /api routes get 401.
  // Static files still load so the login page works.
  const sitePassword = process.env.GRIDSENSE_SITE_PASSWORD;
  if (sitePassword) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith("/api")) return next();
      if (req.path.startsWith("/api/auth") || req.path === "/api/health") return next();
      if (req.session?.userId) return next();
      res.status(401).json({ error: "auth required", authGate: true });
    });
  }

  // Which SSO providers are configured (for the login UI).
  app.get("/api/auth/providers", (_req: Request, res: Response) => {
    res.json({ google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
  });

  // ---- Google SSO (optional). Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
  // Redirect URI defaults to localhost:5050; override with GOOGLE_REDIRECT_URI.
  // Harmless no-op until the env vars are present.
  const gClientId = process.env.GOOGLE_CLIENT_ID;
  const gSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (gClientId && gSecret) {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5050/api/auth/google/callback";
    app.get("/api/auth/google", (req: Request, res: Response) => {
      const state = crypto.randomBytes(16).toString("hex");
      (req.session as any).oauthState = state;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", gClientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    });
    app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
      try {
        const { code, state } = req.query;
        if (!code || state !== (req.session as any).oauthState) {
          return res.status(400).send("invalid oauth state");
        }
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: String(code), client_id: gClientId, client_secret: gSecret,
            redirect_uri: redirectUri, grant_type: "authorization_code",
          }),
        });
        const token = (await tokenRes.json()) as { access_token?: string };
        if (!token.access_token) return res.status(400).send("token exchange failed");
        const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const ui = (await uiRes.json()) as { email?: string };
        if (!ui.email) return res.status(400).send("no email from google");
        let user = sqlite.prepare("SELECT id, email FROM users WHERE email = ?").get(ui.email) as { id: number; email: string } | undefined;
        if (!user) {
          const r = sqlite.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(ui.email, "sso:google");
          user = { id: Number(r.lastInsertRowid), email: ui.email };
        }
        req.session.userId = user.id;
        req.session.email = user.email;
        res.redirect("/#/");
      } catch (e: any) {
        res.status(500).send("sso failed: " + e.message);
      }
    });
  }

  // ---- Auth API ----
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const body = z.object({
        email: z.string().email(),
        password: z.string().min(8, "password must be 8+ chars"),
      }).parse(req.body);

      const existing = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(body.email);
      if (existing) return res.status(409).json({ error: "email already registered" });

      const hash = await bcrypt.hash(body.password, 10);
      const result = sqlite
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run(body.email, hash);

      req.session.userId = Number(result.lastInsertRowid);
      req.session.email = body.email;
      res.json({ id: result.lastInsertRowid, email: body.email });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const body = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }).parse(req.body);

      // Env-configured "admin" shortcut — used by the daily cron & bootstrapped auth.
      const adminPw = process.env.GRIDSENSE_ADMIN_PASSWORD;
      if (adminPw && body.email === "admin@gridsense.local" && body.password === adminPw) {
        req.session.userId = 0;
        req.session.email = "admin@gridsense.local";
        return res.json({ id: 0, email: "admin@gridsense.local", role: "admin" });
      }

      const user: any = sqlite
        .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
        .get(body.email);
      if (!user) return res.status(401).json({ error: "invalid credentials" });

      const ok = await bcrypt.compare(body.password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "invalid credentials" });

      req.session.userId = user.id;
      req.session.email = user.email;
      res.json({ id: user.id, email: user.email });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- One-click demo login. Provisions and signs in a demo user on first call.
  app.post("/api/auth/demo", async (req: Request, res: Response) => {
    try {
      const email = "demo@gridsense.app";
      let user: any = sqlite.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
      if (!user) {
        const hash = await bcrypt.hash("demo-" + Math.random().toString(36).slice(2), 10);
        const result = sqlite
          .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
          .run(email, hash);
        user = { id: Number(result.lastInsertRowid), email };

        // Seed watchlist with the top hot counties so first-run has content.
        const hotFips: any[] = sqlite
          .prepare("SELECT fips FROM counties WHERE score_tier IN ('hot','warm') ORDER BY landing_probability DESC LIMIT 6")
          .all();
        const insertW = sqlite.prepare("INSERT OR IGNORE INTO user_watchlist (user_id, fips, note) VALUES (?, ?, ?)");
        for (const row of hotFips) insertW.run(user.id, row.fips, "Seeded from demo tour");

        // Seed one alert & one saved search so those pages have content on first load.
        sqlite
          .prepare("INSERT INTO user_alerts (user_id, fips, operator, trigger_kind, email_enabled) VALUES (?,?,?,?,1)")
          .run(user.id, null, null, "score_jump_5pts");
        sqlite
          .prepare("INSERT OR IGNORE INTO user_saved_searches (user_id, name, filters_json) VALUES (?,?,?)")
          .run(user.id, "Hot Texas counties", JSON.stringify({ state: "TX", tier: ["hot", "warm"] }));
      }
      req.session.userId = user.id;
      req.session.email = user.email;
      res.json({ id: user.id, email: user.email, demo: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (!req.session?.userId && req.session?.userId !== 0) return res.json({ user: null });
    res.json({ user: { id: req.session.userId, email: req.session.email } });
  });

  // ---- Per-user watchlist ----
  app.get("/api/user/watchlist", requireAuth, (req: Request, res: Response) => {
    // Enrich each row with today's snapshot delta versus yesterday, if available.
    const rows = sqlite
      .prepare(`
        SELECT w.fips, w.note, w.added_at,
               c.name, c.state, c.landing_probability AS score, c.score_tier AS tier,
               c.queued_load_mw, c.iso, c.utility,
               (
                 SELECT sh.score FROM score_history_daily sh
                  WHERE sh.fips = w.fips
                  ORDER BY sh.snapshot_date DESC LIMIT 1
               ) AS score_today_snap,
               (
                 SELECT sh.score FROM score_history_daily sh
                  WHERE sh.fips = w.fips
                  ORDER BY sh.snapshot_date DESC LIMIT 1 OFFSET 1
               ) AS score_yesterday_snap
          FROM user_watchlist w
          LEFT JOIN counties c ON c.fips = w.fips
         WHERE w.user_id = ?
         ORDER BY w.added_at DESC
      `)
      .all(req.session.userId) as any[];
    const enriched = rows.map((r) => ({
      ...r,
      dayDelta: r.score_today_snap != null && r.score_yesterday_snap != null
        ? Number(r.score_today_snap) - Number(r.score_yesterday_snap)
        : null,
    }));
    res.json(enriched);
  });

  app.post("/api/user/watchlist", requireAuth, (req: Request, res: Response) => {
    try {
      const body = z.object({ fips: z.string(), note: z.string().nullable().optional() }).parse(req.body);
      sqlite
        .prepare("INSERT OR REPLACE INTO user_watchlist (user_id, fips, note) VALUES (?, ?, ?)")
        .run(req.session.userId, body.fips, body.note ?? null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/user/watchlist/:fips", requireAuth, (req: Request, res: Response) => {
    sqlite
      .prepare("DELETE FROM user_watchlist WHERE user_id = ? AND fips = ?")
      .run(req.session.userId, req.params.fips);
    res.json({ ok: true });
  });

  // ---- Per-user alert subscriptions ----
  app.get("/api/user/alerts", requireAuth, (req: Request, res: Response) => {
    const rows = sqlite
      .prepare("SELECT * FROM user_alerts WHERE user_id = ? ORDER BY created_at DESC")
      .all(req.session.userId);
    res.json(rows);
  });

  app.post("/api/user/alerts", requireAuth, (req: Request, res: Response) => {
    try {
      const body = z.object({
        fips: z.string().nullable().optional(),
        operator: z.string().nullable().optional(),
        trigger_kind: z.string(),
        email_enabled: z.boolean().default(true),
      }).parse(req.body);
      const r = sqlite
        .prepare(`
          INSERT INTO user_alerts (user_id, fips, operator, trigger_kind, email_enabled)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(req.session.userId, body.fips ?? null, body.operator ?? null, body.trigger_kind, body.email_enabled ? 1 : 0);
      res.json({ id: r.lastInsertRowid });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/user/alerts/:id", requireAuth, (req: Request, res: Response) => {
    sqlite
      .prepare("DELETE FROM user_alerts WHERE user_id = ? AND id = ?")
      .run(req.session.userId, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Per-user saved searches ----
  app.get("/api/user/saved-searches", requireAuth, (req: Request, res: Response) => {
    const rows = sqlite
      .prepare("SELECT id, name, filters_json, created_at FROM user_saved_searches WHERE user_id = ? ORDER BY created_at DESC")
      .all(req.session.userId) as any[];
    res.json(rows.map(r => ({ id: r.id, name: r.name, filters: JSON.parse(r.filters_json), created_at: r.created_at })));
  });

  app.post("/api/user/saved-searches", requireAuth, (req: Request, res: Response) => {
    try {
      const body = z.object({
        name: z.string().min(1).max(100),
        filters: z.record(z.any()),
      }).parse(req.body);
      const r = sqlite
        .prepare(`INSERT INTO user_saved_searches (user_id, name, filters_json) VALUES (?, ?, ?)
                  ON CONFLICT(user_id, name) DO UPDATE SET filters_json = excluded.filters_json`)
        .run(req.session.userId, body.name, JSON.stringify(body.filters));
      res.json({ id: r.lastInsertRowid, name: body.name });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/user/saved-searches/:id", requireAuth, (req: Request, res: Response) => {
    sqlite
      .prepare("DELETE FROM user_saved_searches WHERE user_id = ? AND id = ?")
      .run(req.session.userId, Number(req.params.id));
    res.json({ ok: true });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId != null) return next();
  res.status(401).json({ error: "auth required" });
}
