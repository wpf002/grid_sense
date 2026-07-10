import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { humanize } from "@/lib/utils";
import { pipelineLabel } from "@/lib/pipelines";
import { HeartPulse, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 15;

interface Pipe {
  pipeline: string;
  last_started: string;
  status: string;
  age_hours: number;
  stale: boolean;
}
interface Heartbeat {
  pipelines: Pipe[];
  stale_count: number;
  failing_count: number;
  checked_at: string;
}

/** Hours since a run, said the way a person would. */
function ageLabel(hours: number): string {
  if (hours < 1) return "Under an hour";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export default function Heartbeat({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading } = useQuery<Heartbeat>({
    queryKey: ["/api/cron/heartbeat"],
    refetchInterval: 60_000,
  });

  const [page, setPage] = useState(0);

  // Surface problems first — a stale or failing pipeline shouldn't hide on page 3.
  const pipelines = useMemo(() => {
    const rows = data?.pipelines ?? [];
    return [...rows].sort((a, b) => {
      const rank = (p: Pipe) => (p.status === "error" ? 0 : p.stale ? 1 : 2);
      return rank(a) - rank(b) || b.age_hours - a.age_hours;
    });
  }, [data]);

  const pageCount = Math.max(1, Math.ceil(pipelines.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = pipelines.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = pipelines.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd = Math.min(pipelines.length, (pageSafe + 1) * PAGE_SIZE);

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto"}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-primary" />
          Data Health
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every data pipeline and when it last ran. Each one refreshes on its own cadence — prices daily,
          ISO queues monthly, federal datasets quarterly — so a long gap is normal for the slow ones. A
          pipeline is flagged stale after 8 days without a successful run.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pipelines Tracked" value={data?.pipelines.length ?? "—"} tone="neutral" />
        <StatCard label="Stale (Over 8 Days)" value={data?.stale_count ?? "—"} tone={data?.stale_count ? "warn" : "ok"} />
        <StatCard label="Currently Failing" value={data?.failing_count ?? "—"} tone={data?.failing_count ? "err" : "ok"} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pipeline Freshness</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pipeline</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Freshness</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((p) => (
                    <TableRow key={p.pipeline} data-testid={`row-pipe-${p.pipeline}`}>
                      <TableCell className="text-sm">{pipelineLabel(p.pipeline)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(p.last_started).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">{ageLabel(p.age_hours)}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "ok" ? "outline" : p.status === "error" ? "destructive" : "secondary"}>
                          {humanize(p.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {p.stale ? (
                          <span className="inline-flex items-center gap-1 text-orange-600">
                            <AlertTriangle className="h-3 w-3" /> Stale
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3 w-3" /> LIVE
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pipelines.length > 0 && (
                <div className="flex items-center justify-between border-t pt-3 mt-3">
                  <span className="text-xs text-muted-foreground" data-testid="text-pipe-range">
                    Showing {rangeStart}–{rangeEnd} of {pipelines.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                      disabled={pageSafe === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      data-testid="button-pipe-prev"
                    >
                      <ChevronLeft className="h-3 w-3" /> Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">Page {pageSafe + 1} of {pageCount}</span>
                    <Button
                      size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                      disabled={pageSafe >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      data-testid="button-pipe-next"
                    >
                      Next <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: "ok" | "warn" | "err" | "neutral" }) {
  const color =
    tone === "ok"
      ? "text-green-600"
      : tone === "warn"
      ? "text-orange-600"
      : tone === "err"
      ? "text-red-600"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
