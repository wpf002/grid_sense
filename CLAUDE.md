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

- **Frontend**: React 18.3.1 + Vite + Tailwind v3 + shadcn/ui + wouter (hash routing) + TanStack Query v5 + Recharts + Leaflet + us-atlas/topojson-client
- **Backend**: Express + Drizzle ORM + better-sqlite3 (synchronous)
- **Auth**: bcryptjs + httpOnly session cookies (single admin user by default, seeded demo users for the Admin panel)
- **Deploy**: single Node process, `dist/index.cjs` serves both API and the built SPA on port 5000

## Critical gotchas — read before touching code

1. **React must stay pinned at 18.3.1.** Several radix + shadcn packages resolve peer deps against 18.x. When you install anything, use `npm install --legacy-peer-deps`. Do not upgrade to React 19 without a full audit — it will silently break Radix components.
2. **Hash routing is mandatory.** The app is served from `/computer/a/...` iframes in the original hosting environment; wouter uses `useHashLocation`. Router shape is:
   ```tsx
   <Router hook={useHashLocation}>
     <Switch>...</Switch>
   </Router>
   ```
   `hook` goes on `<Router>`, NOT on `<Switch>`. Do not use `<a href="#anchor">` for in-page navigation — hash routing intercepts it. Use `document.getElementById(...).scrollIntoView()` for section scrolls.
3. **No localStorage / sessionStorage / cookies from the client** other than the httpOnly session cookie set by the server. The original sandbox blocked storage APIs; keeping this constraint means the app remains portable to iframes and privacy-strict environments. Use React state, TanStack Query cache, and the backend DB.
4. **better-sqlite3 is synchronous.** Every Drizzle query terminates in `.get()`, `.all()`, or `.run()`. Do not destructure query builders directly (`const [row] = db.select()...` will not work). SQLite has no array columns — lists are stored as JSON text and parsed in app code.
5. **`text-xl` is the max heading size** anywhere in the app. Nothing uses `text-2xl` or above.
6. **API calls must use `apiRequest` from `@/lib/queryClient`.** Raw `fetch()` breaks the `__PORT_5000__` proxy substitution used at deploy time. Query keys are arrays (e.g. `['/api/counties', id]`), never template strings.
7. **Forms use shadcn `<Form>` + react-hook-form + zod resolvers** against insert schemas from `@shared/schema.ts`. `<SelectItem value="...">` must always have a non-empty `value`.
8. **All interactive elements have `data-testid`** for future Playwright coverage. Follow `{action}-{target}` for actions and `{type}-{content}` for displays, with a unique suffix for dynamic rows.

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
│       ├── lib/queryClient.ts # apiRequest wrapper + __PORT_5000__ handling
│       ├── hooks/            # useToast, useAuth, custom data hooks
│       └── pages/            # 30 route pages (see routes list below)
├── server/
│   ├── index.ts              # Express + rawBody capture + registerRoutes + serveStatic
│   ├── routes.ts             # 67 API routes (single file today — split when it exceeds 2k lines)
│   ├── storage.ts            # IStorage + Drizzle implementation
│   ├── scoring.ts            # computeCountyFactorsV5 + landing probability + tier assignment
│   ├── auth.ts               # bcrypt + session cookie + admin middleware
│   ├── exports.ts            # /api/exports/counties (CSV/JSON, filters + row cap)
│   ├── mailer.ts             # nodemailer SMTP for alert emails
│   ├── static.ts             # SPA static serve in prod
│   ├── vite.ts               # Vite dev middleware
│   ├── seed-data.ts          # Deterministic seeder for counties, signals, operators
│   └── ingest/               # One module per data source
│       ├── run_all.ts        # Orchestrator: pass source names as CLI args
│       ├── overlay.ts        # Warms real-data overlays used by scoring
│       ├── score_history.ts  # Nightly snapshot into score_history_daily
│       └── {edgar,eia860,eia861,eia_power_price,ercot_queue,pjm_queue,...}.ts
├── shared/
│   └── schema.ts             # ALL Drizzle table definitions + Zod insert schemas + types
├── scripts/
│   ├── expand_full_us.ts     # Backfill all 3,109 counties from Census
│   ├── seed_users_and_runs.ts # 10 demo users + 356 ingestion_runs across 30 days
│   ├── seed_operators.ts, seed_parcels.ts, seed_permits_bids.ts, seed_site_intel.ts
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

1. `computeCountyFactorsV5(county, overlay)` → 12 factor scores 0–100 with data-quality tag (`real` | `partial` | `synthetic`)
2. Weighted sum via `FACTOR_WEIGHTS` → base score
3. `computeSignalBoost(signals)` → 0–15 pt boost from recent filings/news
4. `computeLandingProbability(county, overlay, signals)` → sigmoid over base + boost
5. `scoreTierFor(p)` → `hot` | `warm` | `emerging` | `cold`

Overlays are warmed by `warmOverlayCaches()` on server start (see `server/ingest/overlay.ts`).

## API surface

67 routes, all under `/api/*`. Full catalog is `server/routes.ts`. Notable groups:

- **Core reads**: `/api/counties`, `/api/counties/:id`, `/api/counties/:id/history`, `/api/counties/:id/factors`, `/api/counties/:id/signals`
- **Search & aggregation**: `/api/search`, `/api/tiers`, `/api/movers`, `/api/comps/:id`
- **Signals & filings**: `/api/signals`, `/api/edgar`, `/api/news`, `/api/permits`, `/api/parcels`, `/api/bids`
- **User features**: `/api/auth/*`, `/api/watchlists`, `/api/alert-subscriptions`, `/api/alert-subscriptions/evaluate`, `/api/webhooks/*` (HMAC-SHA256 signed delivery)
- **Ops**: `/api/health`, `/api/admin/stats`, `/api/admin/ingestion-runs`, `/api/exports/counties?tier=&state=&iso=&min_score=&format=csv|json`
- **Backtest & data quality**: `/api/backtest`, `/api/data-quality`

