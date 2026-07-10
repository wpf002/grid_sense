import { Activity, CheckCircle2, XCircle, Clock, Database, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

type IngestionRun = {
  id: number;
  pipeline: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "ok" | "error";
  rows: number | null;
  note: string | null;
  error: string | null;
};

const PIPELINE_META: Record<string, { name: string; source: string; url: string; cadence: string }> = {
  eia860: {
    name: "EIA-860 generators",
    source: "US Energy Information Administration",
    url: "https://www.eia.gov/electricity/data/eia860/",
    cadence: "Annual (Jan)",
  },
  hifld_transmission: {
    name: "HIFLD transmission lines (aggregated per county)",
    source: "NETL DOE Energy Transition Atlas mirror (HIFLD Open portal shut down Aug 2025) — 60,937 line segments, max kV + km per voltage class",
    url: "https://arcgis.netl.doe.gov/server/rest/services/Hosted/Energy_Transition_Atlas_493d6/FeatureServer/18/",
    cadence: "Annual (90-day cache)",
  },
  wholesale_price: {
    name: "Wholesale hub power prices",
    source: "EIA/ICE wholesale hub prices (7 national hubs, 90-day volume-weighted avg) + ERCOT Day-Ahead settlement point prices",
    url: "https://www.eia.gov/electricity/wholesale/",
    cadence: "Weekly",
  },
  eia_power_price: {
    name: "EIA electric power price (state industrial retail)",
    source: "EIA Electric Power Monthly Table 5.6.A — industrial retail ¢/kWh by state. Retail context only; traded wholesale prices now come from the wholesale hub pipeline.",
    url: "https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx",
    cadence: "Monthly",
  },
  fema_nri: {
    name: "FEMA National Risk Index (counties)",
    source: "FEMA / ArcGIS",
    url: "https://hazards.fema.gov/nri/",
    cadence: "Semi-annual",
  },
  miso_queue: {
    name: "MISO interconnection queue",
    source: "misoenergy.org public API",
    url: "https://www.misoenergy.org/planning/resource-utilization/GI_Queue/",
    cadence: "Monthly",
  },
  pjm_queue: {
    name: "PJM interconnection queue",
    source: "pjm.com XML feed",
    url: "https://www.pjm.com/planning/services-requests/interconnection-queues.aspx",
    cadence: "Monthly",
  },
  ercot_queue: {
    name: "ERCOT GIS interconnection queue",
    source: "ercot.com GIS Report XLSX",
    url: "https://www.ercot.com/mp/data-products/data-product-details?id=PG7-200-ER",
    cadence: "Monthly",
  },
  spp_queue: {
    name: "SPP interconnection queue",
    source: "opsportal.spp.org Active Studies CSV",
    url: "https://opsportal.spp.org/Studies/GIActive",
    cadence: "Monthly",
  },
  caiso_queue: {
    name: "CAISO interconnection queue",
    source: "caiso.com Public Queue Report XLSX",
    url: "https://www.caiso.com/library/interconnection-queue-reports",
    cadence: "Monthly",
  },
  nyiso_queue: {
    name: "NYISO interconnection queue",
    source: "nyiso.com Interconnection Queue XLSX (Gen + Cluster + Load)",
    url: "https://www.nyiso.com/interconnections",
    cadence: "Monthly",
  },
  isone_queue: {
    name: "ISO-NE interconnection queue",
    source: "irtt.iso-ne.com public export XLSX",
    url: "https://irtt.iso-ne.com/reports/external",
    cadence: "Monthly",
  },
  lbnl_queue: {
    name: "LBNL non-RTO interconnection queue",
    source: "LBNL 'Queued Up' data file — extends queue coverage into non-RTO regions (Southeast, Arizona, Carolinas, Northwest). Manual annual download.",
    url: "https://emp.lbl.gov/queues",
    cadence: "Annual (manual file)",
  },
  fcc_bdc: {
    name: "FCC Broadband Data Collection (fiber)",
    source: "ArcGIS Living Atlas mirror · view e1343efc — table 10 (BDC records for counties), tech=50 (Fiber)",
    url: "https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/FCC_Broadband_Data_Collection_December_2024_View/FeatureServer/10",
    cadence: "Semi-annual",
  },
  usgs_water: {
    name: "USGS county water use",
    source: "USGS Estimated Use of Water in the United States County-Level Data for 2015 (v2.0) · ScienceBase",
    url: "https://doi.org/10.5066/F7TB15V5",
    cadence: "Every 5 years",
  },
  usda_land: {
    name: "USDA NASS farm real estate values",
    source: "USDA NASS Land Values 2025 Summary · state $/acre + county allocator",
    url: "https://www.nass.usda.gov/Charts_and_Maps/graphics/farm_value_map.pdf",
    cadence: "Annual (Aug)",
  },
  usda_rucc: {
    name: "USDA ERS rural-urban continuum",
    source: "USDA ERS Rural-Urban Continuum Codes 2023 · county-level RUCC 1–9",
    url: "https://www.ers.usda.gov/data-products/rural-urban-continuum-codes",
    cadence: "Decennial (2023)",
  },
  state_incentives: {
    name: "State data-center tax incentives",
    source: "State statutes + revenue-department fact sheets (sales-tax exemption, MRO, DC certification)",
    url: "https://taxfoundation.org/data/all/state/state-tax-data-centers/",
    cadence: "Legislative sessions",
  },
  peeringdb: {
    name: "PeeringDB IX facilities",
    source: "PeeringDB /api/fac · US carrier hotels + IX facilities with lat/lng",
    url: "https://www.peeringdb.com/api/fac",
    cadence: "Cached ~15 min",
  },
  eia861: {
    name: "EIA-861 utility service territories",
    source: "EIA Form 861 Service_Territory_2024.xlsx — retail distribution utility ↔ county",
    url: "https://www.eia.gov/electricity/data/eia861/",
    cadence: "Annual (Oct release)",
  },
  shell_llcs: {
    name: "Hyperscaler shell-LLC resolver",
    source: "Curated from Meta subprocessor list, SEC filings, DCD/Register/Verge reporting, DataCentersExposed",
    url: "https://www.meta.com/legal/meta-for-work/subprocessor-list/",
    cadence: "As reported",
  },
  edgar: {
    name: "SEC EDGAR data center filings",
    source: "sec.gov EDGAR full-text search",
    url: "https://efts.sec.gov/LATEST/search-index",
    cadence: "Daily",
  },
  dc_news: {
    name: "Data Center Dynamics news",
    source: "datacenterdynamics.com RSS",
    url: "https://www.datacenterdynamics.com/en/",
    cadence: "Daily",
  },
  expand_counties: {
    name: "Expand tracked counties",
    source: "Derived from ISO queue MW rankings",
    url: "",
    cadence: "Monthly (after queue pipelines)",
  },
  enrich: {
    name: "Recompute county scores",
    source: "Real-data overlay (EIA + HIFLD + queue + NRI + news)",
    url: "",
    cadence: "Monthly (after ingest)",
  },
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <Badge className="bg-primary/20 text-primary border-primary/30 gap-1" data-testid={`status-ok`}>
        <CheckCircle2 className="h-3 w-3" /> Success
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1" data-testid={`status-error`}>
        <XCircle className="h-3 w-3" /> Error
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 gap-1" data-testid={`status-running`}>
      <Clock className="h-3 w-3" /> Running
    </Badge>
  );
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDuration(start: number, end: number | null): string {
  if (!end) return "—";
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function IngestionRuns({ embedded = false }: { embedded?: boolean } = {}) {
  const latest = useQuery<IngestionRun[]>({ queryKey: ["/api/ingestion-runs/latest"] });
  const history = useQuery<IngestionRun[]>({ queryKey: ["/api/ingestion-runs"] });

  const pipelines = Object.keys(PIPELINE_META);
  const byPipeline = new Map<string, IngestionRun>();
  (latest.data ?? []).forEach((r) => byPipeline.set(r.pipeline, r));

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "space-y-6 p-6"} data-testid="page-ingestion-runs">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Activity className="h-5 w-5 text-primary" /> Ingestion Runs
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Every public-data pipeline that feeds county scoring. Each row shows the last time
          GridSense pulled fresh data from the underlying government or ISO source, how many
          records were ingested, and whether the fetch succeeded. Runs are recorded automatically
          during scheduled refreshes and manual re-scores.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest Run per Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {latest.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="pb-2 pr-4">Pipeline</th>
                    <th className="pb-2 pr-4">Source</th>
                    <th className="pb-2 pr-4">Cadence</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4 text-right">Rows</th>
                    <th className="pb-2 pr-4 whitespace-nowrap">Last run</th>
                    <th className="pb-2 whitespace-nowrap">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {pipelines.map((p) => {
                    const meta = PIPELINE_META[p];
                    const run = byPipeline.get(p);
                    return (
                      <tr key={p} className="border-b border-border/50" data-testid={`row-pipeline-${p}`}>
                        <td className="py-2 pr-4 font-medium" data-testid={`text-pipeline-name-${p}`}>{meta.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {meta.url ? (
                            <a
                              href={meta.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              data-testid={`link-source-${p}`}
                            >
                              {meta.source}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            meta.source
                          )}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{meta.cadence}</td>
                        <td className="py-2 pr-4">{run ? <StatusBadge status={run.status} /> : <Badge variant="outline" data-testid={`status-never-${p}`}>Never run</Badge>}</td>
                        <td className="py-2 pr-4 text-right font-mono" data-testid={`text-rows-${p}`}>
                          {run?.rows?.toLocaleString() ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap" data-testid={`text-last-run-${p}`}>
                          {run ? fmtDate(run.started_at) : "—"}
                        </td>
                        <td className="py-2 text-muted-foreground whitespace-nowrap">
                          {run ? fmtDuration(run.started_at, run.finished_at) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(history.data ?? []).slice(0, 30).map((run) => {
                const meta = PIPELINE_META[run.pipeline];
                return (
                  <div
                    key={run.id}
                    className="flex items-start justify-between gap-4 border-b border-border/40 pb-2"
                    data-testid={`row-history-${run.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={run.status} />
                        <span className="font-medium text-sm">
                          {meta?.name ?? run.pipeline}
                        </span>
                        {run.rows != null && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {run.rows.toLocaleString()} rows
                          </span>
                        )}
                      </div>
                      {run.note && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{run.note}</p>
                      )}
                      {run.error && (
                        <p className="text-xs text-destructive mt-1 truncate" data-testid={`text-error-${run.id}`}>
                          Error: {run.error}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      <div>{fmtDate(run.started_at)}</div>
                      <div>{fmtDuration(run.started_at, run.finished_at)}</div>
                    </div>
                  </div>
                );
              })}
              {(history.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Refreshes Work</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            GridSense pulls from six government / grid-operator endpoints. Each fetch is
            timestamped and cached to disk so a source revision can be reproduced later. When a
            pipeline finishes, the county score is automatically recomputed and any deltas are
            written to the score history table on the county detail page.
          </p>
          <p>
            Cadence is set per source: news/EDGAR daily, ISO queues monthly, EIA/HIFLD annually.
            The <em className="not-italic font-medium text-foreground">Data quality</em> page
            shows which factors are backed by real data vs. curated seed values for any given
            county.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
