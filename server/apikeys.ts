// API keys — real, non-spoofable plan enforcement for the public API.
//
// Before this, the rate-limiter trusted an `x-gridsense-plan` header, which any
// caller could set to "pro". Now a plan comes from a hashed API key: the raw
// key is shown once at creation; only its SHA-256 hash is stored.

import crypto from "node:crypto";
import { sqlite } from "./storage";

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_prefix TEXT NOT NULL,          -- e.g. "gs_live_ab12cd" for display
    key_hash TEXT NOT NULL UNIQUE,     -- sha256 of the full raw key
    plan TEXT NOT NULL DEFAULT 'pro',  -- free | pro | enterprise
    label TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0
  );
`);

export type Plan = "free" | "pro" | "enterprise";

export interface ApiKeyRecord {
  id: number;
  key_prefix: string;
  plan: Plan;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked: number;
}

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Create a key. Returns the RAW key (shown once) plus the stored record. */
export function createApiKey(plan: Plan = "pro", label?: string): { key: string; record: ApiKeyRecord } {
  const raw = `gs_live_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, 14);
  const created_at = new Date().toISOString();
  const info = sqlite
    .prepare("INSERT INTO api_keys (key_prefix, key_hash, plan, label, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(prefix, hash(raw), plan, label ?? null, created_at);
  const record = sqlite.prepare("SELECT id, key_prefix, plan, label, created_at, last_used_at, revoked FROM api_keys WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as ApiKeyRecord;
  return { key: raw, record };
}

/** Verify a raw key. Returns the plan + id, or null if unknown/revoked. */
export function verifyApiKey(raw: string): { id: number; plan: Plan } | null {
  if (!raw || !raw.startsWith("gs_")) return null;
  const row = sqlite
    .prepare("SELECT id, plan, revoked FROM api_keys WHERE key_hash = ?")
    .get(hash(raw)) as { id: number; plan: Plan; revoked: number } | undefined;
  if (!row || row.revoked) return null;
  sqlite.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return { id: row.id, plan: row.plan };
}

export function listApiKeys(): ApiKeyRecord[] {
  return sqlite
    .prepare("SELECT id, key_prefix, plan, label, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at DESC")
    .all() as ApiKeyRecord[];
}

export function revokeApiKey(id: number): boolean {
  const info = sqlite.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id);
  return info.changes > 0;
}

/** Extract a raw key from the Authorization: Bearer or x-api-key header. */
export function extractKey(headers: Record<string, unknown>): string | null {
  const auth = String(headers["authorization"] ?? "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const xk = headers["x-api-key"];
  return xk ? String(xk) : null;
}
