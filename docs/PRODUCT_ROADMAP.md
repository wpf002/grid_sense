# GridSense — Roadmap to a Professional-Grade Product

Honest current-state review + the path to a fully functioning app that holds up
in a professional workspace. Companion to [DATA_FEEDS_ROADMAP.md](DATA_FEEDS_ROADMAP.md).

---

## 1. Where it stands today — 30-page audit

Every page was read, its API calls traced, and those endpoints hit on a running
server. Verdicts:

- **REAL** — real ingested data + meaningful UI
- **SEEDED-DEMO** — renders fully, but the data is fabricated seed data
- **THIN / STATIC** — functional but empty, or intentionally static (marketing/docs)
- **BROKEN** — errored (both found are now fixed)

| Page | Route | Verdict | Notes |
|------|-------|---------|-------|
| Dashboard | `/` | **REAL** | Real stats, freshness of 25 pipelines |
| MapView | `/map` | **REAL** | All 3,109 counties on Leaflet, scored |
| Counties | `/counties` | **REAL** | Filter/sort/export over real data |
| CountyDetail | `/counties/:fips` | **REAL** | 13+ sub-endpoints, all populated |
| Compare | `/compare` | **REAL** | Side-by-side factor comparison |
| Triggers | `/triggers` | **REAL** | Counties with clustered signals |
| DataQuality | `/data-quality` | **REAL** | 27.6k real / 7.7k synthetic factor tags |
| IngestionRuns | `/ingestion` | **REAL** | Live pipeline run history |
| Heartbeat | `/heartbeat` | **REAL** | Pipeline freshness/staleness |
| LeadGen | `/leadgen` | **REAL** | Real county data + CSV export |
| Portfolio | `/portfolio` | **REAL** | Scores a portfolio on real data |
| Login | `/login` | **REAL** | Single bcrypt admin + demo login works |
| ApiDocs | `/api-docs` | **REAL/STATIC** | cURL/TS/Python examples (appropriate) |
| NotFound | fallback | **REAL** | Trivial 404 |
| Signals | `/signals` | **SEEDED-DEMO** | 3,577 signals; ~95% lack `suspectedOperator` |
| Operators | `/operators` | **SEEDED-DEMO** | Real shell-LLC names, curated not ingested; activity mostly empty |
| Parcels | `/parcels` | **SEEDED-DEMO** | 161 fabricated parcels ("Aligned Data Centers LLC") |
| Permits | `/permits` | **SEEDED-DEMO** | 129 fabricated permits |
| CompetitiveBids | `/competitive` | **SEEDED-DEMO** | 99 fabricated bid rows |
| Digest | `/digest` | **SEEDED-DEMO** | Real structure over seeded permits/bids |
| Webhooks | `/webhooks` | **SEEDED-DEMO** | Demo webhooks; delivery infra is real |
| Landing | `/landing` | **THIN/STATIC** | Marketing; hardcoded stat counts |
| Pricing | `/pricing` | **THIN/STATIC** | Static tiers, not wired to billing |
| Methodology | `/methodology` | **THIN/STATIC** | Static prose (fine) |
| Alerts | `/alerts` | **THIN** | UI wired; 0 alerts generated yet |
| Movers | `/movers` | **THIN** | Needs ≥2 days of score history to populate |
| Watchlist | `/watchlist` | **THIN** | Works; empty (auth-gated, no bookmarks) |
| MyWatchlist | `/my-watchlist` | **THIN** | Auth-gated (401 unauthenticated) |
| Admin | `/admin` | ~~BROKEN~~ **FIXED** | Was `require is not defined` in ESM |
| Backtest | `/backtest` | ~~BROKEN~~ **FIXED** | Was `no such column: c.score` |

**Tally:** 14 REAL · 7 SEEDED-DEMO · 7 THIN/STATIC · 2 fixed this session.

