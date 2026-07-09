import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { BellOff, CheckCheck, Zap, AlertTriangle, Info } from "lucide-react";
import type { Alert } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SeverityIcon({ sev }: { sev: string }) {
  if (sev === "critical") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (sev === "warning") return <Zap className="h-4 w-4 text-yellow-500" />;
  return <Info className="h-4 w-4 text-primary" />;
}

function AlertCard({ alert, onAck }: { alert: Alert; onAck: () => void }) {
  return (
    <Card
      className={`transition-all ${alert.acknowledged ? "opacity-60 border-border/30" : "border-border/60 hover-elevate"}`}
      data-testid={`card-alert-${alert.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 shrink-0">
              <SeverityIcon sev={alert.severity ?? "info"} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm" data-testid={`text-alert-title-${alert.id}`}>{alert.title}</span>
                {!alert.acknowledged && (
                  <Badge variant="outline" className="text-[10px] h-4 border-primary/60 text-primary">NEW</Badge>
                )}
                <Badge variant="outline" className="text-[10px] h-4 font-mono">{alert.countyFips}</Badge>
              </div>
              {alert.detail && (
                <p className="text-xs text-muted-foreground leading-relaxed">{alert.detail}</p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 pt-1">
                <span>{formatDate(alert.firedAt)}</span>
                <span>·</span>
                <Link href={`/counties/${alert.countyFips}`}>
                  <a className="hover:text-primary" data-testid={`link-alert-county-${alert.id}`}>Open county</a>
                </Link>
              </div>
            </div>
          </div>
          {!alert.acknowledged && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onAck}
              className="text-[11px] h-7"
              data-testid={`button-ack-alert-${alert.id}`}
            >
              Acknowledge
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const { toast } = useToast();

  const { data: alerts, isLoading: alertsLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const ackMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/alerts/${id}/ack`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
    },
  });

  const ackAllMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/alerts/ack-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
      toast({ title: "All alerts acknowledged" });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/alert-subscriptions/evaluate", {}),
    onSuccess: (res: any) => {
      res.json().then((data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
        toast({
          title: "Evaluation complete",
          description: `${data.fired ?? 0} new alerts fired.`,
        });
      });
    },
  });

  const unackCount = alerts?.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto" data-testid="page-alerts">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Custom rules that fire when counties cross thresholds, signals cluster, or hyperscalers are revealed.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Inbox</h2>
            {unackCount > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/40" data-testid="badge-unack-count">
                {unackCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => evaluateMutation.mutate()}
              disabled={evaluateMutation.isPending}
              className="text-[11px] h-7"
              data-testid="button-evaluate-now"
            >
              {evaluateMutation.isPending ? "Evaluating…" : "Evaluate now"}
            </Button>
            {unackCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ackAllMutation.mutate()}
                className="text-[11px] h-7 gap-1"
                data-testid="button-ack-all"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {alertsLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : alerts && alerts.length > 0 ? (
          <div className="space-y-2">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} onAck={() => ackMutation.mutate(a.id)} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center space-y-2">
              <BellOff className="h-8 w-8 text-muted-foreground/50 mx-auto" />
              <div className="text-sm font-medium">No alerts yet</div>
              <div className="text-xs text-muted-foreground">
                Alerts fire automatically as new signals arrive and counties cross your thresholds.
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
