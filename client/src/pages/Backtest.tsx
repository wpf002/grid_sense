import { useQuery } from "@tanstack/react-query";
import { humanize } from "@/lib/utils";
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


type RankQuality = {
  available: boolean;
  positives?: number;
  totalCounties?: number;
  meanPercentileWithSignals?: number;
  meanPercentileFactorsOnly?: number;
  meanBoostPositives?: number;
  meanBoostAllCounties?: number;
  positivesWithSignal?: number;
};

type PitCutoff = {
  threshold: number;
  truePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number;
  f1: number | null;
  flagged: number;
};
type PitBasis = {
  basis: string;
  ready: boolean;
  notReady: string | null;
  coverage: number;
  evaluatedCount: number;
  totalAnnouncements: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
  metrics: {
    meanPercentile: number;
    medianPercentile: number;
    meanLeadDays: number;
    cutoffs: PitCutoff[];
  } | null;
};
type PitReport = {
  total: PitBasis;
  factorsOnly: PitBasis;
  outlook: { snapshotDays: number; earliest: string | null; latest: string | null; announcementsAfterHistoryStart: number; totalAnnouncements: number };
  uncoveredReasons: Record<string, number>;
};

/**
 * The honest backtest. Scores each announced county using only a snapshot taken
 * before the announcement, so post-announcement news cannot inflate it.
 *
 * Until score history reaches back past a real announcement this renders a
 * status, not a number. That is deliberate — a placeholder metric here would be
 * worse than none, because it's the metric the leakage disclosure points at.
 */
