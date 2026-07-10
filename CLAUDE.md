# GridSense — Claude Code Handoff

Welcome. This file is written for you (Claude Code) so you can be productive in this repo in minutes. Read it end-to-end before making changes.

## What this app is

**GridSense** is an AI-data-center land-radar. It scores all 3,109 US counties for suitability as hyperscale data-center sites by fusing:

- ISO interconnection queues (PJM, MISO, ERCOT, ISO-NE, SPP, CAISO, NYISO)
- Utility & generator data (EIA-860, EIA-861, EIA power price)
- Transmission (HIFLD), water (USGS + water stress), land (USDA RUCC + land use)
- Fiber / peering density (PeeringDB, FCC BDC)
- Natural hazards (FEMA National Risk Index)
- Shell-LLC filings tied to hyperscalers (SEC EDGAR full-text search)
- Local permits, parcels, and news signals

Output: per-county score (0–100), tier (hot/warm/emerging/cold), factor breakdown, landing probability, and alerting for material changes.

Users: hyperscaler siting teams, data-center REITs, industrial land brokers, and public-utility analysts.

## Stack

- **Frontend**: React 18.3.1 + Vite + Tailwind v3 + shadcn/ui + wouter (real browser routing) + TanStack Query v5 + Recharts + Leaflet + us-atlas/topojson-client
- **Backend**: Express + Drizzle ORM + better-sqlite3 (synchronous)
- **Auth**: bcryptjs + httpOnly session cookies (single admin user by default, seeded demo users for the Admin panel)
- **Deploy**: single Node process, `dist/index.cjs` serves both API and the built SPA on port 5000

## Critical gotchas — read before touching code

1. **React must stay pinned at 18.3.1.** Several radix + shadcn packages resolve peer deps against 18.x. When you install anything, use `npm install --legacy-peer-deps`. Do not upgrade to React 19 without a full audit — it will silently break Radix components.
2. **Routing is real browser History routing (no hash hook).** wouter's `<Router>` uses its default location hook — real paths like `/counties`, not `/#/counties`. This used to be hash-based because the app was served from `/computer/a/...` iframes in an earlier hosting environment; that constraint no longer applies. `<Router>` must wrap the ENTIRE app tree — sidebar, command palette, and routed pages alike — not just the `<Switch>`, or components outside it fall back to a different location context and navigation silently breaks (this exact bug shipped once; see git history). Both `server/vite.ts` (dev) and `server/static.ts` (prod) already serve `index.html` on any unmatched path, so direct loads/refreshes on a real route work.
3. **localStorage / sessionStorage are fine to use now** if a feature genuinely needs client-only persistence (e.g. a UI preference) — this is a regular browser app, not an iframe sandbox. The httpOnly session cookie remains the only mechanism for auth state.
4. **better-sqlite3 is synchronous.** Every Drizzle query terminates in `.get()`, `.all()`, or `.run()`. Do not destructure query builders directly (`const [row] = db.select()...` will not work). SQLite has no array columns — lists are stored as JSON text and parsed in app code.
5. **`text-xl` is the max heading size** anywhere in the app. Nothing uses `text-2xl` or above.
6. **API calls must use `apiRequest` from `@/lib/queryClient`.** It centralizes error handling (`throwIfResNotOk`) and keeps query keys consistent. Query keys are arrays (e.g. `['/api/counties', id]`), never template strings. Frontend and API are same-origin (one Express process), so URLs are plain relative paths — no base-path rewriting needed.
7. **Forms use shadcn `<Form>` + react-hook-form + zod resolvers** against insert schemas from `@shared/schema.ts`. `<SelectItem value="...">` must always have a non-empty `value`.
8. **All interactive elements have `data-testid`** for future Playwright coverage. Follow `{action}-{target}` for actions and `{type}-{content}` for displays, with a unique suffix for dynamic rows.
9. **Never trust an external feed's units.** County assessor layers publish acreage in acres, square feet, OR square metres under indistinguishable field names. A parcel ingest once compared raw square footage against a 20–5,000 *acre* filter and silently rejected every row in six counties — it looked like six dead endpoints for weeks. All such conversions now live in `server/ingest/units.ts` with regression tests. Put new ones there, not inline.
10. **Title Case for every heading, title, and nav label** (acronyms stay uppercase). Machine-cased enum values get run through `humanize()` from `@/lib/utils` before display. Copy should read like a person wrote it — no buzzwords, no "leverage", no "powered by AI".
11. **Don't suggest deploy, hosting, or billing.** This project is in active development. Do not raise Stripe, Fly, Vercel, or go-live infra unless explicitly asked.

