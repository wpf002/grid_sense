import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { ArrowLeft, Star, Zap, Droplet, Cable, DollarSign, MapPin, AlertTriangle, LineChart as LineChartIcon, GitCompare, Database, CheckCircle2, HelpCircle, ExternalLink, Building2, TrendingDown, Activity, FileDown } from "lucide-react";
import type { CountyDetail as CountyDetailType, Watchlist, Signal } from "@shared/schema";
import { SignalDetailModal } from "@/components/SignalDetailModal";
import { CountyExtras } from "@/components/CountyExtras";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { ScoreSparkline } from "@/components/ScoreSparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatMw(mw?: number | null): string {
  if (mw == null || mw === 0) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toFixed(0)} MW`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CountyDetail() {
  const [, params] = useRoute("/counties/:fips");
  const fips = params?.fips ?? "";
  const { toast } = useToast();
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

  const { data: county, isLoading } = useQuery<CountyDetailType>({
    queryKey: ["/api/counties", fips],
    enabled: !!fips,
  });

  const { data: shellActivity } = useQuery<{
    fips: string;
    operators: string[];
    llcNames: string[];
    totalLlcCount: number;
    updatedAt?: string;
  }>({
    queryKey: ["/api/counties", fips, "shell-activity"],
    enabled: !!fips,
  });

  const { data: utilities } = useQuery<{
    fips: string;
    vintage: string | null;
    utilities: { number: number; name: string }[];
  }>({
    queryKey: ["/api/counties", fips, "utilities"],
    enabled: !!fips,
  });

  const { data: transmission } = useQuery<{
    fips: string;
    totalKm: number;
    maxVoltageKv: number | null;
    segmentCount: number;
    byClass: Record<string, number>;
    updatedAt?: string;
  }>({
    queryKey: ["/api/counties", fips, "transmission"],
    enabled: !!fips,
  });

  const { data: headroom } = useQuery<{
    score: number;
    tier: "abundant" | "strong" | "moderate" | "constrained" | "limited";
    deliverableMwLow: number;
    deliverableMwHigh: number;
    timeToPowerMonths: number;
    withdrawalRatio: number | null;
    drivers: { label: string; detail: string; impact: number }[];
    confidence: "real" | "partial" | "synthetic";
  }>({
    queryKey: ["/api/counties", fips, "power-headroom"],
    enabled: !!fips,
  });

  const { data: powerPrice } = useQuery<{
    fips: string;
    state?: string;
    period?: string;
    industrialCentsPerKwh?: number;
    industrialDollarsPerMwh?: number;
    commercialCentsPerKwh?: number;
    yoyPct?: number | null;
  }>({
    queryKey: ["/api/counties", fips, "power-price"],
    enabled: !!fips,
  });

  const { data: comps } = useQuery<{
    own: Array<{ id: number; buyer: string; seller: string; acres: number; price_usd: number; price_per_acre: number; deal_date: string; deal_type: string; source_url: string; note: string | null }>;
    stateBenchmark: Array<{ id: number; county_name: string; buyer: string; acres: number; price_per_acre: number; deal_date: string; source_url: string }>;
    stateStats: null | { avg_ppa: number; min_ppa: number; max_ppa: number; n: number };
  }>({
    queryKey: ["/api/counties", fips, "comps"],
    enabled: !!fips,
  });

  const { data: parcels } = useQuery<{
    fips: string;
    industrial_polygons: number;
    industrial_acres: number;
    commercial_polygons: number;
    commercial_acres: number;
    brownfield_polygons: number;
    brownfield_acres: number;
    substations: number;
    large_industrial_buildings: number;
    features: Array<{ id: string; type: string; acres: number | null; lat: number; lng: number; name: string | null; tags: Record<string, string> }>;
    fetched_at: string;
  }>({
    queryKey: ["/api/counties", fips, "parcels"],
    enabled: !!fips,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const { data: waterStress } = useQuery<{
    fips: string;
    state?: string;
    waterStress: null | {
      state: string;
      stressScore: number;
      adjudicated: boolean;
      moratorium: boolean;
      coloradoRiverBasin: boolean;
      ogallalaDependent: boolean;
      notes: string;
      sourceUrl: string;
      updatedAt: string;
    };
  }>({
    queryKey: ["/api/counties", fips, "water-stress"],
    enabled: !!fips,
  });

  const { data: queueHistory } = useQuery<{
    fips: string;
    latest?: {
      snapshot_date: string;
      active_mw: number;
      withdrawn_mw: number;
      active_projects: number;
      withdrawn_projects: number;
    } | null;
    withdrawalRatio: number | null;
    timeline: Array<{ snapshot_date: string; active_mw: number; withdrawn_mw: number; active_projects: number; withdrawn_projects: number }>;
    rows: Array<{ iso: string; snapshot_date: string; active_mw: number; withdrawn_mw: number; active_projects: number; withdrawn_projects: number }>;
  }>({
    queryKey: ["/api/counties", fips, "queue-history"],
    enabled: !!fips,
  });

  const { data: scoreHistory } = useQuery<{
    fips: string;
    dayDelta: number;
    weekDelta: number;
    timeline: Array<{ snapshot_date: string; score: number; tier: string }>;
    current: any;
  }>({
    queryKey: ["/api/counties", fips, "score-history"],
    enabled: !!fips,
  });

  const { data: factorDeltas } = useQuery<{
    fips: string;
    hasHistory: boolean;
    today?: string;
    yesterday?: string;
    scoreDelta?: number;
    moratoriumChanged?: boolean;
    moratoriumToday?: string;
    moratoriumYesterday?: string;
    deltas: Array<{ key: string; label: string; today: number; yesterday: number; delta: number; direction: 1 | -1; magnitude: number }>;
  }>({
    queryKey: ["/api/counties", fips, "factor-deltas"],
    enabled: !!fips,
  });

  const { data: watchlist } = useQuery<Watchlist[]>({ queryKey: ["/api/watchlist"] });
  const inWatchlist = watchlist?.some((w) => w.countyFips === fips) ?? false;

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/watchlist", { countyFips: fips, note: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Added to watchlist" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/watchlist/${fips}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const chartData = useMemo(() => {
    if (!county?.factors) return [];
    return county.factors.map((f) => ({
      label: f.label,
      value: f.value,
      contribution: Number((f.contribution * 100).toFixed(1)),
      weight: (f.weight * 100).toFixed(0) + "%",
    }));
  }, [county]);

  if (isLoading || !county) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-40 col-span-2" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      {/* Breadcrumb + header */}
      <div className="flex flex-col gap-2">
        <Link
          href="/counties"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit"
          data-testid="link-back"
        >
          <ArrowLeft className="h-3 w-3" /> All counties
        </Link>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-county-name">
              {county.name} County, {county.state}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono flex-wrap">
              <span>FIPS {county.fips}</span>
              <span>·</span>
              <span>{county.iso ?? "—"}</span>
              <span>·</span>
              <span>{county.utility ?? "—"}</span>
            </div>
            <div className="mt-2">
              <ProvenanceBadge fips={county.fips} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ScoreBadge score={county.landingProbability ?? 0} tier={county.scoreTier ?? undefined} size="lg" />
            <Button
              variant={inWatchlist ? "secondary" : "default"}
              size="sm"
              onClick={() => (inWatchlist ? removeMutation.mutate() : addMutation.mutate())}
              disabled={addMutation.isPending || removeMutation.isPending}
              data-testid="button-watchlist"
            >
              <Star className={`h-3.5 w-3.5 mr-1.5 ${inWatchlist ? "fill-current" : ""}`} />
              {inWatchlist ? "In watchlist" : "Add to watchlist"}
            </Button>
            <Link href={`/compare?fips=${county.fips}`} data-testid="link-compare-from-detail">
              <Button variant="outline" size="sm">
                <GitCompare className="h-3.5 w-3.5 mr-1.5" />
                Compare
              </Button>
            </Link>
            <a
              href={`/api/counties/${county.fips}/site-brief.pdf`}
              target="_blank"
              rel="noreferrer"
              data-testid="link-site-brief-pdf"
            >
              <Button variant="outline" size="sm">
                <FileDown className="h-3.5 w-3.5 mr-1.5" />
                Site brief PDF
              </Button>
            </a>
          </div>
        </div>
        {county.moratoriumStatus && county.moratoriumStatus !== "none" && (
          <div className="flex items-center gap-2 rounded-md border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-orange-700 dark:text-orange-400">
              <strong className="font-semibold">Moratorium {county.moratoriumStatus}</strong> — active regulatory constraint on new DC development.
            </span>
          </div>
        )}
      </div>

      {/* Snapshot facts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SnapshotStat icon={Zap} label="Queued load" value={formatMw(county.queuedLoadMw)} sub="Interconnection queue" />
        <SnapshotStat icon={Cable} label="Fiber density" value={`${(county.fiberDensityScore ?? 0).toFixed(0)}/100`} sub={`${county.peeringExchangeCount ?? 0} exchanges`} />
        <SnapshotStat icon={MapPin} label="Large parcels" value={String(county.largeParcelCount ?? 0)} sub=">500 acres" />
        <SnapshotStat icon={DollarSign} label="Land price" value={county.medianLandPricePerAcre ? `$${(county.medianLandPricePerAcre / 1000).toFixed(0)}k/ac` : "—"} sub="Median" />
      </div>

      {/* Why this score? — plain-English explainability */}
      <WhyThisScore fips={fips} />

      {/* Power headroom — synthesized "how many MW, and when" answer */}
      {headroom && (
        <Card data-testid="card-power-headroom" className="border-primary/30">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Power headroom
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge
                  className={`text-[10px] uppercase ${
                    headroom.tier === "abundant" || headroom.tier === "strong"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40"
                      : headroom.tier === "moderate"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40"
                        : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40"
                  }`}
                >
                  {headroom.tier}
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase">{headroom.confidence}</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Deliverable-capacity estimate synthesized from substation headroom, ISO queue depth,
              transmission voltage, and nearby generation — the "how many MW, and when" question.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Headroom score</div>
                <div className="text-lg font-semibold tabular-nums">{Math.round(headroom.score)}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Deliverable MW</div>
                <div className="text-lg font-semibold tabular-nums">
                  {headroom.deliverableMwHigh > 0
                    ? `${headroom.deliverableMwLow}–${headroom.deliverableMwHigh}`
                    : "—"}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Time to power</div>
                <div className="text-lg font-semibold tabular-nums">~{headroom.timeToPowerMonths}mo</div>
              </div>
            </div>
            {headroom.drivers.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Drivers</div>
                {headroom.drivers.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-2 text-xs" data-testid={`headroom-driver-${d.label}`}>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{d.label}</span> · {d.detail}
                    </span>
                    <span className={`font-mono tabular-nums shrink-0 ${d.impact < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {d.impact > 0 ? "+" : ""}{d.impact}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Site-level activity: parcels + permits + bids for this county */}
      <CountyExtras fips={fips} />

      {/* Score history + factor waterfall (Gap 12) */}
      {scoreHistory && (
        <Card data-testid="card-score-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <LineChartIcon className="h-4 w-4 text-primary" />
              Score history & explainability
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Day-over-day and 30-day score movement, plus factor waterfall showing which inputs move the model.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-2">
                <div className="text-xs text-muted-foreground">1-day Δ</div>
                <div className={`text-lg font-semibold ${scoreHistory.dayDelta > 0 ? "text-green-600" : scoreHistory.dayDelta < 0 ? "text-red-600" : ""}`}>
                  {scoreHistory.dayDelta > 0 ? "+" : ""}{scoreHistory.dayDelta.toFixed(1)}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-xs text-muted-foreground">7-day Δ</div>
                <div className={`text-lg font-semibold ${scoreHistory.weekDelta > 0 ? "text-green-600" : scoreHistory.weekDelta < 0 ? "text-red-600" : ""}`}>
                  {scoreHistory.weekDelta > 0 ? "+" : ""}{scoreHistory.weekDelta.toFixed(1)}
                </div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-xs text-muted-foreground">Snapshots</div>
                <div className="text-lg font-semibold">{scoreHistory.timeline.length}</div>
              </div>
            </div>
            {scoreHistory.timeline.length > 1 && (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreHistory.timeline} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <XAxis dataKey="snapshot_date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="score" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {county.factors && county.factors.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium mb-1.5">Site-suitability radar (raw factor values 0-100)</div>
                <div className="h-56 rounded border border-border bg-card/60">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={county.factors.map((f: any) => ({ factor: (f.label ?? f.key).slice(0, 14), value: Math.max(0, Math.min(100, f.value ?? 0)) }))} outerRadius="75%">
                      <PolarGrid stroke="hsl(220 10% 30%)" />
                      <PolarAngleAxis dataKey="factor" tick={{ fill: "hsl(220 10% 65%)", fontSize: 9 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(220 10% 55%)", fontSize: 9 }} />
                      <Radar name="Score" dataKey="value" stroke="hsl(175 84% 45%)" fill="hsl(175 84% 45%)" fillOpacity={0.35} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {county.factors && county.factors.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1.5 flex items-center gap-2">
                  <span>Factor waterfall (weighted contribution to score)</span>
                  {factorDeltas?.hasHistory ? (
                    <span className="text-[10px] font-normal text-muted-foreground">→ chip shows day-over-day change in raw factor</span>
                  ) : null}
                </div>
                <div className="space-y-1">
                  {county.factors
                    .slice()
                    .sort((a: any, b: any) => (b.weight * b.value) - (a.weight * a.value))
                    .map((f: any) => {
                      const contribution = (f.weight ?? 0) * (f.value ?? 0);
                      const pct = Math.min(100, Math.abs(contribution));
                      const fd = factorDeltas?.deltas.find(d => d.key === f.key);
                      const chipColor = fd && Math.abs(fd.delta) > 0.001
                        ? (fd.delta * fd.direction > 0 ? "bg-green-500/20 text-green-700 dark:text-green-400" : "bg-red-500/20 text-red-700 dark:text-red-400")
                        : "bg-muted text-muted-foreground";
                      const chipLabel = fd && Math.abs(fd.delta) > 0.001
                        ? `${fd.delta > 0 ? "+" : ""}${fd.delta.toFixed(fd.magnitude >= 10 ? 0 : 2)}`
                        : "—";
                      return (
                        <div key={f.key} className="flex items-center gap-2 text-xs" data-testid={`factor-row-${f.key}`}>
                          <div className="w-40 truncate">{f.label ?? f.key}</div>
                          <div className="flex-1 h-4 rounded-sm bg-muted overflow-hidden">
                            <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="w-16 text-right font-mono">{contribution.toFixed(1)}</div>
                          <div className="w-14 text-right text-muted-foreground">w {((f.weight ?? 0) * 100).toFixed(0)}%</div>
                          {factorDeltas?.hasHistory ? (
                            <span className={`w-16 text-center text-[10px] font-mono rounded px-1 py-0.5 ${chipColor}`} title={fd ? `${fd.yesterday.toFixed(2)} → ${fd.today.toFixed(2)}` : "no change"} data-testid={`delta-${f.key}`}>
                              {chipLabel}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
                {factorDeltas?.moratoriumChanged ? (
                  <div className="mt-2 rounded border border-orange-500/40 bg-orange-500/10 text-[11px] px-2 py-1">
                    Moratorium status changed: <b>{factorDeltas.moratoriumYesterday ?? "—"}</b> → <b>{factorDeltas.moratoriumToday ?? "—"}</b>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Retail utilities (EIA-861) */}
      {utilities && utilities.utilities.length > 0 && (
        <Card data-testid="card-utilities">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Retail electric utilities
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Distribution utilities serving this county per EIA Form 861 Service Territory (vintage {utilities.vintage ?? "—"}). The "utility" field in the header is the ISO-queue transmission owner; these are the retail providers a hyperscaler would actually contract with for interconnection.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {utilities.utilities.map((u) => {
                const isHeader = county.utility && u.name.toLowerCase().includes(county.utility.toLowerCase().split(" ")[0] ?? "");
                return (
                  <span
                    key={u.number}
                    className={`text-xs px-2 py-0.5 rounded-md border ${
                      isHeader
                        ? "border-primary/40 bg-primary/10 text-primary font-medium"
                        : "border-border bg-muted/40 text-foreground"
                    }`}
                    data-testid={`text-utility-${u.number}`}
                    title={`EIA Utility ID ${u.number}`}
                  >
                    {u.name}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shell LLC activity */}
      {shellActivity && shellActivity.totalLlcCount > 0 && (
        <Card className="border-primary/40 bg-primary/[0.03]" data-testid="card-shell-activity">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Known hyperscaler shell-LLC activity
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Curated from press reporting, subprocessor lists, and public filings. Hyperscalers routinely acquire land through anonymous LLCs before disclosing operator identity.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {shellActivity.operators.map((op) => (
                <Badge key={op} className="bg-primary/15 text-primary hover:bg-primary/20 border-primary/30" data-testid={`badge-operator-${op}`}>
                  {op}
                </Badge>
              ))}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Shell LLCs identified ({shellActivity.totalLlcCount})</div>
              <div className="flex flex-wrap gap-1.5">
                {shellActivity.llcNames.map((name) => (
                  <span key={name} className="text-xs px-2 py-0.5 rounded-md border border-border bg-muted/40 text-foreground" data-testid={`text-llc-${name}`}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Power price (EIA state industrial retail) */}
      {powerPrice && powerPrice.industrialCentsPerKwh != null && (
        <Card data-testid="card-power-price">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Wholesale power price (proxy)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              State industrial retail electricity price from EIA Electric Power Monthly Table 5.6.A. Best free proxy for nodal LMP without a paid ISO market data license.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Industrial rate</div>
                <div className="text-lg font-semibold" data-testid="text-power-industrial">
                  {powerPrice.industrialCentsPerKwh.toFixed(2)} ¢/kWh
                </div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${powerPrice.industrialDollarsPerMwh?.toFixed(0)}/MWh
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">YoY change</div>
                <div className={`text-lg font-semibold ${
                  powerPrice.yoyPct != null && powerPrice.yoyPct > 5 ? "text-destructive" :
                  powerPrice.yoyPct != null && powerPrice.yoyPct < 0 ? "text-primary" : ""
                }`} data-testid="text-power-yoy">
                  {powerPrice.yoyPct != null ? `${powerPrice.yoyPct > 0 ? "+" : ""}${powerPrice.yoyPct.toFixed(1)}%` : "—"}
                </div>
                <div className="text-xs text-muted-foreground">vs. year ago</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Period</div>
                <div className="text-lg font-semibold" data-testid="text-power-period">{powerPrice.period ?? "—"}</div>
                <div className="text-xs text-muted-foreground">state {powerPrice.state}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transmission (HIFLD / NETL DOE) */}
      {transmission && transmission.totalKm > 0 && (() => {
        const rows = Object.entries(transmission.byClass)
          .filter(([, km]) => (km as number) > 0)
          .sort((a, b) => (b[1] as number) - (a[1] as number));
        const maxKm = Math.max(...rows.map(([, km]) => km as number));
        return (
          <Card data-testid="card-transmission">
            <CardHeader className="pb-3">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Transmission network
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                HIFLD electric transmission lines within ~35 km, via NETL DOE mirror. High-voltage density near a candidate site is the single strongest predictor of interconnection feasibility.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-muted-foreground">Total length</div>
                  <div className="text-lg font-semibold" data-testid="text-transmission-total-km">{transmission.totalKm.toFixed(0)} km</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Max voltage</div>
                  <div className="text-lg font-semibold" data-testid="text-transmission-max-kv">{transmission.maxVoltageKv ? `${transmission.maxVoltageKv} kV` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Segments</div>
                  <div className="text-lg font-semibold" data-testid="text-transmission-segments">{transmission.segmentCount}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {rows.map(([cls, km]) => {
                  const pct = ((km as number) / maxKm) * 100;
                  const highVoltage = cls === "500kV" || cls === "735kV+" || cls === "345kV";
                  return (
                    <div key={cls} className="flex items-center gap-2" data-testid={`bar-transmission-${cls}`}>
                      <div className="w-20 text-xs font-mono text-muted-foreground">{cls}</div>
                      <div className="flex-1 h-4 bg-muted/40 rounded overflow-hidden">
                        <div
                          className={`h-full ${highVoltage ? "bg-primary" : "bg-primary/40"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-16 text-right text-xs font-mono">{(km as number).toFixed(0)} km</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Comps: recent DC land deals (Gap 7) */}
      {comps && (comps.own.length > 0 || comps.stateBenchmark.length > 0) && (
        <Card data-testid="card-comps">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Recent land comps &mdash; DC transactions
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Curated transactions where a known operator, colo, or developer bought or leased land for AI/DC use. Prices are the acquisition price, not build-out capex. Use these to triangulate what you should ask for.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {comps.stateStats && comps.stateStats.n > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">State avg $/acre</div>
                  <div className="text-lg font-semibold">${(comps.stateStats.avg_ppa / 1000).toFixed(0)}k</div>
                  <div className="text-xs text-muted-foreground">{comps.stateStats.n} deals</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">State low</div>
                  <div className="text-lg font-semibold">${(comps.stateStats.min_ppa / 1000).toFixed(0)}k</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">State high</div>
                  <div className="text-lg font-semibold">${(comps.stateStats.max_ppa / 1000).toFixed(0)}k</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">In-county deals</div>
                  <div className="text-lg font-semibold">{comps.own.length}</div>
                </div>
              </div>
            )}
            {comps.own.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Buyer</TableHead>
                    <TableHead className="text-xs">Seller</TableHead>
                    <TableHead className="text-xs">Acres</TableHead>
                    <TableHead className="text-xs">$/acre</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comps.own.map((c) => (
                    <TableRow key={c.id} data-testid={`row-comp-own-${c.id}`}>
                      <TableCell className="text-xs font-mono py-2">{c.deal_date}</TableCell>
                      <TableCell className="text-xs py-2">{c.buyer}</TableCell>
                      <TableCell className="text-xs py-2 text-muted-foreground">{c.seller}</TableCell>
                      <TableCell className="text-xs font-mono py-2">{c.acres.toLocaleString()}</TableCell>
                      <TableCell className="text-xs font-mono py-2">${(c.price_per_acre / 1000).toFixed(0)}k</TableCell>
                      <TableCell className="text-xs py-2"><Badge variant="outline" className="text-[10px] capitalize">{c.deal_type.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="py-2"><a href={c.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">link <ExternalLink className="h-3 w-3" /></a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-xs text-muted-foreground">No public comps recorded in this county yet. Nearby state benchmarks below.</p>
            )}
            {comps.stateBenchmark.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1">Nearby (same state, other counties)</div>
                <div className="space-y-1">
                  {comps.stateBenchmark.slice(0, 8).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs" data-testid={`row-comp-nearby-${c.id}`}>
                      <span className="text-muted-foreground font-mono">{c.deal_date}</span>
                      <span>{c.buyer}</span>
                      <span className="text-muted-foreground">{c.county_name}</span>
                      <span className="font-mono">${(c.price_per_acre / 1000).toFixed(0)}k/ac · {c.acres.toLocaleString()} ac</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* OSM parcel/zoning inspector (Gap 6 + 8, scaffolds Gap 15) */}
      {parcels && (parcels.industrial_polygons + parcels.commercial_polygons + parcels.brownfield_polygons + parcels.substations > 0) && (
        <Card data-testid="card-parcels">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Ready-to-develop inventory (OSM proxy)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              OpenStreetMap features within 15km of the county centroid. Free proxy for the paid Regrid parcel dataset. Industrial/commercial landuse polygons are candidate site parcels; brownfields are re-developable industrial sites; substations mark viable interconnect points. Fetched {new Date(parcels.fetched_at).toLocaleDateString()}.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3 rounded-md bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">Industrial</div>
                <div className="text-lg font-semibold">{parcels.industrial_polygons}</div>
                <div className="text-xs text-muted-foreground">{parcels.industrial_acres.toLocaleString()} ac</div>
              </div>
              <div className="p-3 rounded-md bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">Commercial</div>
                <div className="text-lg font-semibold">{parcels.commercial_polygons}</div>
                <div className="text-xs text-muted-foreground">{parcels.commercial_acres.toLocaleString()} ac</div>
              </div>
              <div className="p-3 rounded-md bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">Brownfield</div>
                <div className="text-lg font-semibold">{parcels.brownfield_polygons}</div>
                <div className="text-xs text-muted-foreground">{parcels.brownfield_acres.toLocaleString()} ac</div>
              </div>
              <div className="p-3 rounded-md bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">Substations</div>
                <div className="text-lg font-semibold">{parcels.substations}</div>
                <div className="text-xs text-muted-foreground">interconnect nodes</div>
              </div>
              <div className="p-3 rounded-md bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">Large ind. bldgs</div>
                <div className="text-lg font-semibold">{parcels.large_industrial_buildings}</div>
                <div className="text-xs text-muted-foreground">2+ ac footprint</div>
              </div>
            </div>
            {parcels.features.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1">Top features by size</div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {parcels.features
                    .filter((f) => f.acres != null)
                    .sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0))
                    .slice(0, 20)
                    .map((f) => (
                      <div key={f.id} className="flex items-center justify-between text-xs gap-2" data-testid={`row-parcel-${f.id.replace(/\//g, "-")}`}>
                        <Badge variant="outline" className="text-[10px] capitalize">{f.type.replace(/_/g, " ")}</Badge>
                        <span className="flex-1 truncate">{f.name ?? "(unnamed)"}</span>
                        <span className="font-mono text-muted-foreground">{f.acres!.toLocaleString(undefined, { maximumFractionDigits: 0 })} ac</span>
                        <a href={`https://www.openstreetmap.org/${f.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                          OSM <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              This is a free proxy for Regrid parcel data. It misses ownership records, tax IDs, and out-of-map polygons — use it for triage only. For the shortlist you always fall back to a Regrid pull, county assessor site, or a title company.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Water stress / adjudicated basins (Gap 3) */}
      {waterStress?.waterStress && (() => {
        const w = waterStress.waterStress!;
        const rating = w.stressScore >= 0.75 ? "Severe" : w.stressScore >= 0.5 ? "High" : w.stressScore >= 0.3 ? "Moderate" : "Low";
        const ratingColor = w.stressScore >= 0.75 ? "text-destructive" : w.stressScore >= 0.5 ? "text-orange-500" : w.stressScore >= 0.3 ? "text-yellow-600 dark:text-yellow-500" : "text-primary";
        return (
          <Card data-testid="card-water-stress">
            <CardHeader className="pb-3">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <Droplet className="h-4 w-4 text-primary" />
                Water rights &amp; basin stress — state overlay
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                State-level composite stress score combining USGS 2020 water use, adjudication status, interstate compact obligations, aquifer-decline flags, and active new-use moratoriums. A hyperscaler in a red-flagged state may need to buy senior water rights or pay for treated municipal effluent.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Stress score</div>
                  <div className={`text-lg font-semibold ${ratingColor}`} data-testid="text-water-stress-score">
                    {(w.stressScore * 100).toFixed(0)}/100
                  </div>
                  <div className={`text-xs ${ratingColor}`}>{rating}</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Adjudicated</div>
                  <div className="text-lg font-semibold" data-testid="text-water-adjudicated">{w.adjudicated ? "Yes" : "No"}</div>
                  <div className="text-xs text-muted-foreground">{w.adjudicated ? "Rights capped" : "Open permitting"}</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Moratorium</div>
                  <div className={`text-lg font-semibold ${w.moratorium ? "text-destructive" : "text-primary"}`} data-testid="text-water-moratorium">{w.moratorium ? "Active" : "None"}</div>
                  <div className="text-xs text-muted-foreground">New industrial permits</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Basin flags</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.coloradoRiverBasin && <Badge variant="destructive" className="text-[10px]">Colorado River</Badge>}
                    {w.ogallalaDependent && <Badge variant="secondary" className="text-[10px]">Ogallala</Badge>}
                    {!w.coloradoRiverBasin && !w.ogallalaDependent && <span className="text-xs text-muted-foreground">None</span>}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{w.notes} <a href={w.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">source <ExternalLink className="h-3 w-3" /></a></p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Queue history / withdrawal ratio (Gap 5) */}
      {queueHistory?.latest && (queueHistory.latest.active_projects + queueHistory.latest.withdrawn_projects > 0) && (() => {
        const l = queueHistory.latest!;
        const total = l.active_projects + l.withdrawn_projects;
        const withdrawalPct = queueHistory.withdrawalRatio ?? 0;
        const perIso = queueHistory.rows
          .filter((r) => r.snapshot_date === l.snapshot_date)
          .sort((a, b) => (b.active_mw + b.withdrawn_mw) - (a.active_mw + a.withdrawn_mw));
        const withdrawalRating = withdrawalPct < 0.15 ? "low churn" : withdrawalPct < 0.35 ? "moderate churn" : "high churn";
        const withdrawalColor = withdrawalPct < 0.15 ? "text-primary" : withdrawalPct < 0.35 ? "text-foreground" : "text-destructive";
        return (
          <Card data-testid="card-queue-history">
            <CardHeader className="pb-3">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Interconnection queue — withdrawal history
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Snapshot rollup across every ISO/RTO queue that touches this county. Withdrawal ratio counts projects marked withdrawn/cancelled/terminated. Snapshot: {l.snapshot_date}.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Active MW</div>
                  <div className="text-lg font-semibold" data-testid="text-active-mw">{Math.round(l.active_mw).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{l.active_projects} projects</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Withdrawn MW</div>
                  <div className="text-lg font-semibold text-destructive" data-testid="text-withdrawn-mw">{Math.round(l.withdrawn_mw).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{l.withdrawn_projects} projects</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1"><TrendingDown className="h-3 w-3" />Withdrawal ratio</div>
                  <div className={`text-lg font-semibold ${withdrawalColor}`} data-testid="text-withdrawal-ratio">
                    {(withdrawalPct * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground">{withdrawalRating}</div>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <div className="text-xs text-muted-foreground mb-1">Total queue depth</div>
                  <div className="text-lg font-semibold" data-testid="text-total-projects">{total}</div>
                  <div className="text-xs text-muted-foreground">across {perIso.length} ISO{perIso.length === 1 ? "" : "s"}</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">By ISO</div>
                {perIso.map((r) => {
                  const isoTotal = r.active_mw + r.withdrawn_mw;
                  const isoProj = r.active_projects + r.withdrawn_projects;
                  const wr = isoProj > 0 ? r.withdrawn_projects / isoProj : 0;
                  return (
                    <div key={r.iso} className="flex items-center gap-2 text-xs" data-testid={`row-iso-${r.iso}`}>
                      <Badge variant="outline" className="font-mono w-16 justify-center">{r.iso}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono">{Math.round(isoTotal).toLocaleString()} MW · {isoProj} projects</span>
                          <span className={wr < 0.15 ? "text-primary" : wr < 0.35 ? "text-muted-foreground" : "text-destructive"}>
                            {(wr * 100).toFixed(0)}% withdrawn
                          </span>
                        </div>
                        <div className="h-1.5 rounded bg-muted overflow-hidden flex">
                          <div className="bg-primary" style={{ width: `${isoTotal > 0 ? (r.active_mw / isoTotal) * 100 : 0}%` }} />
                          <div className="bg-destructive" style={{ width: `${isoTotal > 0 ? (r.withdrawn_mw / isoTotal) * 100 : 0}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Signal: a county with a high queue depth AND a low withdrawal ratio is where developers are actually surviving the study process — which is the strongest tell that this land will be built on within 3–5 years.
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Historical trend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <LineChartIcon className="h-4 w-4 text-primary" />
            Score trajectory
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Landing-probability score over the last 12 months. Dashed line marks the hot-tier threshold (75).
          </p>
        </CardHeader>
        <CardContent>
          <ScoreSparkline fips={county.fips} currentScore={county.landingProbability ?? 0} height={160} />
        </CardContent>
      </Card>

      {/* Score breakdown chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Score breakdown</CardTitle>
          <p className="text-xs text-muted-foreground">
            Contribution of each factor to the composite landing-probability score (weight × factor value).
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 8, bottom: 8 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={130}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name, item) => [
                    `${value.toFixed(1)} (weight ${item.payload.weight})`,
                    "Factor score",
                  ]}
                />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={`hsl(175 84% ${45 - idx * 2}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Data provenance card */}
      <CountyProvenanceCard fips={fips} />

      {/* Signals & Parcels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Detected signals</CardTitle>
            <p className="text-xs text-muted-foreground">
              {county.signals.length} events feeding the parcel-trigger layer.
            </p>
          </CardHeader>
          <CardContent>
            {county.signals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No signals detected yet.</p>
            ) : (
              <div className="space-y-3">
                {county.signals.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border border-border p-3 cursor-pointer hover-elevate"
                    data-testid={`signal-${s.id}`}
                    onClick={() => setSelectedSignal(s)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono uppercase">
                        {s.signalType.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(s.detectedAt)}</span>
                    </div>
                    <div className="text-sm font-medium mt-1.5">{s.headline}</div>
                    {s.detail && <div className="text-xs text-muted-foreground mt-1">{s.detail}</div>}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      {s.suspectedOperator && s.suspectedOperator !== "unknown" && (
                        <span>
                          Operator: <span className="text-foreground">{s.suspectedOperator}</span>
                        </span>
                      )}
                      {s.shellLlc && (
                        <span className="font-mono">{s.shellLlc}</span>
                      )}
                      {s.parcelAcres && <span>{s.parcelAcres.toLocaleString()} ac</span>}
                    </div>
                    {s.sourceUrl && (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline mt-1 inline-block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.sourceName ?? "Source"} ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Candidate parcels</CardTitle>
            <p className="text-xs text-muted-foreground">
              Large parcels within this county, scored on grid/fiber proximity and ownership signals.
            </p>
          </CardHeader>
          <CardContent>
            {county.parcels.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No parcels tracked yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Owner</TableHead>
                      <TableHead className="text-right">Acres</TableHead>
                      <TableHead className="text-right">Sub mi</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {county.parcels.map((p) => (
                      <TableRow key={p.id} data-testid={`parcel-${p.id}`}>
                        <TableCell className="py-2">
                          <div className="text-xs font-medium">{p.ownerName ?? "Unknown"}</div>
                          {p.resolvedOperator && (
                            <div className="text-[10px] text-primary mt-0.5">→ {p.resolvedOperator}</div>
                          )}
                          {p.apn && <div className="text-[10px] font-mono text-muted-foreground">APN {p.apn}</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {p.acres.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {p.substationDistanceMi?.toFixed(1) ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ScoreBadge score={p.parcelScore ?? 0} size="sm" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk factors */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SnapshotStat icon={Droplet} label="Water stress" value={`${(county.waterStressScore ?? 0).toFixed(0)}/100`} sub="Aqueduct index" />
        <SnapshotStat icon={AlertTriangle} label="Hazard" value={`${(county.hazardScore ?? 0).toFixed(0)}/100`} sub="Flood/seismic/wildfire" />
        <SnapshotStat icon={DollarSign} label="Fiscal" value={`${(county.taxIncentiveScore ?? 0).toFixed(0)}/100`} sub="Incentive package" />
        <SnapshotStat icon={Cable} label="Cluster" value={`${county.existingDcCount ?? 0} DCs`} sub={`${formatMw(county.existingDcCapacityMw)} installed`} />
      </div>

      <SignalDetailModal
        signal={selectedSignal}
        countyName={`${county.name}, ${county.state}`}
        onClose={() => setSelectedSignal(null)}
      />
    </div>
  );
}

function SnapshotStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provenance card — shows what data quality (real | partial | synthetic)
// each scoring factor is running on for this county.
// ---------------------------------------------------------------------------

type ProvenanceRow = {
  id: number;
  fips: string;
  factorKey: string;
  quality: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  rawValue: string | null;
  note: string | null;
};

const PROV_FACTOR_LABEL: Record<string, string> = {
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
  transmissionDensity: "Transmission density",
  existingGridCapacityMw: "Existing grid capacity",
  gridGenerationMw: "Grid generation MW",
};

function CountyProvenanceCard({ fips }: { fips: string }) {
  const { data } = useQuery<ProvenanceRow[]>({ queryKey: ["/api/provenance", fips], enabled: !!fips });
  if (!data || data.length === 0) return null;

  const grouped = new Map<string, ProvenanceRow>();
  for (const r of data) {
    // De-dupe: prefer real > partial > synthetic
    const prior = grouped.get(r.factorKey);
    if (!prior) grouped.set(r.factorKey, r);
    else {
      const rank = (q: string) => q === "real" ? 3 : q === "partial" ? 2 : 1;
      if (rank(r.quality) > rank(prior.quality)) grouped.set(r.factorKey, r);
    }
  }
  const rows = Array.from(grouped.values());
  const realCount = rows.filter(r => r.quality === "real").length;
  const partialCount = rows.filter(r => r.quality === "partial").length;
  const synthCount = rows.filter(r => r.quality === "synthetic").length;

  return (
    <Card data-testid="card-county-provenance">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          Data provenance
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Where every number in this county's score comes from. Hover any row for the source URL and fetch timestamp.
        </p>
        <div className="flex gap-2 flex-wrap mt-2">
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {realCount} real
          </Badge>
          {partialCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
              <AlertTriangle className="h-3 w-3 mr-1" /> {partialCount} partial
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground">
            <HelpCircle className="h-3 w-3 mr-1" /> {synthCount} seed
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Factor</TableHead>
              <TableHead className="text-xs">Quality</TableHead>
              <TableHead className="text-xs">Source</TableHead>
              <TableHead className="text-xs">Fetched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`prov-${r.factorKey}`}>
                <TableCell className="py-2 text-sm font-medium">{PROV_FACTOR_LABEL[r.factorKey] ?? r.factorKey}</TableCell>
                <TableCell className="py-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase ${
                      r.quality === "real" ? "border-primary/40 text-primary"
                      : r.quality === "partial" ? "border-amber-500/40 text-amber-500"
                      : "border-muted-foreground/40 text-muted-foreground"
                    }`}
                  >
                    {r.quality}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 text-xs">
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1" title={r.note ?? ""}>
                    {r.sourceName}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TableCell>
                <TableCell className="py-2 text-xs text-muted-foreground font-mono">
                  {new Date(r.fetchedAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Why this score? — plain-English explainability ----
type FactorRow = {
  key: string;
  label: string;
  weight: number;
  value: number;
  contribution: number;
  share: number;
  dataQuality?: "real" | "partial" | "synthetic";
  sourceHint?: string;
};

type ScoreFactorsResponse = {
  fips: string;
  name: string;
  state: string;
  score: number;
  tier: string | null;
  factors: FactorRow[];
  strengths: FactorRow[];
  weaknesses: FactorRow[];
};

function WhyThisScore({ fips }: { fips: string }) {
  const { data, isLoading } = useQuery<ScoreFactorsResponse>({
    queryKey: ["/api/counties", fips, "factors"],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/counties/${fips}/factors`);
      if (!r.ok) throw new Error("factors failed");
      return r.json();
    },
    enabled: !!fips,
  });

  if (isLoading || !data) {
    return (
      <Card data-testid="card-why-this-score">
        <CardHeader className="pb-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            Why this score?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const top = data.factors.slice(0, 3);

  return (
    <Card data-testid="card-why-this-score">
      <CardHeader className="pb-3">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          Why this score?
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Plain-English breakdown of the {Math.round(data.score)} composite. Top three contributors, then the strongest and weakest factors driving the ranking.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top contributors */}
        <div>
          <div className="text-xs font-medium mb-2">Top contributors to the score</div>
          <div className="space-y-1.5">
            {top.map((f) => (
              <div key={f.key} className="flex items-center gap-2 text-xs" data-testid={`why-top-${f.key}`}>
                <div className="w-40 truncate font-medium">{f.label}</div>
                <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary/70 flex items-center px-1.5 text-[10px] font-mono text-primary-foreground"
                    style={{ width: `${Math.max(6, f.share * 100)}%` }}
                  >
                    {(f.share * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="w-16 text-right font-mono text-muted-foreground">
                  {(f.value ?? 0).toFixed(0)}/100
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] uppercase ${
                    f.dataQuality === "real"
                      ? "border-primary/40 text-primary"
                      : f.dataQuality === "partial"
                      ? "border-amber-500/40 text-amber-500"
                      : "border-muted-foreground/40 text-muted-foreground"
                  }`}
                >
                  {f.dataQuality ?? "seed"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Strengths + weaknesses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
            <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Strengths
            </div>
            {data.strengths.length === 0 ? (
              <div className="text-xs text-muted-foreground">No factor scores above 60. This county has few clear advantages.</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.strengths.map((f) => (
                  <li key={f.key} className="flex flex-col gap-0.5" data-testid={`why-strength-${f.key}`}>
                    <span className="font-medium">{f.label} — {(f.value ?? 0).toFixed(0)}/100</span>
                    {f.sourceHint && <span className="text-muted-foreground text-[11px]">{f.sourceHint}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5" /> Weaknesses
            </div>
            {data.weaknesses.length === 0 ? (
              <div className="text-xs text-muted-foreground">No factor scores below 40. Well-rounded profile.</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {data.weaknesses.map((f) => (
                  <li key={f.key} className="flex flex-col gap-0.5" data-testid={`why-weakness-${f.key}`}>
                    <span className="font-medium">{f.label} — {(f.value ?? 0).toFixed(0)}/100</span>
                    {f.sourceHint && <span className="text-muted-foreground text-[11px]">{f.sourceHint}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
