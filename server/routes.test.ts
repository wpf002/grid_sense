import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import { registerRoutes } from "./routes";

// Contract tests against the real routes + real data.db. These guard the API
// shape and catch regressions like the /api/admin/stats and
// /api/backtest/announcements 500s found in the page audit.
let app: express.Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
});

describe("core reads", () => {
  it("GET /api/health reports counties", async () => {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.counties).toBeGreaterThan(3000);
  });

  it("GET /api/counties returns a non-empty array", async () => {
    const r = await request(app).get("/api/counties");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(3000);
    expect(r.body[0]).toHaveProperty("fips");
  });

  it("GET /api/counties/:fips returns Loudoun", async () => {
    const r = await request(app).get("/api/counties/51107");
    expect(r.status).toBe(200);
    expect(r.body.fips).toBe("51107");
    expect(r.body.state).toBe("VA");
  });

  it("GET /api/stats returns tier counts", async () => {
    const r = await request(app).get("/api/stats");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalCounties");
  });
});

describe("regression: endpoints fixed in the audit", () => {
  it("GET /api/admin/stats is 200 (was 500: require is not defined)", async () => {
    const r = await request(app).get("/api/admin/stats");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.tables)).toBe(true);
  });

  it("GET /api/backtest/announcements is 200 (was 500: no such column)", async () => {
    const r = await request(app).get("/api/backtest/announcements");
    expect(r.status).toBe(200);
    expect(r.body.summary).toHaveProperty("total");
  });
});

describe("feature endpoints", () => {
  it("GET /api/backtest/precision-recall returns cutoffs", async () => {
    const r = await request(app).get("/api/backtest/precision-recall");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.cutoffs)).toBe(true);
  });

  it("GET /api/edgar/shell-hits returns attributed filings", async () => {
    const r = await request(app).get("/api/edgar/shell-hits");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("byOperator");
    expect(Array.isArray(r.body.hits)).toBe(true);
  });

  it("GET /api/counties/:fips/power-headroom returns a synthesized score", async () => {
    const r = await request(app).get("/api/counties/51107/power-headroom");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("score");
    expect(r.body).toHaveProperty("tier");
    expect(Array.isArray(r.body.drivers)).toBe(true);
  });
});

describe("auth boundaries", () => {
  it("GET /api/user/watchlist requires auth (401)", async () => {
    const r = await request(app).get("/api/user/watchlist");
    expect(r.status).toBe(401);
  });

  it("GET /api/keys is admin-gated (401/403 without session)", async () => {
    const r = await request(app).get("/api/keys");
    expect([401, 403]).toContain(r.status);
  });
});