Everything hits real SQLite. There are zero mocks in the codebase and zero TODO/STUB/FIXME markers.

## Pages (30)

Dashboard, Counties, CountyDetail, MapView, Watchlists, Alerts, Signals, Movers, Digest, Backtest, LeadGen, Portfolio, Parcels, Permits, CompetitiveBids, Operators, ShellLLCs, DataQuality, Methodology, ApiDocs, Webhooks, Admin, Auth (Login/Signup), Settings, Pricing, About, Landing, Changelog, NotFound.

`App.tsx` registers all of them under `<Router hook={useHashLocation}>`.

## Cron / scheduled ingestion

The Perplexity Computer version ran these via a cron system:

- **Daily 03:00 CT** — `npx tsx server/ingest/score_history.ts` — nightly score snapshot
- **Daily 06:00 CT** — SEC EDGAR full-text search + Data Center Dynamics RSS, auto-tag against shell-LLC and metro dictionaries
- **Monthly 1st** — ISO queue refresh reminder (7 ISOs)
- **Quarterly** — EIA-860 vintage + FEMA NRI update check

**For Claude Code, replace these with a real scheduler:**

- Option A: **GitHub Actions** — cheapest, `.github/workflows/nightly.yml` running `npx tsx server/ingest/run_all.ts <sources>` on a `schedule:` trigger, with a `DATABASE_URL` secret. Runners have 6-hour timeouts, plenty for full ingest.
- Option B: **A dedicated cron server** — Fly.io machine or Railway cron job.
- Option C: **Temporal** if you outgrow single-shot crons.

Full endpoint list and the exact SEC EDGAR / DCD URLs + shell-LLC dictionary are preserved in the original cron descriptions — reproduce them in the new scheduler config.

## What's still missing for "professional-grade v2"

The v1 surface is complete. These are the deep-codebase tasks best done in Claude Code:

1. **Postgres migration.** SQLite is fine for single-node demo; a real customer deployment needs Postgres. Steps: swap `better-sqlite3` for `pg` + `drizzle-orm/node-postgres`, convert every `.get()`/`.all()`/`.run()` (they become async), rewrite JSON-text columns to real `jsonb`, add proper indexes on `counties.state`, `signals.county_id`, `score_history_daily.county_id + snapshot_date`, and set up `drizzle-kit migrate` for versioned migrations.
2. **Real auth.** Today: bcrypt + httpOnly cookies + a single admin. Add: Stripe billing (`/api/webhooks/stripe`), tiered plans (free/pro/enterprise), SSO via `@auth/express` or Clerk, per-plan rate limiting on `/api/exports/*`.
3. **Test coverage.** No tests today — biggest gap. Suggested: Vitest for `server/scoring.ts` (deterministic, high-value), Supertest for route contracts, Playwright for the 5 most-visited pages. Aim for scoring at 90%+, routes at 70%+.
4. **Observability.** Sentry for errors, structured logging via `pino`, `/api/metrics` in Prometheus format.
5. **CI/CD.** GitHub Actions running `npm run check` (tsc), tests, then build + deploy to Fly/Vercel/Railway on main.
6. **Split `server/routes.ts`.** It's 1,529 lines. Break into `routes/{counties,signals,auth,webhooks,exports,admin,alerts}.ts`, each calling `registerX(app)` from `server/routes/index.ts`.
7. **Rate limiting + API keys.** Public API needs per-key quotas and a keys table. Signed webhook payloads already exist; add signed API-key auth headers.
8. **Real data provider contracts.** Public SEC/EIA feeds are fine to start; production customers will want paid CoreLogic parcels, Regrid, or county-assessor feeds.
9. **SOC 2 prep** if selling to enterprise: audit logging on every mutation, IP-restricted admin, encrypted-at-rest DB, backup rotation.

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

## Things NOT to do

- Do not add localStorage/sessionStorage/cookies from the client.
- Do not upgrade React to 19 without a full radix audit.
- Do not use raw `fetch()` in the client — always `apiRequest`.
- Do not use `<a href="#section">` — hash router intercepts it.
- Do not put `hook` on `<Switch>` — it belongs on `<Router>`.
- Do not remove `--legacy-peer-deps` from install commands.
- Do not commit `data.db*`, `.env`, or `node_modules`.
- Do not exceed `text-xl` for any heading.

## Recommended first PRs in Claude Code

1. **Add Vitest + write tests for `server/scoring.ts`.** Highest ROI. Deterministic input/output.
2. **Split `server/routes.ts` into route modules.** No behavior change, just organization.
3. **Add Sentry + `pino` + a `/api/metrics` endpoint.**
4. **Wire GitHub Actions** for `check` + tests + build on every PR.
5. Then start on Postgres.

## References inside the repo

- `server/routes.ts` — full endpoint catalog
- `shared/schema.ts` — canonical data model
- `server/scoring.ts` — scoring model V5
- `server/ingest/run_all.ts` — how to add a new data source
- `client/src/App.tsx` — page registry
- `client/src/components/CommandPalette.tsx` + `KeyboardShortcuts.tsx` — global UX
- `client/src/pages/ApiDocs.tsx` — public API examples (cURL, TypeScript, Python)

Good luck. Ship it.
