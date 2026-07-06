# GridSense

AI-data-center land radar. Scores all 3,109 US counties for hyperscale data-center site suitability by fusing ISO interconnection queues, EIA generator + utility data, HIFLD transmission, USGS water, FEMA hazard, FCC/PeeringDB fiber, USDA land, SEC EDGAR shell-LLC filings, and local news/permits/parcels signals.

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env
# Edit .env — set GRIDSENSE_ADMIN_PASSWORD and GRIDSENSE_SESSION_SECRET
npm run dev
```

App runs on `http://localhost:5000` (Express + Vite on the same port).

## Stack

React 18.3.1 · Vite · Tailwind v3 · shadcn/ui · wouter (hash routing) · TanStack Query v5 · Express · Drizzle ORM · better-sqlite3

## Architecture

See `CLAUDE.md` for the full onboarding guide, including gotchas, data model, scoring model, API surface, and recommended next PRs.

## Scripts

- `npm run dev` — dev server (Express + Vite HMR)
- `npm run build` — build server bundle (esbuild → `dist/index.cjs`) + client (Vite → `dist/public`)
- `npm start` — production server
- `npm run check` — TypeScript typecheck
- `npm run db:push` — Drizzle-kit schema push (destructive; prefer explicit migrations in prod)

## Ingestion

One module per data source in `server/ingest/`. Orchestrate with:

```bash
npx tsx server/ingest/run_all.ts edgar,dc_news,eia860,fema_nri,enrich
```

Full source list: `edgar`, `dc_news`, `eia860`, `eia861`, `eia_power_price`, `pjm_queue`, `miso_queue`, `ercot_queue`, `isone_queue`, `spp_queue`, `caiso_queue`, `nyiso_queue`, `iso_queue_history`, `hifld_transmission`, `usgs_water`, `water_stress`, `fema_nri`, `fcc_bdc`, `peeringdb`, `usda_land`, `usda_rucc`, `osm_parcels`, `state_incentives`, `shell_llcs`, `dc_backtest`, `comps`, `overlay`, `enrich`, `expand_counties`, `counties_ref`.

## License

MIT