## Layout

```
gridsense/
├── client/
│   ├── index.html            # <link> tags for favicon, apple-touch-icon, og-image
│   ├── public/               # us-states-10m.json, apple-touch-icon.svg, favicon.svg, og-image.svg, sitemap.xml
│   └── src/
│       ├── App.tsx           # Router + KeyboardShortcuts + CommandPalette
│       ├── main.tsx          # ReactDOM entry
│       ├── index.css         # Tailwind + CSS vars (HSL H S% L% form)
│       ├── components/       # USMap, CommandPalette, KeyboardShortcuts, layout, Radix wrappers
│       ├── lib/queryClient.ts # apiRequest wrapper (relative-URL fetch + error handling)
│       ├── hooks/            # useToast, useAuth, custom data hooks
│       └── pages/            # 34 page components (some are tab hosts, not routes)
├── server/
│   ├── index.ts              # Express + rawBody capture + registerRoutes + serveStatic
│   ├── routes.ts             # 75 API routes (single file today — split when it exceeds 2k lines)
│   ├── storage.ts            # IStorage + Drizzle implementation
│   ├── scoring.ts            # computeCountyFactorsV5 + landing probability + tier assignment
│   ├── auth.ts               # bcrypt + session cookie + admin middleware
│   ├── exports.ts            # /api/exports/counties (CSV/JSON, filters + row cap)
│   ├── mailer.ts             # nodemailer SMTP for alert emails
│   ├── static.ts             # SPA static serve in prod
│   ├── vite.ts               # Vite dev middleware
│   ├── apikeys.ts            # API-key auth; plan-based rate limits live in index.ts
│   ├── seed-data.ts          # Deterministic seeder for counties, signals, operators
│   ├── scoring.test.ts, routes.test.ts, headroom.test.ts, edgar-attribution.test.ts
│   └── ingest/               # One module per data source (30+)
│       ├── run_all.ts        # Orchestrator: pass source names as CLI args
│       ├── overlay.ts        # Warms real-data overlays used by scoring
│       ├── units.ts          # Pure, DB-free conversions — unit-tested (units.test.ts)
│       ├── score_history.ts  # Nightly snapshot into score_history_daily
│       ├── lbnl_queue.ts     # Non-RTO interconnection queue (manual XLSX, see below)
│       ├── wholesale_price.ts # Real hub prices (EIA/ICE + ERCOT DAM)
│       ├── refresh_news_signals.ts # Live RSS -> signals, runs on boot + every 6h
│       └── {edgar,eia860,eia861,eia_power_price,ercot_queue,pjm_queue,...}.ts
├── shared/
│   └── schema.ts             # ALL Drizzle table definitions + Zod insert schemas + types
├── scripts/
│   ├── expand_full_us.ts     # Backfill all 3,109 counties from Census
│   ├── seed_users_and_runs.ts # 10 demo users + 356 ingestion_runs across 30 days
│   ├── seed_operators.ts, seed_parcels.ts, seed_permits_bids.ts, seed_site_intel.ts
│   ├── eval_backtest.ts      # Percentile rank + precision/recall/F1 at score cutoffs
│   ├── purge_synthetic_parcels.ts, purge_synthetic_permits.ts, dedupe_signals.ts
│   └── backfill_empty_counties.ts
├── script/
│   └── build.ts              # esbuild config for dist/index.cjs + Vite build for dist/public
├── data/                     # Reference CSVs, static seed inputs
├── drizzle.config.ts
├── tailwind.config.ts        # darkMode: ["class"], HSL vars from index.css
├── vite.config.ts
├── postcss.config.js
├── components.json           # shadcn config
├── tsconfig.json
└── package.json
```

