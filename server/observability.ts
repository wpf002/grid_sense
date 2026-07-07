// Lightweight, dependency-free observability: request metrics (Prometheus
// text format at /api/metrics), structured logging, and a Sentry-ready error
// hook. Kept dep-free so it works in any deploy target; swap in pino/@sentry
// later behind the same interface if desired.

const START = Date.now();

// ---- Metrics ----
const reqTotal = new Map<string, number>(); // "method|routeClass|status" -> count
const durationBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const durationHist = new Map<string, number[]>(); // routeClass -> bucket counts
const durationSum = new Map<string, number>();
const durationCount = new Map<string, number>();
let errorsTotal = 0;

// Normalize a path to a low-cardinality route class so metrics don't explode
// (every /api/counties/48453 must not be its own series).
export function routeClass(path: string): string {
  const parts = path.split("?")[0].split("/").filter(Boolean); // e.g. ["api","counties","48453","factors"]
  return (
    "/" +
    parts
      .map((p) => (/^\d+$/.test(p) || /^[0-9a-f]{8,}$/i.test(p) ? ":id" : p))
      .join("/")
  );
}

export function recordRequest(method: string, path: string, status: number, ms: number): void {
  const rc = routeClass(path);
  const key = `${method}|${rc}|${status}`;
  reqTotal.set(key, (reqTotal.get(key) ?? 0) + 1);
  if (status >= 500) errorsTotal++;

  const h = durationHist.get(rc) ?? new Array(durationBuckets.length + 1).fill(0);
  let placed = false;
  for (let i = 0; i < durationBuckets.length; i++) {
    if (ms <= durationBuckets[i]) { h[i]++; placed = true; break; }
  }
  if (!placed) h[durationBuckets.length]++;
  durationHist.set(rc, h);
  durationSum.set(rc, (durationSum.get(rc) ?? 0) + ms);
  durationCount.set(rc, (durationCount.get(rc) ?? 0) + 1);
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  lines.push("# HELP gridsense_uptime_seconds Process uptime.");
  lines.push("# TYPE gridsense_uptime_seconds gauge");
  lines.push(`gridsense_uptime_seconds ${Math.floor((Date.now() - START) / 1000)}`);

  lines.push("# HELP gridsense_http_requests_total Total HTTP requests.");
  lines.push("# TYPE gridsense_http_requests_total counter");
  for (const [key, n] of reqTotal) {
    const [method, route, status] = key.split("|");
    lines.push(`gridsense_http_requests_total{method="${method}",route="${route}",status="${status}"} ${n}`);
  }

  lines.push("# HELP gridsense_http_errors_total HTTP 5xx responses.");
  lines.push("# TYPE gridsense_http_errors_total counter");
  lines.push(`gridsense_http_errors_total ${errorsTotal}`);

  lines.push("# HELP gridsense_http_request_duration_ms Request duration histogram (ms).");
  lines.push("# TYPE gridsense_http_request_duration_ms histogram");
  for (const [rc, h] of durationHist) {
    let cumulative = 0;
    for (let i = 0; i < durationBuckets.length; i++) {
      cumulative += h[i];
      lines.push(`gridsense_http_request_duration_ms_bucket{route="${rc}",le="${durationBuckets[i]}"} ${cumulative}`);
    }
    cumulative += h[durationBuckets.length];
    lines.push(`gridsense_http_request_duration_ms_bucket{route="${rc}",le="+Inf"} ${cumulative}`);
    lines.push(`gridsense_http_request_duration_ms_sum{route="${rc}"} ${durationSum.get(rc) ?? 0}`);
    lines.push(`gridsense_http_request_duration_ms_count{route="${rc}"} ${durationCount.get(rc) ?? 0}`);
  }
  return lines.join("\n") + "\n";
}

// ---- Structured logging ----
const isProd = process.env.NODE_ENV === "production";

export function logRequest(fields: {
  method: string; path: string; status: number; ms: number;
}): void {
  if (isProd) {
    // One structured JSON line per request — parseable by any log pipeline.
    console.log(JSON.stringify({ level: "info", t: new Date().toISOString(), type: "http", ...fields }));
  } else {
    const t = new Date().toLocaleTimeString("en-US", { hour12: false });
    console.log(`${t} ${fields.method} ${fields.path} ${fields.status} ${fields.ms}ms`);
  }
}

// ---- Error hook (Sentry-ready) ----
// If SENTRY_DSN is set and @sentry/node is installed, wire it here. Absent that,
// we emit a structured error line so nothing is swallowed.
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(JSON.stringify({ level: "error", t: new Date().toISOString(), type: "error", message, stack, ...context }));
  // Placeholder: if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: context });
}
