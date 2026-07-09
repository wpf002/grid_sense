import { BookOpen, Zap, Cable, MapPin, Droplet, DollarSign, AlertTriangle, Radio, Building2, Clock, Gauge, Sun, LineChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// KEEP THIS TABLE IN SYNC WITH server/scoring.ts → FACTOR_WEIGHTS
const factors = [
  { icon: Gauge, key: "gridDemandIntent", label: "Grid demand intent", weight: 0.20, formula: "log10(1 + queuedLoadMw) / log10(1 + 20000) × 100",
    desc: "Interconnection-queue MW pending in the county — a saturating log-scaled proxy for hyperscaler demand. Loudoun's 18 GW queue peaks this factor even though supply lags." },
  { icon: Clock, key: "timeToPower", label: "Time to power", weight: 0.15, formula: "100 − ((TTPmonths − 18) / 42) × 100",
    desc: "Inverse of median energization months. <24mo scores full, >60mo scores zero. This is why northern Virginia loses ground to Central Ohio and West Texas despite queue demand." },
  { icon: MapPin, key: "landAvailability", label: "Parcel supply", weight: 0.15, formula: "min(1, largeParcelCount / 40) × 100",
    desc: "Count of parcels >500 acres. Bulk contiguous acreage matters more than raw acreage — assembling five 100-acre parcels is 5× slower than closing one 500-acre tract." },
  { icon: Sun, key: "onsiteGeneration", label: "Behind-the-meter", weight: 0.10, formula: "onsiteGenerationFriendly ? 100 : 30",
    desc: "Whether the state PSC / local rules allow behind-the-meter generation. Meta and Amazon are increasingly siting DCs where they can co-locate solar or gas-peaker capacity." },
  { icon: Cable, key: "fiberConnectivity", label: "Fiber & peering", weight: 0.10, formula: "fiberDensityScore (0-100 direct)",
    desc: "Long-haul fiber density plus proximity to peering exchanges. Sub-2ms round-trip to a major exchange is the practical inference-DC threshold." },
  { icon: DollarSign, key: "fiscalIncentives", label: "Fiscal / policy", weight: 0.10, formula: "taxIncentiveScore × moratoriumMult (+10 if right-to-build)",
    desc: "Tax abatement package strength adjusted for policy risk. Active moratorium multiplies by 0; proposed by 0.55. Right-to-build zoning adds +10." },
  { icon: Building2, key: "clusterAdjacency", label: "Cluster adjacency", weight: 0.08, formula: "log10(1 + existingDcMw) / log10(1 + 4000) × 100",
    desc: "Existing DC capacity — signals mature supply chain, contractor base, and utility familiarity with hyperscale loads. Log-scaled to avoid over-rewarding Ashburn." },
  { icon: MapPin, key: "landAffordability", label: "Land affordability", weight: 0.05, formula: "100 − log10(1 + $/acre) / log10(1000001) × 100",
    desc: "Inverse log-scaled median land price. <$5k/acre = 100, >$500k/acre ≈ 0. Deprioritized because hyperscalers underwrite land as a small fraction of total build cost." },
  { icon: AlertTriangle, key: "hazardSafety", label: "Hazard safety", weight: 0.04, formula: "100 − hazardScore",
    desc: "Inverse of flood + seismic + wildfire exposure. Coastal Louisiana counties take a hit here even with strong land supply." },
  { icon: Droplet, key: "waterAvailability", label: "Water availability", weight: 0.03, formula: "100 − waterStressScore",
    desc: "Inverse of WRI Aqueduct baseline water-stress index. Growing importance as liquid cooling gains share — Phoenix and Central Texas counties penalized." },
];

const signalWeights = [
  { type: "llc_land_purchase", label: "LLC land purchase", weight: 1.5, lead: "6-18mo" },
  { type: "rezoning", label: "Rezoning", weight: 1.3, lead: "3-9mo" },
  { type: "substation_filing", label: "Substation filing", weight: 1.4, lead: "12-30mo" },
  { type: "water_permit", label: "Water permit", weight: 1.1, lead: "4-12mo" },
  { type: "interconnection_request", label: "Interconnection req.", weight: 1.2, lead: "18-48mo" },
  { type: "building_permit", label: "Building permit", weight: 1.6, lead: "0-6mo" },
  { type: "incentive_deal", label: "Incentive deal", weight: 1.3, lead: "3-12mo" },
  { type: "codename_resolved", label: "Codename resolved", weight: 1.5, lead: "±6mo" },
];

export default function Methodology() {
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[900px] mx-auto" data-testid="page-methodology">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          Methodology
        </h1>
        <p className="text-sm text-muted-foreground">
          How GridSense scores county-level landing probability and detects parcel-level triggers. Every value below is the actual number the running model uses.
        </p>
      </div>

      {/* Formula walkthrough */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LineChart className="h-4 w-4 text-primary" />
            The Formula
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            GridSense fuses two independent layers into one landing-probability score:
          </p>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3 font-mono text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-primary">landingProbability</span>
              <span className="text-muted-foreground">=</span>
              <span>clamp(countyBase + signalBoost, 0, 100)</span>
            </div>
            <div className="pl-6 space-y-1.5 text-[11px] text-muted-foreground">
              <div><span className="text-primary">countyBase</span> = Σ (factor.weight × factor.value) — see the 10-factor table below</div>
              <div><span className="text-primary">signalBoost</span> = 15 × (1 − exp(−totalSignalScore / 2.0))</div>
              <div className="pl-4 text-[10px]"><span className="text-primary">totalSignalScore</span> = Σ (weight × confidence × recency)</div>
              <div className="pl-4 text-[10px]"><span className="text-primary">recency</span> = max(0, 1 − ageMonths / 36) — decays to zero at 3 years</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-2">Score tiers</div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-red-500/20 text-red-500 border-red-500/40" variant="outline">Hot ≥ 75</Badge>
              <Badge className="bg-orange-500/20 text-orange-500 border-orange-500/40" variant="outline">Warm 60-74</Badge>
              <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/40" variant="outline">Emerging 45-59</Badge>
              <Badge variant="outline">Cold &lt; 45</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Factor weights table — real numbers from scoring.ts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">County-Layer Factor Weights</CardTitle>
          <p className="text-xs text-muted-foreground">
            10 factors, weights sum to 1.00. Weight × normalized value = contribution to countyBase.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {factors.map((f) => (
              <div key={f.key} className="flex items-start gap-3 pb-3 border-b border-border/40 last:border-0 last:pb-0">
                <div className="rounded-md bg-muted p-2 shrink-0">
                  <f.icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs font-mono text-primary shrink-0">{(f.weight * 100).toFixed(0)}%</div>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/80 mt-1 break-all">{f.formula}</div>
                  <p className="text-xs text-muted-foreground mt-1.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total weight</span>
            <span className="font-mono text-primary font-medium">1.00 (100%)</span>
          </div>
        </CardContent>
      </Card>

      {/* Signal weights table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            Signal-Layer Weights
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Each detected signal contributes weight × confidence × recency to the boost pool (capped at +15).
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {signalWeights.map((s) => (
              <div key={s.type} className="flex items-center justify-between px-3 py-2 rounded-md border border-border/40 bg-muted/20 text-xs">
                <span>{s.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-[10px] font-mono">{s.lead}</span>
                  <span className="font-mono text-primary">{s.weight.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Worked example */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Worked Example — a Hot County</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Imagine Maricopa County, AZ with a 3,200 MW queue, 32-month TTP, 12 large parcels, BTM-friendly, fiber score 62,
            incentive score 55 with no moratorium, existing 1,400 MW cluster, land at $30k/acre, hazard 20, water stress 65.
          </p>
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1 font-mono text-[11px]">
            <div>gridDemand = log10(3201)/log10(20001) × 100 = <span className="text-primary">81.3</span> × 0.20 = 16.3</div>
            <div>timeToPower = 100 − ((32−18)/42)×100 = <span className="text-primary">66.7</span> × 0.15 = 10.0</div>
            <div>parcelSupply = 12/40 × 100 = <span className="text-primary">30.0</span> × 0.15 = 4.5</div>
            <div>btm = <span className="text-primary">100</span> × 0.10 = 10.0</div>
            <div>fiber = <span className="text-primary">62</span> × 0.10 = 6.2</div>
            <div>fiscal = <span className="text-primary">55</span> × 0.10 = 5.5</div>
            <div>cluster = log10(1401)/log10(4001) × 100 = <span className="text-primary">87.5</span> × 0.08 = 7.0</div>
            <div>landAffordability = 100 − log10(30001)/log10(1000001) × 100 = <span className="text-primary">25.1</span> × 0.05 = 1.3</div>
            <div>hazardSafety = 80 × 0.04 = 3.2</div>
            <div>waterAvailability = 35 × 0.03 = 1.05</div>
            <div className="pt-1.5 mt-1.5 border-t border-border/30">countyBase ≈ <span className="text-primary text-sm">65.1</span></div>
            <div>+ signalBoost (3 recent signals) ≈ <span className="text-primary text-sm">+9</span></div>
            <div className="pt-1.5 mt-1.5 border-t border-border/30 text-sm">landingProbability = <span className="text-primary font-bold">74 (Warm)</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Data sources */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            Data Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-primary mb-1">
              Tier 1 · Free public (LIVE in v0.7)
            </div>
            <p className="text-xs">
              All seven US ISO/RTO interconnection queues: PJM XML (9,263 projects),
              MISO JSON (3,792), ERCOT GIS XLSX (1,793), ISO-NE IRTT XLSX (1,576),
              SPP Active Studies CSV (961), CAISO Public Queue XLSX (275), NYISO
              XLSX (245 across Gen + Cluster + Load) — 17,905 total queued projects.
              Plus EIA-860 generators (2024 vintage; 2,167 counties with existing gen),
              HIFLD transmission lines, FEMA National Risk Index (3,232 counties),
              FCC Broadband Data Collection Dec 2024 (fiber technology across 3,186
              counties nationally, most of our 3,109 tracked), SEC EDGAR full-text search,
              Data Center Dynamics RSS. Every row is disk-cached with fetch timestamp
              for audit.
            </p>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Tier 1 · Free public (next targets)
            </div>
            <p className="text-xs">
              EPA Envirofacts water withdrawal, WRI Aqueduct baseline water stress,
              EIA-861 utility service territories, PeeringDB internet exchange proximity,
              and shell-LLC ↔ operator resolution across EDGAR filings and state corporate registries.
            </p>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Tier 2 · Paid / commercial (upgrade path)
            </div>
            <div className="text-xs space-y-1.5">
              <p>
                The GridSense free-data build ships with OSM building footprints,
                state-level water stress, and state-avg power price as proxies
                for three commercial datasets. Upgrade to any of these once revenue
                justifies the license fee:
              </p>
              <ul className="pl-4 space-y-1 list-disc">
                <li>
                  <strong>Regrid</strong> (Gap 1) — nationwide parcel polygons
                  with owner-of-record, APN, acreage, and deed history.
                  $500-5k/mo API or $25-65k/yr bulk. Unblocks Gap 15 (real
                  parcel granularity per county).{" "}
                  <a href="https://regrid.com/api" target="_blank" rel="noreferrer" className="underline">regrid.com/api</a>
                </li>
                <li>
                  <strong>Wood Mackenzie Power Analytics</strong> (Gap 18) —
                  nodal LMP forecasts, substation-level headroom, ISO queue
                  economics. Enterprise pricing (~$50k+/yr). Replaces our
                  state-avg EIA proxy with true node-level pricing.{" "}
                  <a href="https://www.woodmac.com/industry/power-and-renewables/" target="_blank" rel="noreferrer" className="underline">woodmac.com</a>
                </li>
                <li>
                  <strong>DCTrack / DCByte</strong> (Gap 18) — DC campus
                  inventory, kW deployed, tenant mix, expansion pipeline.
                  Per-seat pricing.{" "}
                  <a href="https://www.dcbyte.com/" target="_blank" rel="noreferrer" className="underline">dcbyte.com</a>
                </li>
                <li>
                  <strong>S&P Global Market Intelligence</strong> (Gap 18) —
                  utility rate-case filings, muni bond schedules, deal comps.
                  Enterprise pricing.{" "}
                  <a href="https://www.spglobal.com/marketintelligence/" target="_blank" rel="noreferrer" className="underline">spglobal.com/marketintelligence</a>
                </li>
                <li>
                  <strong>GeoTel / CoreSite fiber layers</strong> — true
                  route-level fiber conduits vs our FCC BDC broadband coverage
                  proxy. Enterprise pricing.
                </li>
                <li>
                  <strong>Skip-trace / owner outreach</strong> —
                  BatchSkipTracing ($0.10/rec), REIPro, PropStream, TLOxp.
                  Not blocked by code; see Lead-gen workflow.
                </li>
              </ul>
              <p className="text-muted-foreground pt-1">
                Every paid source is optional. The free-data build already backs
                all ten scoring factors with real public data; paid feeds
                sharpen accuracy from county-level to parcel-level.
              </p>
            </div>
          </div>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Tier 3 · Curated & derived
            </div>
            <p className="text-xs">
              Shell LLC ↔ operator resolution (built manually from Data Center Dynamics + Data Center Frontier reporting, local news,
              and public disclosures), codename registries, permit-corridor pattern matching, LLM extraction from PSC docket text.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Prototype scope */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Current Scope · v2.0</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            This build tracks <strong className="text-foreground">3,109 US counties</strong>, seeded from a curated list and
            auto-expanded to include every county with material queue-MW activity across <strong className="text-foreground">
            all seven US ISO/RTO interconnection queues</strong> — PJM, MISO, ERCOT, ISO-NE, SPP, CAISO, and NYISO.
            <strong className="text-foreground"> All ten scoring factors are now backed by real public data</strong>:
            grid demand intent (ISO queues), hazard safety (FEMA NRI), onsite generation (EIA-860), cluster adjacency (HIFLD),
            time-to-power (queue withdrawal ratio), fiber connectivity (FCC BDC Dec 2024), water availability (USGS 2015),
            land affordability (USDA NASS 2025), parcel supply (USDA ERS RUCC 2023), and fiscal incentives (state DC tax matrix).
            Data quality is stamped per factor per county — every value carries provenance you can inspect on the
            county detail page or the Data quality view.
          </p>
          <p>
            <strong className="text-foreground">v2.0 additions:</strong> Three major data expansions.
            (1) <strong className="text-foreground">HIFLD transmission lines</strong> — 60,937 line segments across 624
            counties from the NETL DOE mirror (original HIFLD Open portal shut down Aug 2025), showing max kV
            and total km of transmission by voltage class per county. Loudoun VA has 1,725 km; Maricopa AZ has 3,478 km.
            (2) <strong className="text-foreground">EIA power price</strong> — April 2026 industrial retail rates from
            EIA Electric Power Monthly Table 5.6.A, all 51 states, median 8.75¢/kWh with YoY change. Used as a
            state-level LMP proxy until we integrate nodal pricing.
            (3) <strong className="text-foreground">Shell-LLC registry expanded to 204 entries</strong> across 24 operators
            and 81 counties — up from 39. Now includes Meta (60+), Google (25+), Microsoft (20+), Amazon (25+), Apple,
            Oracle, ByteDance, xAI, OpenAI/Stargate, CoreWeave, and REIT developers.
          </p>
          <p>
            <strong className="text-foreground">v1.1 additions:</strong> EIA-861 Service Territory pipeline
            (vintage 2024) — 3,132 US counties mapped to their retail distribution utilities. Fixed daily-cron
            endpoints: DCD moved from /en/feeds/news/ to /en/rss/, and SEC EDGAR EFTS is a GET — not POST —
            and 500s on quoted phrases, so bare-term queries only.
          </p>
          <p>
            <strong className="text-foreground">v1.0 additions:</strong> Hyperscaler shell-LLC resolver — a curated
            lookup that ties anonymous land-buying LLC's (Meta's Greater Kudu / Raven Northbrook / Sidecat / Siculus,
            Google's Sharka / Jet Stream / Jasmine Development, Amazon's Vadata / Vandalay Industries, Microsoft's
            Project Firecracker / Agate / Yoga / Bailey, Lancium's Clean Campus for Stargate) back to their true
            operators and the counties where they've filed. Sourced from Meta's public subprocessor list, SEC
            filings, DCD, The Register, The Verge, and DataCentersExposed's registry. When a county has known
            shell activity, GridSense surfaces the operator identity on the county detail page — because when a
            press release drops in six months, you want to have been long that land already.
          </p>
          <p>
            <strong className="text-foreground">v0.9 additions:</strong> USDA ERS Rural-Urban Continuum
            Codes 2023 — the definitive USDA county-level urbanization index (RUCC 1–9), decennial vintage
            based on 2020 Census + 2020 OMB metro delineations. Rural counties (RUCC 6–9) get peak parcel-supply
            scores; metros (RUCC 1) get parcel-scarcity scores. State DC tax-incentive matrix compiled from
            primary statutes and Tax Foundation’s 2024 state DC survey — sales-tax exemption on IT/electricity,
            property abatement/MRO, capex/jobs thresholds — mapped to all 3,109 tracked counties. Plus PeeringDB
            /api/fac (1,357 geolocated US carrier hotels + IX facilities) blended into the fiber factor at
            70% FCC BDC / 30% peering density within a 40-mile radius. Together these lift the real-data
            factor count from 9 to 10 of 10.
          </p>
          <p>
            <strong className="text-foreground">v0.8 additions:</strong> USGS Estimated Water Use 2015 (v2.0)
            sourced directly from ScienceBase CSV (3,142 US counties × 40+ withdrawal categories). USDA NASS
            Land Values 2025 Summary — state-level $/acre farm real estate values (released Aug 1, 2025)
            allocated to counties via tier + existing-DC-capacity multipliers.
          </p>
          <p>
            <strong className="text-foreground">v0.7 baseline:</strong> All seven US ISO/RTO queues (17,905
            queued projects) plus FCC Broadband Data Collection Dec 2024 (19,589 fiber records, most of 3,109
            tracked counties covered).
          </p>
          <p>
            <strong className="text-foreground">Next up:</strong> EIA-861 utility service territories,
            PeeringDB internet exchange proximity, and shell-LLC ↔ operator resolution across EDGAR + state
            corporate registries.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
