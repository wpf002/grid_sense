// Cadence-driven in-process ingest scheduler.
//
// WHY THIS EXISTS: the GitHub Actions workflow runs on a cloud runner that has
// no access to this machine's data.db, so it can only verify that each pipeline
// still parses its source — it cannot refresh the database anyone is reading.
// This scheduler does the actual refreshing, inside the server process that
// owns the DB file.
//
// Each pipeline declares how often it's worth re-fetching. On every tick we ask
// ingestion_runs when it last succeeded and run only what's due, so restarting
// the server doesn't re-pull a quarterly 200 MB workbook. A 0-row success still
// counts as "ran" — otherwise a source that legitimately returns nothing (the
// LBNL workbook when it isn't downloaded yet) would retry on every single tick.

import { sqlite } from "../storage.js";
import { runAll, type PipeName } from "./run_all.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// NOTE: dc_news, edgar, and score_history are deliberately absent — the 6-hour
// live refresh in server/index.ts already owns them. Listing them here would
// double-run them.
//
/** How stale a pipeline's data may get before we re-fetch it. */
const CADENCE_MS: Partial<Record<PipeName, number>> = {
  // Prices move daily; the ICE workbook is a 90-day trailing average.
  wholesale_price: DAY,
  // Assessor and permit portals update on their own slow schedules.
  socrata_permits: 7 * DAY,
  arcgis_parcels: 14 * DAY,
  // ISO queues publish monthly.
  pjm_queue: 30 * DAY,
  miso_queue: 30 * DAY,
  ercot_queue: 30 * DAY,
  spp_queue: 30 * DAY,
  caiso_queue: 30 * DAY,
  nyiso_queue: 30 * DAY,
  isone_queue: 30 * DAY,
  iso_queue_history: 30 * DAY,
  // Federal datasets: annual or slower vintages, checked quarterly.
  eia860: 90 * DAY,
  eia861: 90 * DAY,
  eia_power_price: 90 * DAY,
  fema_nri: 90 * DAY,
  hifld_transmission: 90 * DAY,
  peeringdb: 90 * DAY,
  fcc_bdc: 90 * DAY,
  usgs_water: 90 * DAY,
  usda_land: 90 * DAY,
  usda_rucc: 90 * DAY,
  noaa_climate: 90 * DAY,
  water_stress: 90 * DAY,
  state_incentives: 90 * DAY,
  // LBNL publishes once a year. Needs a manual download (Cloudflare-gated);
  // a no-op run still marks it done, so this won't spin.
  lbnl_queue: 300 * DAY,
};

// Pipelines a user is allowed to force via "Retry Now": every cadence-scheduled
// feed plus the three fast feeds the boot refresh owns. Anything else is
// rejected, so the endpoint can't be coaxed into running an arbitrary name.
const KNOWN_PIPELINES = new Set<string>([
  ...Object.keys(CADENCE_MS),
  "dc_news",
  "edgar",
  "score_history",
]);

/**
 * Can this pipeline be force-run? Only if its recorded name is also a runnable
 * pipe argument. The ingestion_runs table records some names that don't map to
 * a runAll pipe (sec_edgar, score_history_daily, epa_ozone…); those refresh
 * through other paths and must not offer a Retry button that would 409.
 */
export function isRetriable(pipeline: string): boolean {
  return KNOWN_PIPELINES.has(pipeline);
}

/** Last time this pipeline finished without erroring, in epoch ms. */
function lastSuccessAt(pipeline: string): number | null {
  const row = sqlite
    .prepare(
      "SELECT MAX(finished_at) AS t FROM ingestion_runs WHERE pipeline = ? AND status = 'ok' AND finished_at IS NOT NULL",
    )
    .get(pipeline) as { t: number | null } | undefined;
  return row?.t ?? null;
}

export function duePipelines(now = Date.now()): PipeName[] {
  const due: PipeName[] = [];
  for (const [name, cadence] of Object.entries(CADENCE_MS) as [PipeName, number][]) {
    const last = lastSuccessAt(name);
    if (last === null || now - last >= cadence) due.push(name);
  }
  return due;
}

let running = false;

// On a fresh database every pipeline is "due" at once. Running 20+ heavy
// fetches in one tick would hammer every upstream source simultaneously and
// stall boot, so we take a few per tick and let the hourly cadence drain the
// backlog. Steady state is 0-2 due pipelines anyway.
const MAX_PER_TICK = 4;

/**
 * Run whatever is due, then rescore. Rescoring runs whenever anything ingested:
 * enrich rewrites county scores and provenance from the freshly ingested rows,
 * and score_history snapshots the result for the movers/trend queries.
 */
export async function runDueIngests(): Promise<{ ran: PipeName[]; skipped: boolean }> {
  if (running) return { ran: [], skipped: true };
  running = true;
  try {
    const allDue = duePipelines();
    if (!allDue.length) return { ran: [], skipped: false };

    const due = allDue.slice(0, MAX_PER_TICK);
    const deferred = allDue.length - due.length;
    console.log(
      `[scheduler] running ${due.length} due pipeline(s): ${due.join(", ")}` +
        (deferred ? ` (${deferred} more deferred to the next tick)` : ""),
    );
    // runAll already isolates each pipeline, so one failing source can't stop
    // the rest, and each records its own ingestion_runs entry.
    await runAll([...due, "enrich", "score_history"]);
    return { ran: due, skipped: false };
  } finally {
    running = false;
  }
}

/**
 * Force one pipeline to re-run now, then rescore — the manual escape hatch
 * behind the "Retry Now" button. The scheduler already retries a behind feed on
 * the next hourly tick; this just skips the wait. Returns immediately and runs
 * in the background, because an ingest makes network calls and can take a while.
 *
 * Respects the same single-flight guard as the scheduler, so a retry can't
 * collide with an in-progress tick. Only known pipelines can be triggered.
 */
export function triggerPipeline(name: string): { started: boolean; reason?: string } {
  if (!KNOWN_PIPELINES.has(name)) return { started: false, reason: "unknown pipeline" };
  if (running) return { started: false, reason: "an ingest is already running" };
  running = true;
  // Fire-and-forget: the HTTP caller doesn't wait for the fetch to finish.
  (async () => {
    try {
      console.log(`[scheduler] manual retry: ${name}`);
      await runAll([name as PipeName, "enrich", "score_history"]);
    } catch (e: any) {
      console.error(`[scheduler] manual retry ${name} failed: ${e?.message ?? e}`);
    } finally {
      running = false;
    }
  })();
  return { started: true };
}

/**
 * Start the scheduler: once shortly after boot, then hourly. The hourly tick is
 * cheap — it's a few indexed MAX() queries unless something is actually due.
 */
export function startScheduler(): void {
  const tick = () => {
    runDueIngests().catch((e: any) =>
      console.error(`[scheduler] tick failed: ${e?.message ?? e}`),
    );
  };
  setTimeout(tick, 8000).unref?.();
  setInterval(tick, HOUR).unref?.();
}
