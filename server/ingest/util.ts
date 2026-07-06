// Common utilities for public-data ingestion pipelines.
// Every pipeline records the exact URL fetched + timestamp so users can audit.

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const USER_AGENT = "GridSense/1.1 (research; contact@gridsense.example)";
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const RAW_DIR = "/home/user/workspace/gridsense/data/raw";

if (!existsSync(RAW_DIR)) {
  mkdirSync(RAW_DIR, { recursive: true });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Fetch a URL with proper headers, retries, and disk-caching. Every raw
 * response is snapshotted so we always have a copy of what a source said
 * on a given date — required for provenance transparency.
 */
export async function fetchBuffer(
  url: string,
  opts: { cacheKey?: string; forceRefresh?: boolean; timeoutMs?: number } = {},
): Promise<Buffer> {
  const cacheKey = opts.cacheKey ?? url.replace(/[^a-z0-9]+/gi, "_").slice(0, 120);
  const cachePath = join(RAW_DIR, cacheKey);
  if (!opts.forceRefresh && existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T = any>(url: string, opts: Parameters<typeof fetchBuffer>[1] = {}): Promise<T> {
  const buf = await fetchBuffer(url, opts);
  return JSON.parse(buf.toString("utf-8")) as T;
}

export async function fetchText(url: string, opts: Parameters<typeof fetchBuffer>[1] = {}): Promise<string> {
  const buf = await fetchBuffer(url, opts);
  return buf.toString("utf-8");
}

/**
 * Two-step fetch for ASP.NET / cookie-gated endpoints (ISO-NE IRTT etc.):
 *   1. Prime by fetching seedUrl (sets ASP.NET_SessionId cookie)
 *   2. Fetch targetUrl with those cookies + browser UA + referer
 * Returns the target-response body buffer.
 */
export async function fetchWithSession(
  seedUrl: string,
  targetUrl: string,
  opts: { cacheKey?: string; forceRefresh?: boolean; timeoutMs?: number } = {},
): Promise<Buffer> {
  const cacheKey = opts.cacheKey ?? targetUrl.replace(/[^a-z0-9]+/gi, "_").slice(0, 120);
  const cachePath = join(RAW_DIR, cacheKey);
  if (!opts.forceRefresh && existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    // Step 1: prime the session
    const seed = await fetch(seedUrl, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    // Collect Set-Cookie headers into a Cookie header string
    const setCookies: string[] = [];
    // @ts-ignore Node18 fetch exposes headers.raw() via getSetCookie
    if (typeof (seed.headers as any).getSetCookie === "function") {
      for (const c of (seed.headers as any).getSetCookie()) setCookies.push(c);
    } else {
      const raw = seed.headers.get("set-cookie");
      if (raw) setCookies.push(raw);
    }
    const cookieHeader = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");

    // Step 2: fetch target with cookies + referer
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        Referer: seedUrl,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${targetUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST helper for endpoints that require a JSON body (FCC BDC etc.). Caches
 * response bodies by cacheKey. Never caches error responses.
 */
export async function fetchPost(
  url: string,
  body: any,
  opts: { cacheKey: string; forceRefresh?: boolean; timeoutMs?: number; contentType?: string } = { cacheKey: "post_default" },
): Promise<Buffer> {
  const cachePath = join(RAW_DIR, opts.cacheKey);
  if (!opts.forceRefresh && existsSync(cachePath)) {
    return readFileSync(cachePath);
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        "Content-Type": opts.contentType ?? "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} POST ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

// ---- Ingestion run tracker ----
// Every pipeline invocation gets one row in ingestion_runs for the UI.
import { sqlite } from "../storage.js";

export interface RunHandle {
  id: number;
  complete: (rows: number, note?: string) => void;
  fail: (err: unknown) => void;
}

export function beginRun(pipeline: string, note?: string): RunHandle {
  const now = Date.now();
  const info = sqlite
    .prepare(
      "INSERT INTO ingestion_runs (pipeline, started_at, status, note) VALUES (?, ?, 'running', ?)",
    )
    .run(pipeline, now, note ?? null);
  const id = Number(info.lastInsertRowid);
  return {
    id,
    complete(rows: number, doneNote?: string) {
      sqlite
        .prepare(
          "UPDATE ingestion_runs SET finished_at = ?, status = 'ok', rows = ?, note = COALESCE(?, note) WHERE id = ?",
        )
        .run(Date.now(), rows, doneNote ?? null, id);
    },
    fail(err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sqlite
        .prepare(
          "UPDATE ingestion_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?",
        )
        .run(Date.now(), msg.slice(0, 500), id);
    },
  };
}

export async function withRun<T>(pipeline: string, fn: () => Promise<{ rows: number; note?: string } | number>): Promise<T | null> {
  const run = beginRun(pipeline);
  try {
    const res = await fn();
    const rows = typeof res === "number" ? res : res.rows;
    const note = typeof res === "number" ? undefined : res.note;
    run.complete(rows, note);
    return null;
  } catch (err) {
    run.fail(err);
    console.error(`[ingest ${pipeline}] failed:`, err);
    return null;
  }
}

// State abbrev -> FIPS prefix, for constructing 5-digit county FIPS
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

export const FIPS_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr]),
);
