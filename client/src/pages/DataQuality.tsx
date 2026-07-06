import { Database, CheckCircle2, AlertTriangle, HelpCircle, FileCode2, Newspaper, Zap, Cable, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

type QualityRow = { quality: string; count: number };
type FactorRow = { factorKey: string; quality: string; count: number };
type SourceRow = { sourceName: string; count: number };

type Response = {
  byQuality: QualityRow[];
  byFactor: FactorRow[];
  bySource: SourceRow[];
  ingestion: {
    eiaGenerators: number;
    hifldTransmissionCounties: number;
    edgarFilings: number;
    dcNewsItems: number;
  };
  lastFetchedAt: string | null;
};

type EdgarRow = {
  id: number;
  company: string;
  formType: string;
  filedDate: string;
  matchedQuery: string;
  snippet: string | null;
  filingUrl: string;
};

type NewsRow = {
  id: number;
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  category: string;
  mentionedStates: string;
};

const QUALITY_COLOR: Record<string, string> = {
  real: "bg-primary/20 text-primary border-primary/30",
  partial: "bg-amber-500/20 text-amber-500 border-amber-500/30",
  synthetic: "bg-muted text-muted-foreground border-border",
};

const QUALITY_LABEL: Record<string, string> = {
  real: "Real (public data)",
  partial: "Partial",
  synthetic: "Curated seed",
};

const FACTOR_LABEL: Record<string, string> = {
  gridGenerationMw: "Grid generation MW (EIA)",
  transmissionDensity: "Transmission density (HIFLD)",
  existingGridCapacityMw: "Existing grid capacity",
  gridDemandIntent: "Grid demand intent",
  timeToPower: "Time to power",
  onsiteGeneration: "Behind-the-meter",
  landAvailability: "Parcel supply",
  landAffordability: "Land affordability",
  fiberConnectivity: "Fiber & peering",
  fiscalIncentives: "Fiscal / policy",
  clusterAdjacency: "Cluster adjacency",
  waterAvailability: "Water availability",
  hazardSafety: "Hazard safety",
};

const PIPELINES = [
  { name: "EIA-860 Generators", cadence: "Annual", coverage: "Full US (~26k generators)", quality: "real",
    source: "https://www.eia.gov/electricity/data/eia860/", icon: Zap,
    desc: "Every operating power generator in the US: nameplate MW, fuel type, county, operating year. Feeds existing-grid-capacity per county." },
  { name: "HIFLD Transmission", cadence: "Monthly", coverage: "32 tracked counties", quality: "real",
    source: "https://hifld-geoplatform.hub.arcgis.com/", icon: Cable,
    desc: "Public transmission lines ≥69kV. Per-county envelope query returns segment count and peak voltage within 30 miles." },
  { name: "SEC EDGAR", cadence: "Daily", coverage: "US public companies", quality: "real",
    source: "https://efts.sec.gov/LATEST/search-index", icon: FileCode2,
    desc: "8-K filings matching data-center keywords + full recent history for known hyperscalers. Ideal for catching announcements before mainstream press." },
  { name: "Data Center Dynamics RSS", cadence: "Daily", coverage: "Global (US-tagged)", quality: "real",
    source: "https://www.datacenterdynamics.com/en/rss/", icon: Newspaper,
    desc: "Industry news feed. Each item categorized (announcement / permit / opposition / expansion / rumor) and state-tagged via regex." },
];

const ROADMAP = [
  { name: "PJM interconnection queue", status: "Investigating", note: "Landing page returns HTML; need to reverse-engineer real XLSX endpoint or scrape table." },
  { name: "ERCOT + MISO queues", status: "Planned", note: "Same schema as PJM; extend once XLSX parser lands." },
  { name: "FEMA National Risk Index", status: "Blocked", note: "Public CSV download endpoint returns SPA HTML — need to use ArcGIS FeatureServer instead." },
  { name: "FCC Broadband Data Collection", status: "Blocked", note: "Public API changed — needs POST body discovery." },
  { name: "Water rights / droughts", status: "Planned", note: "USGS + NIDIS Drought Monitor for county-level water stress." },
  { name: "Regrid / parcel APIs (paid)", status: "Deferred", note: "$5–20k/yr; unlock per-parcel scoring nationwide. Waiting on user prioritization." },
  { name: "ZoomProspector / commercial CRE", status: "Deferred", note: "Paid subscription. Adds building permits and site plan filings." },
];

export default function DataQuality() {
  const { data, isLoading } = useQuery<Response>({ queryKey: ["/api/data-quality"] });
  const { data: edgar } = useQuery<EdgarRow[]>({ queryKey: ["/api/edgar-filings"] });
  const { data: news } = useQuery<NewsRow[]>({ queryKey: ["/api/dc-news"] });

  const totalByQuality = new Map<string, number>();
  for (const r of data?.byQuality ?? []) totalByQuality.set(r.quality, r.count);
  const total = Array.from(totalByQuality.values()).reduce((s, v) => s + v, 0);

  // Reshape byFactor into matrix keyed by factor.
  const factorMatrix = new Map<string, Record<string, number>>();
  for (const r of data?.byFactor ?? []) {
    if (!factorMatrix.has(r.factorKey)) factorMatrix.set(r.factorKey, {});
    factorMatrix.get(r.factorKey)![r.quality] = r.count;
  }
  const factors = Array.from(factorMatrix.entries()).map(([factorKey, cols]) => ({
    factorKey,
    real: cols.real ?? 0,
    partial: cols.partial ?? 0,
    synthetic: cols.synthetic ?? 0,
  })).sort((a, b) => (b.real + b.partial) - (a.real + a.partial));

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1100px] mx-auto" data-testid="page-data-quality">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Data quality &amp; provenance
        </h1>
        <p className="text-sm text-muted-foreground">
          Every number in GridSense is tagged with its source and fetch timestamp. This page shows what fraction of the model is running on real public data versus curated seed.
        </p>
      </div>

      {/* Quality summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="quality-summary">
        {["real", "partial", "synthetic"].map((q) => {
          const c = totalByQuality.get(q) ?? 0;
          const pct = total > 0 ? Math.round((c / total) * 100) : 0;
          const Icon = q === "real" ? CheckCircle2 : q === "partial" ? AlertTriangle : HelpCircle;
          return (
            <Card key={q} data-testid={`card-quality-${q}`}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${QUALITY_COLOR[q]}`}>
                      <Icon className="h-3 w-3" />
                      {QUALITY_LABEL[q]}
                    </div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums" data-testid={`text-${q}-count`}>{c}</div>
                    <div className="text-xs text-muted-foreground">{pct}% of {total} provenance entries</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pipeline status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Live public-data pipelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {PIPELINES.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.name} className="flex items-start gap-3 pb-3 border-b border-border/50 last:border-0 last:pb-0">
                <div className="mt-0.5 h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name}</span>
                    <Badge variant="outline" className="text-[10px]">{p.cadence}</Badge>
                    <Badge className={`text-[10px] ${QUALITY_COLOR.real}`} variant="outline">{p.coverage}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.desc}</p>
                  <a href={p.source} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1" data-testid={`link-source-${p.name.replace(/\s+/g, "-").toLowerCase()}`}>
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold tabular-nums">
                    {p.name.startsWith("EIA") ? data?.ingestion.eiaGenerators
                      : p.name.startsWith("HIFLD") ? data?.ingestion.hifldTransmissionCounties
                      : p.name.startsWith("SEC") ? data?.ingestion.edgarFilings
                      : data?.ingestion.dcNewsItems}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">rows</div>
                </div>
              </div>
            );
          })}
          {data?.lastFetchedAt && (
            <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
              Last provenance write: <span className="font-mono">{new Date(data.lastFetchedAt).toLocaleString()}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Factor-by-factor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data quality by scoring factor</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-40 w-full" /> : (
            <div className="space-y-2">
              {factors.map((f) => {
                const total = f.real + f.partial + f.synthetic;
                const realPct = total > 0 ? (f.real / total) * 100 : 0;
                const partialPct = total > 0 ? (f.partial / total) * 100 : 0;
                const synthPct = total > 0 ? (f.synthetic / total) * 100 : 0;
                return (
                  <div key={f.factorKey} className="space-y-1" data-testid={`factor-quality-${f.factorKey}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{FACTOR_LABEL[f.factorKey] ?? f.factorKey}</span>
                      <span className="text-muted-foreground font-mono">
                        {f.real > 0 && <span className="text-primary">{f.real} real</span>}
                        {f.partial > 0 && <span className="text-amber-500 ml-2">{f.partial} partial</span>}
                        {f.synthetic > 0 && <span className="ml-2">{f.synthetic} seed</span>}
                      </span>
                    </div>
                    <div className="h-2 rounded overflow-hidden bg-muted flex">
                      <div className="bg-primary/70" style={{ width: `${realPct}%` }} />
                      <div className="bg-amber-500/70" style={{ width: `${partialPct}%` }} />
                      <div className="bg-muted-foreground/30" style={{ width: `${synthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent SEC filings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            Recent SEC 8-K filings matched
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(edgar ?? []).slice(0, 10).map((e) => (
              <a key={e.id} href={e.filingUrl} target="_blank" rel="noreferrer" className="block p-3 rounded border border-border hover:bg-muted/40 transition-colors" data-testid={`edgar-${e.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-sm truncate">{e.company}</span>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">{e.filedDate}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Matched: <span className="text-foreground">"{e.matchedQuery}"</span>
                </div>
                {e.snippet && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{e.snippet}</div>}
              </a>
            ))}
            {(!edgar || edgar.length === 0) && <div className="text-xs text-muted-foreground">No filings loaded yet.</div>}
          </div>
        </CardContent>
      </Card>

      {/* Recent news */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            Data Center Dynamics — latest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(news ?? []).slice(0, 15).map((n) => {
              const states: string[] = (() => { try { return JSON.parse(n.mentionedStates); } catch { return []; } })();
              return (
                <a key={n.id} href={n.link} target="_blank" rel="noreferrer" className="block p-3 rounded border border-border hover:bg-muted/40 transition-colors" data-testid={`news-${n.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-sm">{n.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px] uppercase">{n.category}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground font-mono">
                    <span>{new Date(n.publishedAt).toLocaleDateString()}</span>
                    {states.length > 0 && <span>· {states.join(", ")}</span>}
                  </div>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Roadmap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data sources roadmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {ROADMAP.map((r) => (
              <div key={r.name} className="flex items-start gap-3 pb-2 border-b border-border/50 last:border-0" data-testid={`roadmap-${r.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${
                  r.status === "Investigating" ? "border-primary/40 text-primary"
                  : r.status === "Planned" ? "border-blue-400/40 text-blue-400"
                  : r.status === "Blocked" ? "border-amber-500/40 text-amber-500"
                  : "border-muted-foreground/40 text-muted-foreground"
                }`}>{r.status}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.note}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