**Verdict:** the *physical/grid spine is genuinely real* (grid, queue, transmission,
hazard, water, fiber, cooling across all counties). The *site-intelligence layer*
(parcels, permits, bids, operator attribution, announcements) is demo scaffolding.
That split — not missing pages — is the gap between "impressive prototype" and
"sellable product."

---

## 2. Data sources we're missing + price points

### 2a. Free public feeds still to add (no cost)

Full detail in [DATA_FEEDS_ROADMAP.md](DATA_FEEDS_ROADMAP.md). Highest value:

| Feed | Unlocks | Cost |
|------|---------|------|
| ✅ NOAA Climate Normals | cooling factor | free (**shipped**) |
| HIFLD gas pipelines + EIA v2 | `gas_access` factor (behind-the-meter) | free |
| EPA eGRID | carbon-intensity factor | free |
| gridstatus OSS / EIA-930 | real nodal LMP + grid load | free |
| EPA Green Book / PAD-US / USFWS | environmental constraint factor | free |
| BLS QCEW + Census ACS + BEA | labor/economic factor | free (key) |
| WRI Aqueduct + US Drought Monitor | upgrade water factor | free |
| NOAA ISD-Lite | free-cooling **hours** (cooling v2) | free |

### 2b. Commercial sources (the real professional-grade gaps)

The seeded layers (parcels, ownership, permits, market comps) have no complete
free national source. Price points for the realistic buys:

**Parcels & ownership**
| Vendor | What | Price point |
|--------|------|-------------|
| **Regrid / Landgrid** | 156M parcels + owner + geometry | API ~**$500–$2,000/mo**; bulk ~**$0.10/parcel** (volume discounts); national bulk = quote |
| **Reonomy** | CRE owner + entity/shell unmasking | ~**$299–$500/mo** per seat |
| **ATTOM Data** | property/parcel API | ~**$1,500+/mo**, quote |
| **CoreLogic** | premium parcel/property | enterprise quote (~**$10k–$50k+/yr**) |
| **LightBox** | parcels + geospatial, enterprise delivery | enterprise quote |

**DC market intelligence** (what competitors sell)
| Vendor | What | Price point |
|--------|------|-------------|
| **datacenterHawk** | leasing/absorption/market | quote-only, est **$15k–$50k/yr** |
| **DC Byte** | facility intelligence, hyperscaler footprints | quote-only enterprise |
| **Baxtel** | facility dataset (planned MW) | snapshot or annual subscription, quote |

**Grid / power analytics**
| Vendor | What | Price point |
|--------|------|-------------|
| **gridstatus.io** (hosted) | normalized ISO LMP/load/queues | free tier 500k rows/mo; paid ~**$500–$2k/mo** (quote) |
| **Hitachi Velocity Suite / S&P Global** | energy data warehouse | enterprise, est **$25k+/yr** |
| **Ascend / Enverus / Nira** | interconnection/nodal analytics | enterprise quote |

**Zoning / location / data-ops**
| Vendor | What | Price point |
|--------|------|-------------|
| **Zoneomics** | parcel-level zoning feasibility | **$61/mo** (Essentials) → **$186/mo** (Advanced) → enterprise |
| **Placer.ai** | foot-traffic/location intel | **$5k–$50k+/yr** |
| **Cherre** | real-estate data-ops platform | **$200k–$1M+/yr** |

**Market read:** transparent SaaS clusters at **$300–$2k/mo self-serve → $5k–$30k/yr
mid-market → $50k–$1M+/yr enterprise**. The DC/grid specialists are all quote-only.
**Cheapest credible path to "real":** Regrid parcels (~$500–$2k/mo) + free public
feeds. That alone de-fakes the parcel layer for target markets.

---

## 3. The roadmap

Phased so each phase leaves the app more shippable than the last. Rough effort in
engineer-weeks; sequence matters more than the estimates.

### Phase 0 — Stabilize ✅ (done this session)
Runs on real Node; green build + CI; 40 tests; portability + 2 broken endpoints
fixed; real ingests lit up; EDGAR attribution, power headroom, cooling factor shipped.