function PointInTimeCard() {
  const { data } = useQuery<PitReport>({ queryKey: ["/api/backtest/point-in-time"] });
  if (!data) return null;

  const { total, factorsOnly, outlook } = data;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <Card data-testid="card-point-in-time">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Point-in-Time Backtest</CardTitle>
          <Badge
            variant="outline"
            className={total.ready
              ? "border-green-500/50 text-green-600 dark:text-green-500"
              : "border-muted-foreground/40 text-muted-foreground"}
            data-testid="badge-pit-status"
          >
            {total.ready ? "Ready" : "Collecting History"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Scores each announced county using only a snapshot taken <em className="not-italic font-medium">before</em> the
          announcement. This is the measurement the leakage note above is waiting on — it can't be inflated by news
          published after the fact.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Announcements Scored" value={`${total.evaluatedCount} of ${total.totalAnnouncements}`} testId="stat-pit-covered" />
          <Stat label="Coverage" value={pct(total.coverage)} testId="stat-pit-coverage" />
          <Stat label="History Recorded" value={`${outlook.snapshotDays} ${outlook.snapshotDays === 1 ? "day" : "days"}`} testId="stat-pit-days" />
          <Stat label="History Starts" value={outlook.earliest ?? "—"} testId="stat-pit-earliest" />
        </div>

        {!total.ready ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Not enough history yet.</span> {total.notReady}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border px-3 py-2.5">
                <div className="text-xs text-muted-foreground">Factors only (leakage-free)</div>
                <div className="text-xl font-semibold tabular-nums" data-testid="text-pit-factors">
                  {factorsOnly.metrics ? pct(factorsOnly.metrics.meanPercentile) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">Mean percentile before announcement.</div>
              </div>
              <div className="rounded-md border px-3 py-2.5">
                <div className="text-xs text-muted-foreground">With signal boost</div>
                <div className="text-xl font-semibold tabular-nums text-muted-foreground" data-testid="text-pit-total">
                  {total.metrics ? pct(total.metrics.meanPercentile) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {total.metrics ? `Median ${pct(total.metrics.medianPercentile)}, ${Math.round(total.metrics.meanLeadDays)}d lead.` : ""}
                </div>
              </div>
            </div>

            {total.metrics && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 text-left font-medium">Score Cutoff</th>
                      <th className="py-1.5 text-right font-medium">Caught</th>
                      <th className="py-1.5 text-right font-medium">Missed</th>
                      <th className="py-1.5 text-right font-medium">Flagged</th>
                      <th className="py-1.5 text-right font-medium">Precision</th>
                      <th className="py-1.5 text-right font-medium">Recall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {total.metrics.cutoffs.map((c) => (
                      <tr key={c.threshold} className="border-b border-border/50" data-testid={`row-pit-cutoff-${c.threshold}`}>
                        <td className="py-1.5">≥ {c.threshold}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.truePositives}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.falseNegatives}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.flagged}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.precision == null ? "n/a" : pct(c.precision)}</td>
                        <td className="py-1.5 text-right tabular-nums">{pct(c.recall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums" data-testid={testId}>{value}</div>
    </div>
  );
}

// The headline "with signals" number is optimistic: news about an announcement
// lands as a signal in that very county, so the model is partly reading the
// answer. We show the leakage-free number next to it rather than only the
// flattering one.
function RankQualityCard() {
  const { data } = useQuery<RankQuality>({ queryKey: ["/api/backtest/rank-quality"] });
  if (!data?.available) return null;
  const pct = (v?: number) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const concentration =
    data.meanBoostAllCounties && data.meanBoostAllCounties > 0
      ? Math.round((data.meanBoostPositives ?? 0) / data.meanBoostAllCounties)
      : null;
  return (
    <Card data-testid="card-rank-quality">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ranking Quality</CardTitle>
        <p className="text-xs text-muted-foreground">
          Where the {data.positives} announced counties rank among all {data.totalCounties?.toLocaleString()}.
          Higher is better; 50% would be random.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-border px-3 py-2.5">
            <div className="text-xs text-muted-foreground">Factors only (leakage-free)</div>
            <div className="text-xl font-semibold tabular-nums" data-testid="text-rank-base">
              {pct(data.meanPercentileFactorsOnly)}
            </div>
            <div className="text-xs text-muted-foreground">The honest number.</div>
          </div>
          <div className="rounded-md border border-border px-3 py-2.5">
            <div className="text-xs text-muted-foreground">With signal boost</div>
            <div className="text-xl font-semibold tabular-nums text-muted-foreground" data-testid="text-rank-total">
              {pct(data.meanPercentileWithSignals)}
            </div>
            <div className="text-xs text-muted-foreground">Optimistic — see below.</div>
          </div>
        </div>
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Known limitation: partial label leakage.
            </span>{" "}
            <em className="not-italic font-medium text-foreground">Leakage</em> means the test accidentally sees
            the answer it's being graded on. Here's how it happens: when a data center is announced, reporters
            write about that county. We ingest that news as a signal, and signals raise the county's score. So a
            county can look high-scoring <em className="not-italic font-medium">because</em> it was announced —
            the opposite of predicting it.
          </div>
          <div>
            The evidence that this is happening: the signal boost is worth{" "}
            <span className="font-mono">{data.meanBoostPositives?.toFixed(2)}</span> points in announced counties
            but only <span className="font-mono">{data.meanBoostAllCounties?.toFixed(2)}</span> everywhere else
            {concentration ? ` — ${concentration}x more` : ""}. It's concentrated exactly where the answers are.
            (It's only <em className="not-italic font-medium">partial</em> leakage because just{" "}
            {data.positivesWithSignal} of {data.positives} announced counties carry a signal at all.)
          </div>
          <div>
            So read the left number, not the right one. With signals stripped out entirely, the factor model still
            ranks real landings at{" "}
            <span className="font-medium text-foreground">{pct(data.meanPercentileFactorsOnly)}</span> — it stands
            on its own without peeking. Settling this properly needs a point-in-time backtest, which requires score
            history from before each announcement. That history only starts accumulating now.
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
          Backtest — Announced AI Data Centers 2024-2026
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every hyperscaler AI data center publicly announced across {new Set(rows.map((r) => r.fips)).size} US
          counties. These are the answers. For each one we ask: does GridSense score that county highly today?
          A model worth trusting would have lit these counties up before the press releases dropped.
        </p>
      </div>

      <RankQualityCard />

      <PointInTimeCard />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card data-testid="tile-hit-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Hit Rate (≥ 70)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-primary">{(summary.hit_rate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">
              {summary.hits} of {summary.total - summary.not_tracked} announced counties we score as hot
            </div>
          </CardContent>
        </Card>
        <Card data-testid="tile-hit-near-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Hit + Near (≥ 55)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{(summary.hit_plus_near_rate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">
              {summary.hits + summary.nears} of {summary.total - summary.not_tracked} score hot or warm
            </div>
          </CardContent>
        </Card>
        <Card data-testid="tile-misses">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Misses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-destructive">{summary.misses}</div>
            <div className="text-xs text-muted-foreground">
              Real data centers landed here, but we score the county below 55. The model overlooked them.
            </div>
          </CardContent>
        </Card>
        <Card data-testid="tile-not-tracked">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Not Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-muted-foreground">{summary.not_tracked}</div>
            <div className="text-xs text-muted-foreground">Announced in a county we don't score at all</div>
          </CardContent>
        </Card>
        <Card data-testid="tile-total">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Announcements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{summary.total}</div>
            <div className="text-xs text-muted-foreground">2024-2026 rolling</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Announcements Ledger</CardTitle>
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
                      {humanize(r.status)}
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
              Precision / Recall at Score Cutoffs
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