## Data model highlights

`shared/schema.ts` is the single source of truth for every table and every insert schema. Notable tables:

- `counties` — 3,109 rows, geographic + economic base data
- `county_factors` — per-county factor scores from the V5 scoring model
- `signals` — news, filings, permits, bids feeding the "boost" calculation
- `operators` — hyperscaler + shell-LLC ownership graph
- `raw_edgar_filings`, `raw_dc_news`, `raw_iso_queue`, `raw_eia_generators`, `raw_hifld_transmission` — one raw table per source
- `data_provenance` — row-level lineage: source, run_id, ingested_at, checksum
- `score_history_daily` — nightly snapshot for trend / mover queries
- `users`, `sessions`, `watchlists`, `alert_subscriptions`, `webhooks`, `ingestion_runs`

Add any new field to the schema first, generate a migration in your head (Drizzle-kit `db:push` works but is destructive — prefer explicit ALTER for prod), then update `storage.ts`, then the routes and pages.

## Scoring (V5)

`server/scoring.ts` exports the model. Order of operations:

1. `computeCountyFactorsV5(county, overlay)` → 13 factor scores 0–100 with data-quality tag (`real` | `partial` | `synthetic`)
2. Weighted sum via `FACTOR_WEIGHTS` → base score
3. `computeSignalBoost(signals)` → 0–15 pt boost from recent filings/news
4. `computeLandingProbability(county, overlay, signals)` → sigmoid over base + boost
5. `scoreTierFor(p)` → `hot` (≥75) | `warm` (≥60) | `emerging` (≥45) | `cold`

Overlays are warmed by `warmOverlayCaches()` on server start (see `server/ingest/overlay.ts`).

There is a 14th factor, `powerPrice`, defined but **weighted 0 by default**. A backtest
sweep showed it costs precision: announced counties average $48.64/MWh against $55.00
overall (only 12% cheaper), and PJM is simultaneously the priciest hub and the busiest
data-center market. `GRIDSENSE_POWER_WEIGHT` (0–0.3) turns it on and rescales the other
13 proportionally, preserving their calibrated ratios. Zero-weight factors are filtered
out of `computeCountyFactorsV5`'s output, so the API returns 13 factors.

## API surface

75 routes, all under `/api/*`. Full catalog is `server/routes.ts`. Notable groups:

- **Core reads**: `/api/counties`, `/api/counties/:id`, `/api/counties/:id/history`, `/api/counties/:id/factors`, `/api/counties/:id/signals`
- **Search & aggregation**: `/api/search`, `/api/tiers`, `/api/movers`, `/api/comps/:id`
- **Signals & filings**: `/api/signals`, `/api/edgar`, `/api/news`, `/api/permits`, `/api/parcels`, `/api/bids`
- **User features**: `/api/auth/*`, `/api/watchlists`, `/api/alert-subscriptions`, `/api/alert-subscriptions/evaluate`, `/api/webhooks/*` (HMAC-SHA256 signed delivery)
- **Ops**: `/api/health`, `/api/admin/stats`, `/api/admin/ingestion-runs`, `/api/exports/counties?tier=&state=&iso=&min_score=&format=csv|json`
- **Backtest & data quality**: `/api/backtest`, `/api/data-quality`

Everything hits real SQLite. There are zero mocks in the codebase and zero TODO/STUB/FIXME markers.

**Every row in the database is real.** Synthetic parcels and permits were purged; if a
county has no assessor feed it shows "no parcel data" rather than an invented row. Hold
this line — do not seed placeholder rows to make a page look populated.

## Pages

34 page components in `client/src/pages/`, registered under a single `<Router>` (real
browser routing) wrapping the whole app tree. Several are tab hosts rather than
standalone routes — SignalsHub, SiteIntel, and DataHealth each embed sibling pages as
tabs, so the page count exceeds the route count.

## Scheduled ingestion