### Phase 1 — Make the data real *(4–6 wks) — the credibility unlock*
1. **One real permit/parcel source.** Spike a county open-data permit feed
   (Socrata SODA or ArcGIS FeatureServer — e.g. a Northern Virginia or Central
   Texas jurisdiction) and write a real `permits`/`parcels` ingest to replace the
   seed. *Note: the research spike to nail exact endpoints was cut off by a rate
   limit — first task is to finish that source scan and pick the cleanest JSON API.*
2. **Real DC announcements → calibrate the model.** Expand `dc_announcements` from
   39 seeded rows to 100+ real ones (Data Center Frontier/DCD/press/econ-dev), then
   tune `FACTOR_WEIGHTS` against them. Current backtest: hit-rate 36%, hit+near 67%
   at score≥70 — a real target to beat.
3. **Free high-ROI factors:** `gas_access` (HIFLD + EIA), `carbon_intensity`
   (eGRID), environmental constraints (Green Book/PAD-US), and **free-cooling
   hours** (ISD-Lite, the cooling-v2 upgrade). Re-balance weights (test guards the sum).
4. **Operator attribution density:** live SEC/news matching to fill
   `suspectedOperator` on signals (today ~95% null).

### Phase 2 — Productionize the platform *(4–6 wks)*
1. **Postgres migration** (SQLite → `pg`/`drizzle-orm/node-postgres`): async calls,
   JSON-text → `jsonb`, indexes on `counties.state`, `signals.county_id`,
   `score_history_daily(county_id, snapshot_date)`, versioned `drizzle-kit migrate`.
2. **Real auth & billing:** multi-user, Stripe (`/api/webhooks/stripe`), plan tiers
   (free/pro/enterprise), SSO (Clerk or `@auth/express`), API keys + per-plan rate
   limiting on `/api/exports/*` and the public API.
3. **Observability:** Sentry, structured `pino` logging, `/api/metrics` (Prometheus).
4. **Scheduled ingestion:** GitHub Actions nightly running `run_all.ts` (the cron is
   still just a doc); alert on pipeline failure (ISO-NE already fails intermittently).
5. **Deploy:** Fly.io / Railway with a managed Postgres; staging + prod.
6. **Test coverage:** Supertest on route contracts, ingest smoke tests, Playwright on
   the 5 most-visited pages. (Today: 40 unit tests on 3 pure modules only.)

### Phase 3 — Finish the thin pages *(3–4 wks)*
1. **Alerts:** actually evaluate subscriptions on score/tier changes and dispatch
   email + webhooks (delivery infra exists; nothing triggers it).
2. **Movers:** accumulate `score_history_daily` over real time so day/30-day deltas populate.
3. **Watchlist / MyWatchlist:** real logged-in flow end-to-end.
4. **Pricing → billing;** replace Landing/Pricing hardcoded stats with live counts.

### Phase 4 — Commercial data & moat *(ongoing)*
1. **Regrid parcels** (~$500–$2k/mo) for target markets → real ownership + shell resolution.
2. **Substation headroom depth:** scrape utility ICA maps (Dominion/VA, ComEd/IL,
   PG&E/CA) that overlap DC hotspots to harden the synthesized headroom score.
3. **SOC 2 prep** if selling enterprise: audit logging on mutations, IP-restricted
   admin, encryption at rest, backup rotation.

### Phase 5 — Go-to-market readiness
Onboarding flow, sample county reports (PDF export exists), SEO/sitemap, docs
polish, and a self-serve trial. Position on the moats that survived competitor
analysis: **all-county coverage, EDGAR operator attribution, 11-factor fusion
(incl. cooling), landing probability, and alerting.**

---

## 4. If you only do three things next
1. **Finish the real-permit spike and ship one real ingest** — kills the biggest
   "is this real?" objection.
2. **Calibrate against 100+ real announcements** — turns the score from plausible
   to defensible.
3. **Postgres + auth/billing + deploy** — the minimum to put it in front of a paying
   professional user.
