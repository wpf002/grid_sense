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

let _operatorDicts: OperatorDict[] | null = null;
export function loadOperatorDicts(): OperatorDict[] {
  if (_operatorDicts) return _operatorDicts;
  const rows = sqlite
    .prepare("SELECT name, shell_llcs, codenames FROM operators")
    .all() as Array<{ name: string; shell_llcs: string | null; codenames: string | null }>;
  const parse = (s: string | null): string[] => {
    try {
      const v = JSON.parse(s || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  _operatorDicts = rows.map((r) => ({
    name: r.name,
    shellLlcs: parse(r.shell_llcs),
    codenames: parse(r.codenames),
  }));
  return _operatorDicts;
}