Two independent schedulers, because they cover different needs:

**In-process (`server/index.ts`)** — keeps a running instance fresh without any external
infra. On boot (~4s delay) and every 6h it runs the news RSS refresh, EDGAR, and the
score snapshot. This is what actually keeps Latest Signals current.

**GitHub Actions (`.github/workflows/ingest.yml`)** — daily `dc_news,edgar,wholesale_price,enrich,score_history`;
monthly ISO queues; quarterly `eia860,fema_nri,lbnl_queue`. Note the honest caveat in
that file's comments: a cloud runner cannot write to a local `data.db`, so today it
verifies the pipelines still parse their sources rather than updating the served DB.

Add a source by writing `server/ingest/<name>.ts`, wrapping the body in
`beginRun(pipeline, note)` → `run.complete(rows, note)` / `run.fail(err)`, then
registering it in the `PipeName` union in `run_all.ts`.

Two sources need manual input:

- **LBNL "Queued Up"** (non-RTO queue, `lbnl_queue.ts`) — LBNL's download link is
  JS-gated, so it reads `data/lbnl_queue.xlsx` (gitignored) or `LBNL_QUEUE_FILE`. Set
  `LBNL_QUEUE_URL` to that year's XLSX link and the annual refresh is one line.
- **ISO-NE queue** — the export is session-gated and refuses bots. The ingest degrades
  to a 0-row run with a note and keeps prior data rather than failing the whole run.

## Data reality check

Provenance runs about **84% real / 8% partial / 8% synthetic** across all scored factors.
`data_provenance` is rewritten wholesale by `enrich` (it deletes every row first), so it
is the single source of truth for what's real. Two things are known-honest limitations,
already disclosed in the UI:

- **No project-level large-load queue exists publicly.** ERCOT's figure lives only in
  image-based PDFs. FERC docket RM26-4 is forcing disclosure; revisit when it lands.
  Until then `queuedLoadMw` is the **generation** queue, not load — don't relabel it.
- **The backtest has partial label leakage.** Mean percentile is 81.2% with the signal
  boost vs **79.3% factors-only**; the boost is 2.20 pts in announced counties against
  0.06 elsewhere (34×). Only 10 of 36 positives carry a signal. `Backtest.tsx` shows
  both numbers and says so.

## What's still missing for "professional-grade v2"

The v1 surface is complete, tests and CI are in place. Remaining deep-codebase tasks:

1. **Postgres migration.** SQLite is fine for single-node; a real customer deployment needs Postgres. Steps: swap `better-sqlite3` for `pg` + `drizzle-orm/node-postgres`, convert every `.get()`/`.all()`/`.run()` (they become async), rewrite JSON-text columns to real `jsonb`, add indexes on `counties.state`, `signals.county_id`, `score_history_daily.county_id + snapshot_date`, and set up `drizzle-kit migrate`. **Deferred on purpose** — SQLite is not the bottleneck yet.
2. **Broader test coverage.** Vitest covers scoring, headroom, EDGAR attribution, ingest unit conversion, and route contracts (74 tests). Still missing: Playwright on the 5 most-visited pages.
3. **Split `server/routes.ts`.** It's ~1,715 lines, past the 2k threshold soon. Break into `routes/{counties,signals,auth,webhooks,exports,admin,alerts}.ts`, each calling `registerX(app)` from `server/routes/index.ts`.
4. **Observability.** `pino` and `/api/metrics` (Prometheus) exist. Sentry for errors is not wired.
5. **More free county assessor feeds.** `arcgis_parcels.ts` is config-driven — adding a county is one entry. Prefer free county/public feeds; paid providers (Regrid, ATTOM, CoreLogic) are out of budget for a project in development.
6. **SOC 2 prep** if selling to enterprise: audit logging on every mutation, IP-restricted admin, encrypted-at-rest DB, backup rotation.

## How to run locally

