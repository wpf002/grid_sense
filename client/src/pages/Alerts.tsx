import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BellOff, CheckCheck, ArrowUpRight, ArrowDownRight, AlertTriangle, Info,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import type { Alert } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { parseAlert, alertSentence, firedAtLabel, type Direction } from "@/lib/alerts";

const PAGE_SIZE = 15;

// /api/alerts caps at 100 rows unless asked for more. The summary tiles count
// across the whole inbox, so fetch past that cap — otherwise "Unread" reports
// the cap rather than the truth.
const ALERTS_KEY = "/api/alerts?limit=1000";

const TIER_STYLE: Record<string, string> = {
  hot: "bg-red-500/15 text-red-700 dark:text-red-400",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  emerging: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  cold: "bg-muted text-muted-foreground",
};

function TierPill({ tier }: { tier: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TIER_STYLE[tier] ?? "bg-muted text-muted-foreground"}`}>
      {humanize(tier)}
    </span>
  );
}

function DirectionIcon({ direction, severity }: { direction: Direction; severity: string }) {
  if (direction === "up") return <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-500" />;
  if (direction === "down") return <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-500" />;
  if (severity === "critical") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function AlertRow({ alert, onAck }: { alert: Alert; onAck: () => void }) {
  const p = parseAlert(alert);
  const sentence = alertSentence(p, alert.detail ?? "");

  return (
    <Card
      className={`transition-all ${alert.acknowledged ? "opacity-55" : "hover-elevate"}`}
      data-testid={`card-alert-${alert.id}`}
    >
      <CardContent className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 shrink-0">
          <DirectionIcon direction={p.direction} severity={alert.severity ?? "info"} />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/counties/${alert.countyFips}`}
              className="text-sm font-medium hover:text-primary hover:underline"
              data-testid={`link-alert-county-${alert.id}`}
            >
              {p.place ?? alert.title}
            </Link>
            {p.fromTier && p.toTier && (
              <span className="inline-flex items-center gap-1.5">
                <TierPill tier={p.fromTier} />
                <span className="text-muted-foreground text-xs">→</span>
                <TierPill tier={p.toTier} />
              </span>
            )}
            {!alert.acknowledged && (
              <Badge variant="outline" className="h-4 border-primary/60 text-[10px] text-primary">New</Badge>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">{sentence}</p>

          <div className="pt-0.5 text-[11px] text-muted-foreground/70">
            {firedAtLabel(alert.firedAt)} · County {alert.countyFips}
          </div>
        </div>

        {!alert.acknowledged && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onAck}
            className="h-7 shrink-0 text-[11px]"
            data-testid={`button-ack-alert-${alert.id}`}
          >
            Mark Read
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

type Filter = "all" | "unread" | "upgrades" | "downgrades";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "upgrades", label: "Upgrades" },
  { key: "downgrades", label: "Downgrades" },
];

export default function Alerts() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const { data: alerts, isLoading } = useQuery<Alert[]>({ queryKey: [ALERTS_KEY] });

  const ackMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/alerts/${id}/ack`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ALERTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
    },
  });

  const ackAllMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/alerts/ack-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ALERTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
      toast({ title: "All Alerts Marked Read" });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/alert-subscriptions/evaluate", {}),
    onSuccess: (res: any) => {
      res.json().then((data: any) => {
        queryClient.invalidateQueries({ queryKey: [ALERTS_KEY] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
        toast({ title: "Evaluation Complete", description: `${data.fired ?? 0} new alerts fired.` });
      });
    },
  });

  const all = alerts ?? [];
  const unackCount = all.filter((a) => !a.acknowledged).length;

  const counts = useMemo(() => {
    let up = 0, down = 0;
    for (const a of all) {
      const d = parseAlert(a).direction;
      if (d === "up") up++;
      else if (d === "down") down++;
    }
    return { up, down };
  }, [all]);

  const filtered = useMemo(() => {
    if (filter === "unread") return all.filter((a) => !a.acknowledged);
    if (filter === "upgrades") return all.filter((a) => parseAlert(a).direction === "up");
    if (filter === "downgrades") return all.filter((a) => parseAlert(a).direction === "down");
    return all;
  }, [all, filter]);

  // Keep the page in range when the filter shrinks the list under the cursor.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (pageSafe + 1) * PAGE_SIZE);

  const selectFilter = (f: Filter) => { setFilter(f); setPage(0); };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6" data-testid="page-alerts">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          A county's score changed enough to be worth a look. Alerts fire when a county crosses a tier
          boundary, when signals cluster, or when a hyperscaler is tied to a shell LLC.
        </p>
      </header>

      {/* Summary strip — the shape of the inbox at a glance. */}
      {!isLoading && all.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Unread</div>
            <div className="text-lg font-semibold" data-testid="stat-unread">{unackCount}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Moved Up</div>
            <div className="text-lg font-semibold text-green-600 dark:text-green-500" data-testid="stat-upgrades">{counts.up}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Moved Down</div>
            <div className="text-lg font-semibold text-red-600 dark:text-red-500" data-testid="stat-downgrades">{counts.down}</div>
          </CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "secondary" : "ghost"}
              className="h-7 text-[11px]"
              onClick={() => selectFilter(f.key)}
              data-testid={`button-filter-${f.key}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => evaluateMutation.mutate()}
            disabled={evaluateMutation.isPending}
            data-testid="button-evaluate-now"
          >
            {evaluateMutation.isPending ? "Evaluating…" : "Evaluate Now"}
          </Button>
          {unackCount > 0 && (
            <Button
              size="sm" variant="ghost" className="h-7 gap-1 text-[11px]"
              onClick={() => ackAllMutation.mutate()}
              data-testid="button-ack-all"
            >
              <CheckCheck className="h-3 w-3" /> Mark All Read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : paged.length > 0 ? (
        <>
          <div className="space-y-2">
            {paged.map((a) => (
              <AlertRow key={a.id} alert={a} onAck={() => ackMutation.mutate(a.id)} />
            ))}
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground" data-testid="text-alert-range">
              Showing {rangeStart}–{rangeEnd} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                disabled={pageSafe === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                data-testid="button-page-prev"
              >
                <ChevronLeft className="h-3 w-3" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {pageSafe + 1} of {pageCount}</span>
              <Button
                size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                disabled={pageSafe >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                data-testid="button-page-next"
              >
                Next <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="space-y-2 p-8 text-center">
            <BellOff className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <div className="text-sm font-medium">
              {all.length === 0 ? "No Alerts Yet" : "Nothing Matches This Filter"}
            </div>
            <div className="text-xs text-muted-foreground">
              {all.length === 0
                ? "Alerts fire automatically as new signals arrive and counties cross your thresholds."
                : "Try a different filter to see the rest of your alerts."}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
