# GridSense — Public Data Feeds Roadmap

Where GridSense's scoring is thin today, and the free/public feeds that would
enrich it. Derived from a July 2026 research sweep across grid, water, gas,
land/environmental, climate, economic, and fiber sources.

## What we already ingest

ISO queues (PJM, MISO, ERCOT, ISO-NE, SPP, CAISO, NYISO) · EIA-860/861/power-price ·
HIFLD transmission · FEMA NRI · USGS water use 2015 + water-stress · USDA RUCC +
NASS land values · FCC BDC + PeeringDB · SEC EDGAR full-text · Census gazetteer ·
state DC-incentive matrix · OSM parcels.

## The biggest gaps (read this first)

1. ~~**Cooling / climate — no factor at all.**~~ **SHIPPED (v1).** A
   `coolingEfficiency` factor now scores every county from NOAA NCEI 1991-2020
   CDD/HDD normals (`server/ingest/noaa_climate.ts`). Remaining v2 upgrade:
   derive true airside/waterside free-cooling HOURS from hourly ISD-Lite
   (feeds #2 below).
2. **Natural gas access — behind-the-meter generation is unscored.** With grid
   interconnection backlogs >4 years, developers build on-site gas. We score
   "onsite generation" off EIA-860 nameplate only, with no gas-pipeline proximity
   or gas-price signal.
3. **Deliverable-MW / substation headroom — now partially synthesized.** We ship
   a synthesized `power-headroom` view (see `server/headroom.ts`), but it leans
   on coarse inputs. Real interconnection-capacity depth is the incumbents'
   (Ascend/Nira/Enverus) core edge.
4. **Environmental constraints — buildable land is overstated.** We proxy land
   from RUCC only. Protected areas, wetlands, critical habitat, and air-quality
   nonattainment all remove or gate buildable acreage and aren't modeled.
5. **Carbon intensity — no ESG/CFE factor.** Hyperscalers weight grid carbon;
   we don't score it.

## Build-next ranking (top 15)

| # | Feed | Agency | Unlocks / improves | Key? | Effort | Priority |
|---|------|--------|--------------------|------|--------|----------|
| 1 | ~~NCEI Climate Normals (CDD/HDD)~~ **✅ SHIPPED** | NOAA | cooling factor (`noaa_climate.ts`) | no | Easy | done |
| 2 | **NOAA ISD-Lite → free-cooling hours** | NOAA | Marquee "economizer hours/yr" metric (dry-bulb+dewpoint→wet-bulb) | no | Med | ★★★ |
| 3 | **HIFLD gas pipelines + compressors** | HIFLD | **New `gas_access` factor** (reuses transmission tooling) | no | Easy | ★★★ |
| 4 | **EIA API v2 natural gas** | EIA | Gas economics (state citygate price) for gas_access | free | Easy | ★★★ |
| 5 | **gridstatus OSS library** | Grid Status | Real nodal LMP, load, fuel mix, queues across 7 ISOs (replaces synthetic price) | no | Easy | ★★★ |
| 6 | **EIA-930 hourly grid monitor** | EIA | Grid demand/headroom trend per balancing authority | free | Easy | ★★★ |
| 7 | **WRI Aqueduct 4.0** | WRI | Upgrade the water-stress overlay to the authoritative baseline (CC-BY) | no | Med | ★★★ |
| 8 | **EPA Green Book (nonattainment)** | EPA | Gates backup-generation permitting (county dbf/xls) | no | Easy | ★★★ |
| 9 | **USGS PAD-US 4.1** | USGS | Protected land → buildable-area reduction | no | Med | ★★☆ |
| 10 | **USFWS Critical Habitat** | USFWS | ESA Section 7 constraint (ArcGIS REST) | no | Easy | ★★☆ |
| 11 | **LBNL "Queued Up"** | LBNL | Closes non-ISO queue-coverage gap (annual xlsx) | no | Med | ★★☆ |
| 12 | **BLS QCEW + Census ACS + BEA** | BLS/Census/BEA | **New labor/economic factor** (labor cost, construction trades, GDP) | free | Easy | ★★☆ |
| 13 | **EPA eGRID** | EPA | **New carbon-intensity factor** (annual xlsx + subregion crosswalk) | no | Easy | ★★☆ |
| 14 | **US Drought Monitor** | NOAA/NDMC | Dynamic weekly water-risk time series by FIPS | no | Easy | ★★☆ |
| 15 | **EIA-923 (plant generation)** | EIA | Real generation *utilization* vs. 860 nameplate | free | Easy | ★★☆ |

Only EIA and BLS/Census/BEA need a (free, instant) API key. Everything else is
keyless bulk/REST.

## New factors this unlocks

- **`climate_cooling`** (from #1/#2): CDD/HDD + free-cooling (airside/waterside
  economizer) hours per year. The differentiated, sellable metric — dry-cold
  climates hit 6,000+ free-cooling hours vs. a few hundred on the Gulf.
- **`gas_access`** (from #3/#4): nearest transmission-pipeline distance +
  compressor-station proximity + state citygate price. Scores behind-the-meter
  viability — a real edge given the interconnection backlog.
- **`carbon_intensity`** (from #13): lb CO₂/MWh by eGRID subregion, for CFE/ESG
  siting.
- **`environmental_constraint` / buildability** (from #8/#9/#10, + NWI wetlands,
  USA Structures): % protected, wetland %, critical-habitat presence, air-quality
  nonattainment → a real buildable-acreage estimate instead of RUCC alone.
- **`labor_economic`** (from #12): labor cost/availability, construction-trade
  depth (QCEW NAICS 2371/236220), county GDP.

## Detail by category

### Grid / interconnection / power market
- **gridstatus OSS** (`pip install gridstatus`, no key) unifies all 7 ISOs — LMP,
  load, fuel mix, queues. Hosted API free tier = 500k rows/mo (pass `limit`).
- **EIA API v2** (one free key) covers EIA-930 (hourly BA demand/forecast/
  interchange), EIA-923 (plant generation/fuel), and refreshes 860/861/price.
  5,000 rows/request — paginate.
- **LBNL Queued Up** (annual xlsx) adds non-ISO regions (Southeast, West-non-CAISO)
  we miss. `emp.lbl.gov` 403s bots — use a browser UA / direct asset URL.
- **Substation/transmission headroom is fundamentally non-public** at the
  transmission level (case-by-case ISO studies). Best path = the synthesized
  composite we already ship, optionally augmented by scraping the few utility
  ICA maps that overlap DC hotspots (Dominion/VA, ComEd/IL, PG&E/CA).
- **Gotcha:** PJM Data Miner data **requires a redistribution license** for
  customer-facing use. Prefer EIA/LBNL/gridstatus-normalized data downstream.

### Water
- **WRI Aqueduct 4.0** (CC-BY) is the authoritative baseline-water-stress layer;
  join HydroBASIN → county once. **US Drought Monitor** adds a weekly dynamic
  signal by FIPS (pairs with `score_history_daily`). **USGS NWIS** streamflow +
  **EPA ECHO/NPDES** discharge permits are medium-effort supply/infra signals.
  Note USGS `waterservices.usgs.gov` is decommissioned early 2027 → build against
  `api.waterdata.usgs.gov`.

### Natural gas (behind-the-meter)
- **HIFLD gas pipelines + compressor stations** (free GIS, reuses the HIFLD
  transmission ingest pattern) is the highest-value gas feed — per-county
  nearest-pipeline distance. **EIA v2** adds state citygate price. **Skip PHMSA
  NPMS** — view-only, one-county-at-a-time, no bulk export.

### Land / environmental / regulatory
- **EPA Green Book** (nonattainment, easy county join) directly gates diesel/gas
  backup permitting. **PAD-US** (protected) and **USFWS Critical Habitat** (ESA)
  are clean constraint layers. **NWI wetlands** and **USA Structures** (buildability
  density) are heavier geometry — precompute county rollups. **National parcels:
  do not attempt free** — budget Regrid (~$0.10/parcel) when parcel depth becomes
  a product requirement.

### Climate (the cooling factor)
- **NCEI Climate Normals** bulk CSV → CDD/HDD per station → county. **LCDv2** adds
  wet-bulb/RH at ~1,000 airport stations for a fast v1. **ISD-Lite** hourly →
  derive **free-cooling / economizer hours** (ASHRAE TC 9.9 thresholds) — the
  standout metric. Document thresholds on the Methodology page.

### Economic / labor
- **BLS QCEW** (per-county CSV, no key) → labor + construction-trade + utilities
  employment. **Census ACS 5-year** (population/income/education). **BEA Regional**
  (county GDP/personal income). All easy, county-keyed.

### Fiber depth
- **FCC BDC provider+technology layers** (we already have the account — extend to
  fiber-provider counts/redundancy). **TeleGeography submarine cables** (open
  GeoJSON, easy, high value for coastal counties). **InterTubes** long-haul
  backbone (2015 research artifact, unique). **PCH** IXP directory (marginal over
  PeeringDB).

## Implementation notes

- All station/point/polygon feeds need a **point/basin/subregion → county**
  rollup. Build one reusable spatial-join helper in `server/ingest/overlay.ts`
  (nearest-station within radius; fallback to state mean) and reuse it.
- Each feed is a new module under `server/ingest/` following the `run_all.ts`
  pattern, writing rollups (not raw geometry) into a county overlay table and
  recording lineage in `data_provenance`.
- New factors go into `FACTOR_WEIGHTS` in `server/scoring.ts` with a
  `real|partial|synthetic` data-quality tag, consumed by `computeCountyFactorsV5`.
- Re-weighting note: adding cooling/gas/carbon/environmental factors means
  rebalancing `FACTOR_WEIGHTS` (they must still sum to 1.0 — there's a test for
  that in `server/scoring.test.ts`).
