import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, HelpCircle, ExternalLink, Target, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Skeleton } from "@/components/ui/skeleton";

interface PrRow {
  cutoff: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  flagged: number;
  precision: number;
  recall: number;
  f1: number;
}
interface PrResp {
  cutoffs: PrRow[];
  total_counties: number;
  total_positives: number;
  note: string;
}

interface Row {
  id: number;
  fips: string;
  county_name: string;
  state: string;
  operator: string;
  project_name: string | null;
  announced_mw: number | null;
  capex_usd_b: number | null;
  announced_date: string;
  status: string;
  source_url: string;
  notes: string | null;
  score: number | null;
  tier: string | null;
  scored: boolean;
  hit: boolean;
  near: boolean;
  miss: boolean;
  notTracked: boolean;
}

interface Summary {
  total: number;
  hits: number;
  nears: number;
  misses: number;
  not_tracked: number;
  hit_rate: number;
  hit_plus_near_rate: number;
}

export default function Backtest() {
  const { data, isLoading } = useQuery<{ rows: Row[]; summary: Summary }>({
    queryKey: ["/api/backtest/announcements"],
  });
  const { data: pr } = useQuery<PrResp>({
    queryKey: ["/api/backtest/precision-recall"],
  });

  if (isLoading || !data) {
    return (
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { rows, summary } = data;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Backtest — announced AI data centers 2024-2026
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curated list of publicly announced hyperscaler AI data-center projects across {new Set(rows.map((r) => r.fips)).size} US counties.
          For each, we check: did GridSense's current score flag this county as hot (score ≥ 70) or warm (55-70)?
          A robust siting model should have all of these lit up before the press releases dropped.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card data-testid="tile-hit-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Hit rate (≥ 70)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-primary">{(summary.hit_rate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">{summary.hits} of {summary.total - summary.not_tracked} tracked</div>
          </CardContent>
        </Card>
        <Card data-testid="tile-hit-near-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Hit + near (≥ 55)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{(summary.hit_plus_near_rate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">{summary.hits + summary.nears} of {summary.total - summary.not_tracked}</div>
          </CardContent>
        </Card>
        <Card data-testid="tile-misses">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Misses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">{summary.misses}</div>
            <div className="text-xs text-muted-foreground">Score below 55</div>
          </CardContent>
        </Card>
        <Card data-testid="tile-not-tracked">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Not tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-muted-foreground">{summary.not_tracked}</div>
            <div className="text-xs text-muted-foreground">County outside tracked-county universe</div>
          </CardContent>
        </Card>
        <Card data-testid="tile-total">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Announcements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.total}</div>
            <div className="text-xs text-muted-foreground">2024-2026 rolling</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Announcements ledger</CardTitle>
          <p className="text-xs text-muted-foreground">
            Sourced from company press releases, SEC filings, DCD, Reuters, Bloomberg, and WSJ. This is a curated best-effort list, not exhaustive. To improve backtest quality, we intentionally treat score at announcement time as approximated by the current score — the goal is directional: are the counties operators actually chose already flagged as good?
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Operator</TableHead>
                <TableHead className="text-xs">County</TableHead>
                <TableHead className="text-xs">MW</TableHead>
                <TableHead className="text-xs">Capex</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Score</TableHead>
                <TableHead className="text-xs">Verdict</TableHead>
                <TableHead className="text-xs">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`row-announcement-${r.id}`}>
                  <TableCell className="text-xs font-mono text-muted-foreground py-2">{r.announced_date}</TableCell>
                  <TableCell className="text-xs py-2">
                    <Badge variant="outline" className="text-xs">{r.operator}</Badge>
                  </TableCell>
                  <TableCell className="text-xs py-2">
                    {r.scored ? (
                      <Link href={`/counties/${r.fips}`} className="text-primary hover:underline">
                        {r.county_name}, {r.state}
                      </Link>
                    ) : (
                      <span>{r.county_name}, {r.state}</span>
                    )}
                    {r.project_name && <div className="text-[10px] text-muted-foreground">{r.project_name}</div>}
                  </TableCell>
                  <TableCell className="text-xs font-mono py-2">{r.announced_mw ? Math.round(r.announced_mw).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs font-mono py-2">
                    {r.capex_usd_b != null ? (r.capex_usd_b >= 1 ? `$${r.capex_usd_b.toFixed(1)}B` : `$${(r.capex_usd_b * 1000).toFixed(0)}M`) : "—"}
                  </TableCell>
                  <TableCell className="text-xs py-2">
                    <Badge variant={r.status === "operational" ? "default" : "secondary"} className="text-xs capitalize">
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs py-2">
                    {r.scored ? <ScoreBadge score={r.score!} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs py-2">
                    {r.hit && <span className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> hit</span>}
                    {r.near && <span className="inline-flex items-center gap-1 text-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> near</span>}
                    {r.miss && <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="h-3.5 w-3.5" /> miss</span>}
                    {r.notTracked && <span className="inline-flex items-center gap-1 text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" /> off-radar</span>}
                  </TableCell>
                  <TableCell className="py-2">
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                      link <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Precision / recall v2 */}
      {pr && (
        <Card data-testid="card-precision-recall">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Precision / recall at score cutoffs
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              For each threshold C, precision = share of flagged counties (score ≥ C) that actually had an announcement. Recall = share of announced counties we caught above C. F1 balances both.
              Universe: {pr.total_counties} scored counties, {pr.total_positives} with ≥ 1 announcement.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-64 px-4 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pr.cutoffs.map(r => ({ cutoff: r.cutoff, precision: r.precision * 100, recall: r.recall * 100, f1: r.f1 * 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 10% 25%)" />
                  <XAxis dataKey="cutoff" tick={{ fill: "hsl(220 10% 65%)", fontSize: 10 }} label={{ value: "Score cutoff", position: "insideBottom", offset: -4, fill: "hsl(220 10% 60%)", fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "hsl(220 10% 65%)", fontSize: 10 }} label={{ value: "%", angle: -90, position: "insideLeft", fill: "hsl(220 10% 60%)", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(220 20% 12%)", border: "1px solid hsl(220 15% 25%)", fontSize: 11 }} labelStyle={{ color: "hsl(220 10% 85%)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="precision" stroke="hsl(175 84% 55%)" strokeWidth={2} dot={false} name="Precision" />
                  <Line type="monotone" dataKey="recall" stroke="hsl(30 90% 60%)" strokeWidth={2} dot={false} name="Recall" />
                  <Line type="monotone" dataKey="f1" stroke="hsl(220 70% 60%)" strokeWidth={2} dot={false} name="F1" strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cutoff</TableHead>
                  <TableHead className="text-xs">Flagged</TableHead>
                  <TableHead className="text-xs text-primary">TP</TableHead>
                  <TableHead className="text-xs">FP</TableHead>
                  <TableHead className="text-xs">FN</TableHead>
                  <TableHead className="text-xs">Precision</TableHead>
                  <TableHead className="text-xs">Recall</TableHead>
                  <TableHead className="text-xs">F1</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pr.cutoffs.map((r) => (
                  <TableRow key={r.cutoff} data-testid={`row-pr-${r.cutoff}`}>
                    <TableCell className="text-xs font-mono py-2 font-semibold">≥ {r.cutoff}</TableCell>
                    <TableCell className="text-xs font-mono py-2">{r.flagged}</TableCell>
                    <TableCell className="text-xs font-mono py-2 text-primary">{r.tp}</TableCell>
                    <TableCell className="text-xs font-mono py-2">{r.fp}</TableCell>
                    <TableCell className="text-xs font-mono py-2">{r.fn}</TableCell>
                    <TableCell className="text-xs font-mono py-2">{(r.precision * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs font-mono py-2">{(r.recall * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs font-mono py-2 font-semibold">{r.f1.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">{pr.note}</div>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground space-y-2">
        <p>
          <strong>How to read this:</strong> Every "miss" or "off-radar" row is a lesson. If a hyperscaler is buying land in a county we scored below 55, either the county belongs on our watchlist (and we need to tune the scoring weights) or the operator paid a premium for reasons outside our model (tax incentive, land-owner relationship, existing footprint). Both are worth investigating.
        </p>
        <p>
          <strong>Caveat:</strong> Scores here reflect the current data snapshot, not the historical snapshot on the announcement date. Once we accumulate 90+ days of daily score history (via the daily cron), we'll swap to point-in-time scores.
        </p>
      </div>
    </div>
  );
}
