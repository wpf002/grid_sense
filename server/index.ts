import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { recordRequest, renderPrometheus, logRequest, captureError } from "./observability";
import { verifyApiKey, extractKey } from "./apikeys";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ============================================================================
// Rate limiting — matches the pricing page claim (Free: 60/min, Pro: 600/min)
// Keyed by (IP, tier). Tier is inferred from ?tier= or x-gridsense-plan header.
// Static files, auth, and internal endpoints are exempt.
// ============================================================================
type Bucket = { count: number; windowStart: number };
const RATE_BUCKETS = new Map<string, Bucket>();
const RATE_WINDOW_MS = 60_000;

function planLimit(plan: string): number {
  if (plan === "pro" || plan === "enterprise") return 600;
  return 60;
}

// Prometheus metrics — exposed before rate limiting so a scraper is never
// throttled, and cheap to serve.
app.get("/api/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(renderPrometheus());
});

app.use((req, res, next) => {
  // Only rate-limit public API surface. Skip auth, static, health, and metrics.
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/auth")) return next();
  if (req.path === "/api/heartbeat" || req.path === "/api/metrics") return next();

  // Plan comes from a validated API key when present (non-spoofable). An
  // invalid key is rejected; no key falls back to the anonymous free tier by IP.
  const rawKey = extractKey(req.headers as Record<string, unknown>);
  let plan = "free";
  let rateKey: string;
  if (rawKey) {
    const verified = verifyApiKey(rawKey);
    if (!verified) {
      return res.status(401).json({ message: "Invalid or revoked API key." });
    }
    plan = verified.plan;
    rateKey = `key:${verified.id}`;
  } else {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    rateKey = `ip:${ip}`;
  }
  const key = rateKey;
  const now = Date.now();
  const limit = planLimit(plan);

  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    RATE_BUCKETS.set(key, { count: 1, windowStart: now });
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(limit - 1));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + RATE_WINDOW_MS) / 1000)));
    return next();
  }

  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((bucket.windowStart + RATE_WINDOW_MS) / 1000)));

  if (bucket.count > limit) {
    res.setHeader("Retry-After", String(Math.ceil((bucket.windowStart + RATE_WINDOW_MS - now) / 1000)));
    return res.status(429).json({
      message: `Rate limit exceeded (${limit}/min on ${plan} tier). Upgrade to Pro for 600/min.`,
      upgrade_url: "/pricing",
    });
  }
  return next();
});

// Prune stale buckets every 5 min
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [k, v] of RATE_BUCKETS) if (v.windowStart < cutoff) RATE_BUCKETS.delete(k);
}, 5 * 60_000).unref?.();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Per-request metrics + structured log line. Does NOT dump response bodies
// (avoids leaking data into logs and keeps them small).
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    if (!path.startsWith("/api")) return;
    const ms = Date.now() - start;
    recordRequest(req.method, path, res.statusCode, ms);
    logRequest({ method: req.method, path, status: res.statusCode, ms });
  });
  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    captureError(err, { path: req.path, method: req.method, status });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort is not supported on macOS/Windows (ENOTSUP); enable only on Linux.
  const listenOpts: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform === "linux") {
    listenOpts.reusePort = true;
  }
  httpServer.listen(listenOpts, () => {
    log(`serving on port ${port}`);
  });

  // Keep the daily feeds current so the data-freshness banner reflects reality:
  // pull live news -> signals, snapshot today's scores, and refresh SEC EDGAR
  // shortly after boot (non-blocking) and every 6 hours. Each step is isolated
  // so one failure doesn't block the others, and each records an ingestion_runs
  // entry. Heavy monthly/quarterly ingests (ISO queues, EIA, FEMA) stay manual.
  // Opt out with GRIDSENSE_DISABLE_NEWS_REFRESH=1 (e.g. offline dev).
  if (process.env.GRIDSENSE_DISABLE_NEWS_REFRESH !== "1" && process.env.NODE_ENV !== "test") {
    const refreshLiveData = async () => {
      try {
        const { refreshNewsSignals } = await import("./ingest/refresh_news_signals");
        const r = await refreshNewsSignals();
        log(`news refresh: fetched ${r.fetched}, +${r.signalsAdded} signals`, "ingest");
      } catch (e: any) {
        log(`news refresh failed: ${e?.message ?? e}`, "ingest");
      }
      try {
        const { ingestScoreHistory } = await import("./ingest/score_history");
        const r = await ingestScoreHistory();
        log(`score snapshot: ${r.rows} counties`, "ingest");
      } catch (e: any) {
        log(`score snapshot failed: ${e?.message ?? e}`, "ingest");
      }
      try {
        const { ingestEdgar } = await import("./ingest/edgar");
        const { beginRun } = await import("./ingest/util");
        const run = beginRun("sec_edgar", "SEC EDGAR full-text search");
        try {
          const r = await ingestEdgar();
          run.complete(r.inserted, `${r.inserted} filings`);
          log(`edgar refresh: ${r.inserted} filings`, "ingest");
        } catch (e) {
          run.fail(e);
          throw e;
        }
      } catch (e: any) {
        log(`edgar refresh failed: ${e?.message ?? e}`, "ingest");
      }
    };
    setTimeout(refreshLiveData, 4000).unref?.();
    setInterval(refreshLiveData, 6 * 60 * 60_000).unref?.();
  }

  // Heavier sources (ISO queues, wholesale prices, parcels, permits, the federal
  // datasets) refresh on their own cadences, driven by when each last succeeded.
  // A cloud runner can't write to this machine's data.db, so this — not the
  // GitHub Actions workflow — is what actually keeps the served data current.
  // Opt out with GRIDSENSE_DISABLE_SCHEDULER=1.
  if (process.env.GRIDSENSE_DISABLE_SCHEDULER !== "1" && process.env.NODE_ENV !== "test") {
    const { startScheduler } = await import("./ingest/scheduler");
    startScheduler();
  }
})();
