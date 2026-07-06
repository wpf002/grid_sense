// Nodemailer transport + alert-rule matcher.
// Runs at the end of the nightly score_history snapshot: reads user_alerts,
// compares yesterday vs. today's score_history_daily, and dispatches emails.
//
// Configure via env:
//   GRIDSENSE_SMTP_HOST, GRIDSENSE_SMTP_PORT, GRIDSENSE_SMTP_USER,
//   GRIDSENSE_SMTP_PASS, GRIDSENSE_SMTP_FROM
// If GRIDSENSE_SMTP_HOST is unset, we log emails to console instead of sending.

import nodemailer from "nodemailer";
import { sqlite } from "./storage.js";

type AlertRow = {
  id: number;
  user_id: number;
  fips: string | null;
  operator: string | null;
  trigger_kind: string;
  email_enabled: number;
  email: string;
};

function transport() {
  const host = process.env.GRIDSENSE_SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.GRIDSENSE_SMTP_PORT || 587),
    secure: Number(process.env.GRIDSENSE_SMTP_PORT || 587) === 465,
    auth: process.env.GRIDSENSE_SMTP_USER
      ? {
          user: process.env.GRIDSENSE_SMTP_USER,
          pass: process.env.GRIDSENSE_SMTP_PASS,
        }
      : undefined,
  });
}

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const from = process.env.GRIDSENSE_SMTP_FROM || "GridSense <no-reply@gridsense.local>";
  const t = transport();
  if (!t) {
    console.log(`[mailer:noop] To=${to} Subject="${subject}"\n${text}\n---`);
    return { ok: true, mode: "noop" as const };
  }
  await t.sendMail({ from, to, subject, html, text });
  return { ok: true, mode: "smtp" as const };
}

/** Return today's + yesterday's snapshots joined by fips. */
function loadDeltas(today: string) {
  return sqlite
    .prepare(
      `SELECT t.fips, c.name, c.state, t.score AS score_today, t.tier AS tier_today,
              y.score AS score_yday, y.tier AS tier_yday,
              (t.score - COALESCE(y.score, t.score)) AS delta
       FROM score_history_daily t
       LEFT JOIN score_history_daily y
         ON y.fips = t.fips
        AND y.snapshot_date = (
          SELECT MAX(snapshot_date) FROM score_history_daily
          WHERE fips = t.fips AND snapshot_date < ?
        )
       LEFT JOIN counties c ON c.fips = t.fips
       WHERE t.snapshot_date = ?`
    )
    .all(today, today) as Array<{
    fips: string;
    name: string;
    state: string;
    score_today: number;
    tier_today: string | null;
    score_yday: number | null;
    tier_yday: string | null;
    delta: number;
  }>;
}

function loadAlerts(): AlertRow[] {
  return sqlite
    .prepare(
      `SELECT a.id, a.user_id, a.fips, a.operator, a.trigger_kind, a.email_enabled, u.email
       FROM user_alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.email_enabled = 1`
    )
    .all() as AlertRow[];
}

const TIER_RANK: Record<string, number> = { cold: 0, emerging: 1, warm: 2, hot: 3 };

function matchAlert(alert: AlertRow, row: ReturnType<typeof loadDeltas>[number]): string | null {
  // per-FIPS scope
  if (alert.fips && alert.fips !== row.fips) return null;

  switch (alert.trigger_kind) {
    case "SCORE_CHANGE": {
      if (Math.abs(row.delta) >= 5) {
        return `Score moved ${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(1)} to ${row.score_today.toFixed(0)}`;
      }
      return null;
    }
    case "TIER_UPGRADE": {
      const a = TIER_RANK[row.tier_yday ?? "cold"] ?? 0;
      const b = TIER_RANK[row.tier_today ?? "cold"] ?? 0;
      if (b > a) return `Tier upgrade: ${row.tier_yday ?? "cold"} → ${row.tier_today ?? "cold"}`;
      return null;
    }
    default:
      return null;
  }
}

export async function dispatchAlerts(today: string) {
  const rows = loadDeltas(today);
  if (rows.length === 0) return { evaluated: 0, sent: 0 };
  const alerts = loadAlerts();
  if (alerts.length === 0) return { evaluated: rows.length, sent: 0 };

  // group hits by user
  const byUser = new Map<string, { rows: Array<{ row: (typeof rows)[number]; msg: string; kind: string }> }>();
  for (const a of alerts) {
    for (const r of rows) {
      const msg = matchAlert(a, r);
      if (!msg) continue;
      const g = byUser.get(a.email) ?? { rows: [] };
      g.rows.push({ row: r, msg, kind: a.trigger_kind });
      byUser.set(a.email, g);
    }
  }

  let sent = 0;
  for (const [email, hits] of byUser) {
    const lines = hits.rows.slice(0, 20).map(
      (h) => `• [${h.kind}] ${h.row.name}, ${h.row.state} — ${h.msg}`
    );
    const html = `<h2>GridSense daily alert (${today})</h2>
      <p>${hits.rows.length} counties matched your alert rules.</p>
      <ul>${hits.rows.slice(0, 20).map((h) => `<li><b>[${h.kind}]</b> ${h.row.name}, ${h.row.state} — ${h.msg}</li>`).join("")}</ul>
      <p style="color:#888;font-size:12px">Manage alerts in GridSense → Account.</p>`;
    const text = `GridSense daily alert (${today})\n${hits.rows.length} matches:\n${lines.join("\n")}`;
    try {
      await sendMail(email, `GridSense: ${hits.rows.length} alert hits (${today})`, html, text);
      sent += 1;
    } catch (e) {
      console.error(`[mailer] failed to send to ${email}:`, e);
    }
  }

  return { evaluated: rows.length, sent };
}