```bash
# 1) Install (must use legacy peer deps because of React 18 pinning)
npm install --legacy-peer-deps

# 2) Copy env template and edit
cp .env.example .env
# Set at minimum: GRIDSENSE_ADMIN_PASSWORD, GRIDSENSE_SESSION_SECRET

# 3) Bring up the database — the seed script writes to data.db in the repo root
# For a fresh install, run the expander then seeders in order:
npx tsx scripts/expand_full_us.ts
npx tsx scripts/seed_operators.ts
npx tsx scripts/seed_parcels.ts
npx tsx scripts/seed_permits_bids.ts
npx tsx scripts/seed_site_intel.ts
npx tsx scripts/seed_users_and_runs.ts
# Or, if data.db from the handoff is included, skip this — it's ready.

# 4) Optional: run real ingest against public sources (network required)
npx tsx server/ingest/run_all.ts edgar,dc_news,eia860,fema_nri,enrich

# 5) Dev
npm run dev
# → http://localhost:5000 (Express + Vite on the same port)

# 6) Production build + start
npm run build
NODE_ENV=production node dist/index.cjs
```

## Environment variables

All are read via `process.env` and documented in `.env.example`. Summary:

| Var | Required | Purpose |
|---|---|---|
| `GRIDSENSE_ADMIN_PASSWORD` | yes | bcrypt-hashed at first boot; admin login |
| `GRIDSENSE_SESSION_SECRET` | yes | HMAC secret for session cookies |
| `GRIDSENSE_SITE_PASSWORD` | optional | If set, gates the whole app behind a shared password (useful for private beta) |
| `GRIDSENSE_INSECURE_COOKIE` | dev only | Set to `1` to allow cookies over http |
| `GRIDSENSE_SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` | optional | Enables email alert dispatch |
| `PORT` | optional | Defaults to 5000 |
| `NODE_ENV` | yes for prod | `development` or `production` |
| `GRIDSENSE_POWER_WEIGHT` | optional | 0–0.3. Weight for the `powerPrice` factor. Defaults to 0 (off) — see Scoring. |
| `LBNL_QUEUE_URL` / `LBNL_QUEUE_FILE` | optional | Source for the LBNL non-RTO queue workbook |

## Things NOT to do

- Do not upgrade React to 19 without a full radix audit.
- Do not use raw `fetch()` in the client — always `apiRequest`.
- Do not render `Link`/navigation-using components (sidebar, command palette) outside the top-level `<Router>` — they'll silently use a different location context and clicks won't navigate.
- Do not remove `--legacy-peer-deps` from install commands.
- Do not commit `data.db*`, `.env`, or `node_modules`.
- Do not seed synthetic/placeholder rows to make a page look populated. Empty state is honest; fabricated data is not.
- Do not put unit conversions inline in an ingest — they belong in `server/ingest/units.ts` with a test.
- Do not exceed `text-xl` for any heading.

## Where to start

Done already: Vitest (74 tests), `pino` + `/api/metrics`, GitHub Actions for check + test + build, API keys + rate limiting.

Good next PRs:

1. **Split `server/routes.ts` into route modules.** No behavior change, just organization.
2. **Playwright** on Dashboard, Counties, CountyDetail, MapView, DataHealth.
3. **Add county assessor feeds** to `arcgis_parcels.ts` — one config entry each, biggest data win per line.
4. **Sentry** for error tracking.
5. Postgres, only once SQLite actually hurts.

Run `npm test` before and after any scoring change. `scripts/eval_backtest.ts` prints
mean/median percentile rank and precision/recall/F1 at cutoffs 50/60/70/80 against the
37 FIPS-verified announcements in `dc_announcements` — that is how scoring changes get
accepted or rejected. Weight changes must be justified against it, not asserted.

## References inside the repo

- `server/routes.ts` — full endpoint catalog
- `shared/schema.ts` — canonical data model
- `server/scoring.ts` — scoring model V5
- `server/ingest/run_all.ts` — how to add a new data source
- `client/src/App.tsx` — page registry
- `client/src/components/CommandPalette.tsx` + `KeyboardShortcuts.tsx` — global UX
- `client/src/pages/ApiDocs.tsx` — public API examples (cURL, TypeScript, Python)

Good luck. Ship it.
