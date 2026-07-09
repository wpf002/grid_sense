import { useMemo, useState } from "react";
import { humanize } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Zap, Filter, ArrowRight, AlertCircle } from "lucide-react";
import type { TriggerCounty } from "@shared/schema";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Triggers({ embedded = false }: { embedded?: boolean } = {}) {
  const [minCount, setMinCount] = useState("3");
  const [windowDays, setWindowDays] = useState("90");

  const { data: triggers, isLoading } = useQuery<TriggerCounty[]>({
    queryKey: ["/api/triggers", minCount, windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/triggers?min=${minCount}&days=${windowDays}`);
      if (!res.ok) throw new Error("Failed to load triggers");
      return res.json();
    },
  });

  const summary = useMemo(() => {
    if (!triggers) return null;
    const totalSignals = triggers.reduce((s, t) => s + t.recentSignalCount, 0);
    const hotCount = triggers.filter((t) => t.scoreTier === "hot").length;
    return { count: triggers.length, totalSignals, hotCount };
  }, [triggers]);

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto"}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md border border-border bg-card flex items-center justify-center">
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-triggers-title">
            Signal cluster triggers
          </h1>
          <p className="text-xs text-muted-foreground">
            Counties where multiple predictive signals fired within a narrow window. High-conviction watch list.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Trigger threshold</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Min signals:</span>
            <Select value={minCount} onValueChange={setMinCount}>
              <SelectTrigger className="w-[80px] h-8" data-testid="select-min-count">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Window:</span>
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger className="w-[130px] h-8" data-testid="select-window-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">365 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {summary && (
            <div className="ml-auto flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Triggered: </span>
                <span className="font-mono font-semibold" data-testid="text-trigger-count">
                  {summary.count}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Total recent signals: </span>
                <span className="font-mono font-semibold">{summary.totalSignals}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Hot: </span>
                <span className="font-mono font-semibold text-primary">{summary.hotCount}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active triggers</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ranked by weighted signal score (weight × confidence, summed across recent signals).
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !triggers || triggers.length === 0 ? (
            <div className="py-12 text-center space-y-3" data-testid="empty-triggers">
              <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">
                No counties currently meet the {minCount}-signal threshold in the last {windowDays} days.
              </p>
              <p className="text-xs text-muted-foreground">
                Try loosening the threshold or widening the window.
              </p>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                  onClick={() => { setMinCount("2"); setWindowDays("180"); }}
                  data-testid="button-loosen-triggers"
                >
                  Loosen to 2 signals · 180 days
                </button>
                <button
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
                  onClick={() => { setMinCount("3"); setWindowDays("90"); }}
                  data-testid="button-reset-triggers"
                >
                  Reset defaults
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>County</TableHead>
                    <TableHead className="text-right">Signals</TableHead>
                    <TableHead className="text-right">Weighted</TableHead>
                    <TableHead>Signal types</TableHead>
                    <TableHead className="text-right">Latest</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triggers.map((t) => (
                    <TableRow
                      key={t.fips}
                      className="hover-elevate"
                      data-testid={`row-trigger-${t.fips}`}
                    >
                      <TableCell className="py-2.5">
                        <Link
                          href={`/counties/${t.fips}`}
                          className="font-medium text-sm hover:text-primary transition-colors"
                          data-testid={`link-county-${t.fips}`}
                        >
                          {t.name}, {t.state}
                        </Link>
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          FIPS {t.fips}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        <span className="inline-flex items-center justify-center h-6 min-w-[28px] px-1.5 rounded bg-primary/15 text-primary font-semibold">
                          {t.recentSignalCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {t.weightedSignalScore.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {t.signalTypes.slice(0, 4).map((st) => (
                            <Badge
                              key={st}
                              variant="outline"
                              className="text-[10px] font-mono uppercase"
                            >
                              {humanize(st)}
                            </Badge>
                          ))}
                          {t.signalTypes.length > 4 && (
                            <span className="text-[10px] text-muted-foreground self-center">
                              +{t.signalTypes.length - 4}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatDate(t.latestSignalDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreBadge
                          score={t.landingProbability}
                          tier={t.scoreTier}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/counties/${t.fips}`}
                          data-testid={`link-open-${t.fips}`}
                          aria-label={`Open ${t.name}, ${t.state}`}
                        >
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                        </Link>
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
  );
}
