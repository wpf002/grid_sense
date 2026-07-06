import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

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

app.use((req, res, next) => {
  // Only rate-limit public API surface. Skip auth, static, and health.
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/auth")) return next();
  if (req.path === "/api/heartbeat") return next();

  const plan = String(req.headers["x-gridsense-plan"] ?? req.query.tier ?? "free").toLowerCase();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const key = `${ip}:${plan}`;
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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

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
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
