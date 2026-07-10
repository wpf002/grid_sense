import { useQuery } from "@tanstack/react-query";
import { humanize } from "@/lib/utils";
import { formatDay } from "@/lib/dates";
import { useState } from "react";
import { Link } from "wouter";
import { Flame, Thermometer, Sprout, Snowflake, Zap, Radio, TrendingUp, MapPin, Globe, ArrowRight, AlertTriangle, Clock, Sparkles, X, LandPlot, FileCheck2, Swords, Inbox, Map as MapIcon, Code2, DollarSign } from "lucide-react";
import type { County, Signal, TriggerCounty } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/StatCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import { USMap } from "@/components/USMap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type Stats = {
  totalCounties: number;
  hot: number;
  warm: number;
  emerging: number;
  cold: number;
  totalSignals: number;
  totalQueuedMw: number;
};

function formatMw(mw: number): string {
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toFixed(0)} MW`;
}

// detectedAt is a date-only string; formatDay keeps it on its own calendar day.
const formatDate = (iso: string) => formatDay(iso);

// Readable labels for raw pipeline slugs shown in the freshness banner.
const PIPELINE_LABELS: Record<string, string> = {
  dc_news: "DC news",
  sec_edgar: "SEC EDGAR",
  score_history: "Score history",
  score_history_daily: "Score snapshot",
  isone_queue: "ISO-NE queue",
  pjm_queue: "PJM queue",
  miso_queue: "MISO queue",
  ercot_queue: "ERCOT queue",
  spp_queue: "SPP queue",
  caiso_queue: "CAISO queue",
  nyiso_queue: "NYISO queue",
  eia860: "EIA-860",
  eia861: "EIA-861",
  fema_nri: "FEMA risk index",
  arcgis_permits: "County permits",
  socrata_permits: "Open-data permits",
};
function pipelineLabel(p: string): string {
  return PIPELINE_LABELS[p] ?? humanize(p);
}
function ageLabel(hours: number): string {
  return hours < 24 ? `${hours.toFixed(0)}h` : `${(hours / 24).toFixed(1)}d`;
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({ queryKey: ["/api/stats"] });
  const { data: counties, isLoading: countiesLoading } = useQuery<County[]>({ queryKey: ["/api/counties"] });
  const { data: signals, isLoading: signalsLoading } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const { data: triggers } = useQuery<TriggerCounty[]>({
    queryKey: ["/api/triggers?min=3&days=90"],
  });

  const topCounties = counties?.slice(0, 12) ?? [];
  const recentSignals = signals?.slice(0, 8) ?? [];
  const topTriggers = triggers?.slice(0, 5) ?? [];

  // First-run guide (dismissible for this session only — no localStorage in sandboxed iframe)
  const [showGuide, setShowGuide] = useState(true);

  const { data: freshness } = useQuery<{
    pipelines: Array<{ pipeline: string; age_hours: number; stale: boolean; status: string; last_started_iso: string | null }>;
    stale_count: number;
    failing_count: number;
  }>({ queryKey: ["/api/data-freshness/summary"] });
  const stalePipelines = freshness?.pipelines.filter((p) => p.stale) ?? [];
  const failingPipelines = freshness?.pipelines.filter((p) => p.status === "error") ?? [];

  // Most recent successful ingest across all feeds → "data updated {relative}".
  // Lets the user see at a glance that they're on current data without asking.
  const lastUpdated = (() => {
    const times = (freshness?.pipelines ?? [])
      .filter((p) => p.status === "ok" && p.last_started_iso)
      .map((p) => Date.parse(p.last_started_iso!))
      .filter((t) => Number.isFinite(t));
    if (!times.length) return null;
    const mins = Math.round((Date.now() - Math.max(...times)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  })();

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
            Data Center Land Radar
          </h1>
          {lastUpdated && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
              title="News and filings refresh every 6 hours, prices and scores daily, structural feeds on their own cadence. The scheduler catches up any overdue feed automatically."
              data-testid="text-last-updated"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
              </span>
              Live · data updated {lastUpdated}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Landing-probability scores across US counties, fused from grid queues, land signals, fiber density, and operator activity.
        </p>
      </div>

      {/* Hero CTAs — surface the three most valuable entry points */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Link
          href="/map"
          className="group flex items-center justify-between rounded-lg border border-primary/40 bg-primary/[0.05] hover:bg-primary/[0.08] px-4 py-3 hover-elevate"
          data-testid="cta-hero-map"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center">
              <MapIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">National Radar</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </Link>
        <Link
          href="/api-docs"
          className="group flex items-center justify-between rounded-lg border border-border bg-card hover:bg-accent/40 px-4 py-3 hover-elevate"
          data-testid="cta-hero-api"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
              <Code2 className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold">Public API</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
        <Link
          href="/pricing"
          className="group flex items-center justify-between rounded-lg border border-border bg-card hover:bg-accent/40 px-4 py-3 hover-elevate"
          data-testid="cta-hero-pricing"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold">Pricing</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </div>

      {/* First-run guide — dismissible */}
      {showGuide && (
        <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02] p-4" data-testid="card-first-run-guide">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold">Welcome to GridSense</div>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">
                  A radar for where the next AI data centers will land. Every county has a landing-probability score fused from ISO queues, shell-LLC land buys, fiber density, water stress, tax policy, and operator activity. Start with the map below — hot markers are the ones to watch.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md hover-elevate"
              aria-label="Dismiss guide"
              data-testid="button-dismiss-guide"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Link href="/parcels" className="rounded-md border border-border bg-background/60 p-2.5 hover-elevate" data-testid="link-guide-parcels">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold"><LandPlot className="h-3 w-3 text-primary" />Parcels</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Site-level owners, acres, distance to substation & fiber.</div>
            </Link>
            <Link href="/permits" className="rounded-md border border-border bg-background/60 p-2.5 hover-elevate" data-testid="link-guide-permits">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold"><FileCheck2 className="h-3 w-3 text-primary" />Permits</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Rezoning, building, electrical, water filings by county.</div>
            </Link>
            <Link href="/competitive" className="rounded-md border border-border bg-background/60 p-2.5 hover-elevate" data-testid="link-guide-competitive">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold"><Swords className="h-3 w-3 text-primary" />Competitive Bids</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Rival buyers, LOIs, and signed contracts by county.</div>
            </Link>
            <Link href="/digest" className="rounded-md border border-border bg-background/60 p-2.5 hover-elevate" data-testid="link-guide-digest">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold"><Inbox className="h-3 w-3 text-primary" />Weekly Digest</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Preview the last 7 days of movers, permits, and bids.</div>
            </Link>
          </div>
        </div>
      )}

      {/* Data ingestion banner — ingest health at a glance. Amber for feeds that
          are merely behind schedule; red only when a pipeline actually errored. */}
      {(stalePipelines.length > 0 || failingPipelines.length > 0) && (() => {
        const hasFailing = failingPipelines.length > 0;
        const boxTone = hasFailing ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5";
        const textTone = hasFailing ? "text-destructive" : "text-amber-600 dark:text-amber-400";
        const summary = [
          stalePipelines.length > 0 ? `${stalePipelines.length} ${stalePipelines.length === 1 ? "feed" : "feeds"} behind schedule` : null,
          failingPipelines.length > 0 ? `${failingPipelines.length} errored` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${boxTone}`} data-testid="banner-data-freshness">
            <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${hasFailing ? "text-destructive" : "text-amber-500"}`} />
            <div className="flex-1 min-w-0 text-xs">
              <div className={`font-semibold ${textTone}`}>
                Data Ingestion — {summary}
              </div>
              {!hasFailing && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Retries automatically each hour. Force it now from Data Health.
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {failingPipelines.map((p) => (
                  <span key={p.pipeline} className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive px-1.5 py-0.5 text-[11px]">
                    {pipelineLabel(p.pipeline)} · errored
                  </span>
                ))}
                {stalePipelines.slice(0, 5).map((p) => (
                  <span key={p.pipeline} className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[11px]">
                    <Clock className="h-3 w-3" />
                    {pipelineLabel(p.pipeline)} · {ageLabel(p.age_hours)}
                  </span>
                ))}
                <Link href="/ingestion" className="text-primary hover:underline text-[11px] ml-0.5">View All →</Link>
              </div>
            </div>
          </div>
        );
      })()}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statsLoading || !stats ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatCard label="Counties" value={stats.totalCounties} icon={MapPin} testId="stat-counties" />
            <StatCard label="Hot" value={stats.hot} hint="Score ≥ 75" icon={Flame} accent="red" testId="stat-hot" />
            <StatCard label="Warm" value={stats.warm} hint="Score 60-74" icon={Thermometer} accent="orange" testId="stat-warm" />
            <StatCard label="Emerging" value={stats.emerging} hint="Score 45-59" icon={Sprout} accent="blue" testId="stat-emerging" />
            <StatCard label="Cold" value={stats.cold} hint="Score < 45" icon={Snowflake} testId="stat-cold" />
            <StatCard
              label="Queued Generation"
              value={formatMw(stats.totalQueuedMw)}
              hint="Generation awaiting interconnection"
              icon={Zap}
              accent="primary"
              testId="stat-queued"
            />
          </>
        )}
      </div>

      {/* US map */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            US Landing-Probability Map
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Marker size scales with landing-probability score. Hover for county details.
          </p>
        </CardHeader>
        <CardContent>
          {countiesLoading || !counties ? (
            <Skeleton className="h-[420px] w-full" />
          ) : (
            <USMap counties={counties} />
          )}
        </CardContent>
      </Card>

      {/* Trigger alerts */}
      {topTriggers.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Signal Cluster Triggers
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Counties with 3+ predictive signals in the last 90 days.
              </p>
            </div>
            <Link
              href="/triggers"
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
              data-testid="link-all-triggers"
            >
              All Triggers <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              {topTriggers.map((t) => (
                <Link
                  key={t.fips}
                  href={`/counties/${t.fips}`}
                  className="block rounded-md border border-primary/25 bg-primary/[0.04] p-3 hover-elevate"
                  data-testid={`trigger-card-${t.fips}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold leading-tight">
                      {t.name}, {t.state}
                    </div>
                    <Badge className="bg-primary/20 text-primary hover:bg-primary/20 text-[10px] font-mono px-1.5">
                      {t.recentSignalCount}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px]">
                    <span className="text-muted-foreground">Weighted</span>
                    <span className="font-mono font-semibold tabular-nums">
                      {t.weightedSignalScore.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px]">
                    <span className="text-muted-foreground">Score</span>
                    <span className="font-mono font-semibold tabular-nums text-primary">
                      {t.landingProbability.toFixed(0)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Hot counties table */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Highest-Probability Counties
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Ranked by fused landing-probability score. Click a row for parcel drill-down.
              </p>
            </div>
            <Link
              href="/counties"
              className="text-xs font-medium text-primary hover:underline"
              data-testid="link-all-counties"
            >
              View All →
            </Link>
          </CardHeader>
          <CardContent>
            {countiesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>County</TableHead>
                      <TableHead>ISO</TableHead>
                      <TableHead className="text-right">Gen Queue MW</TableHead>
                      <TableHead className="text-right">TTP mo</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topCounties.map((c) => (
                      <TableRow key={c.fips} className="cursor-pointer hover-elevate" data-testid={`row-county-${c.fips}`}>
                        <TableCell className="py-2">
                          <Link href={`/counties/${c.fips}`} className="block">
                            <div className="font-medium text-sm">{c.name}, {c.state}</div>
                            <div className="text-[11px] text-muted-foreground">{c.utility ?? "—"}</div>
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.iso ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {c.queuedLoadMw ? formatMw(c.queuedLoadMw) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {c.timeToPowerMonths ? c.timeToPowerMonths.toFixed(0) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <ScoreBadge score={c.landingProbability ?? 0} tier={c.scoreTier ?? undefined} size="sm" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent signals */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              Latest Signals
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Land purchases, rezonings, permits, and interconnection filings.
            </p>
          </CardHeader>
          <CardContent>
            {signalsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="space-y-3">
                {recentSignals.map((s) => (
                  <Link
                    key={s.id}
                    href={`/counties/${s.countyFips}`}
                    className="block rounded-md border border-border p-3 hover-elevate"
                    data-testid={`signal-${s.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-primary">
                        {humanize(s.signalType)}
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {formatDate(s.detectedAt)}
                      </div>
                    </div>
                    <div className="text-sm font-medium mt-1 line-clamp-2">{s.headline}</div>
                    {s.suspectedOperator && s.suspectedOperator !== "unknown" && (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Suspected: <span className="text-foreground">{s.suspectedOperator}</span>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
