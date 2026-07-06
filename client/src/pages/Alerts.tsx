import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, BellOff, CheckCheck, Plus, Trash2, Power, Zap, AlertTriangle, Info, TrendingUp, Radio, Ban, Building2, Trophy } from "lucide-react";
import type { Alert, AlertSubscription, County } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const TRIGGER_TYPES = [
  { value: "score_crosses", label: "Score crosses threshold", icon: TrendingUp, needsNumeric: true, needsWindow: false, description: "Fire when a county's landing score rises above a number" },
  { value: "signal_burst", label: "Signal burst", icon: Radio, needsNumeric: true, needsWindow: true, description: "Fire when N or more signals arrive within X days" },
  { value: "moratorium_change", label: "Moratorium change", icon: Ban, needsNumeric: false, needsWindow: false, description: "Fire when a county's moratorium status flips" },
  { value: "new_operator", label: "New operator revealed", icon: Building2, needsNumeric: false, needsWindow: false, description: "Fire when a signal is tied to a suspected hyperscaler" },
  { value: "tier_upgrade", label: "Tier upgrade", icon: Trophy, needsNumeric: false, needsWindow: false, description: "Fire when a county enters the selected tier" },
] as const;

const TIER_OPTIONS = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "emerging", label: "Emerging" },
  { value: "cold", label: "Cold" },
];

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

function SubscriptionCard({
  sub,
  countyLookup,
  onDelete,
  onToggle,
}: {
  sub: AlertSubscription;
  countyLookup: Map<string, County>;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const trigger = TRIGGER_TYPES.find((t) => t.value === sub.triggerType);
  const scopeLabel = () => {
    if (sub.scope === "global") return "Any county (global)";
    if (sub.scope === "tier") return `Tier: ${sub.scopeValue}`;
    if (sub.scope === "county") {
      const c = countyLookup.get(sub.scopeValue ?? "");
      return c ? `${c.name}, ${c.state}` : sub.scopeValue;
    }
    return sub.scope;
  };
  const Icon = trigger?.icon ?? Bell;

  return (
    <Card className={`${sub.active ? "" : "opacity-50"}`} data-testid={`card-subscription-${sub.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="font-medium text-sm truncate" data-testid={`text-sub-name-${sub.id}`}>{sub.name}</div>
              <div className="text-[11px] text-muted-foreground">
                <span className="uppercase tracking-wider">{trigger?.label ?? sub.triggerType}</span>
                <span className="mx-1.5">·</span>
                <span>{scopeLabel()}</span>
                {sub.thresholdNumeric != null && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span>≥ {sub.thresholdNumeric}{sub.thresholdWindow ? ` in ${sub.thresholdWindow}d` : ""}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              onClick={onToggle}
              className="h-7 w-7"
              title={sub.active ? "Deactivate" : "Activate"}
              data-testid={`button-toggle-sub-${sub.id}`}
            >
              <Power className={`h-3.5 w-3.5 ${sub.active ? "text-primary" : "text-muted-foreground"}`} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title="Delete"
              data-testid={`button-delete-sub-${sub.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateSubscriptionDialog({ counties }: { counties: County[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"county" | "tier" | "global">("global");
  const [scopeValue, setScopeValue] = useState("");
  const [triggerType, setTriggerType] = useState<string>("tier_upgrade");
  const [thresholdNumeric, setThresholdNumeric] = useState("");
  const [thresholdWindow, setThresholdWindow] = useState("");

  const trigger = TRIGGER_TYPES.find((t) => t.value === triggerType);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        name: name.trim(),
        scope,
        scopeValue: scope === "global" ? null : scopeValue,
        triggerType,
        active: true,
      };
      if (trigger?.needsNumeric && thresholdNumeric) body.thresholdNumeric = Number(thresholdNumeric);
      if (trigger?.needsWindow && thresholdWindow) body.thresholdWindow = Number(thresholdWindow);
      const res = await apiRequest("POST", "/api/alert-subscriptions", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
      toast({ title: "Subscription created", description: "Initial matches evaluated." });
      setOpen(false);
      setName("");
      setScopeValue("");
      setThresholdNumeric("");
      setThresholdWindow("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to create", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const canSubmit =
    name.trim().length > 0 &&
    (scope === "global" || scopeValue.length > 0) &&
    (!trigger?.needsNumeric || thresholdNumeric.length > 0) &&
    (!trigger?.needsWindow || thresholdWindow.length > 0);

  const scopePlaceholder = scope === "tier" ? "Select a tier" : "Select a county";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5" data-testid="button-new-subscription">
          <Plus className="h-3.5 w-3.5" />
          New subscription
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New alert subscription</DialogTitle>
          <DialogDescription>
            Define a rule and we'll evaluate it now, then keep watching as new signals arrive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sub-name">Name</Label>
            <Input
              id="sub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., PJM hot tier upgrades"
              data-testid="input-sub-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => { setScope(v as any); setScopeValue(""); }}>
                <SelectTrigger data-testid="select-sub-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (any county)</SelectItem>
                  <SelectItem value="tier">Tier</SelectItem>
                  <SelectItem value="county">Specific county</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope !== "global" && (
              <div className="space-y-1.5">
                <Label>{scope === "tier" ? "Tier" : "County"}</Label>
                <Select value={scopeValue} onValueChange={setScopeValue}>
                  <SelectTrigger data-testid="select-sub-scope-value"><SelectValue placeholder={scopePlaceholder} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {scope === "tier"
                      ? TIER_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)
                      : counties.map((c) => (
                          <SelectItem key={c.fips} value={c.fips}>
                            {c.name}, {c.state}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Trigger type</Label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger data-testid="select-sub-trigger"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {trigger?.description && (
              <p className="text-[11px] text-muted-foreground pt-0.5">{trigger.description}</p>
            )}
          </div>

          {(trigger?.needsNumeric || trigger?.needsWindow) && (
            <div className="grid grid-cols-2 gap-3">
              {trigger.needsNumeric && (
                <div className="space-y-1.5">
                  <Label>{triggerType === "score_crosses" ? "Score threshold" : "Signal count"}</Label>
                  <Input
                    type="number"
                    value={thresholdNumeric}
                    onChange={(e) => setThresholdNumeric(e.target.value)}
                    placeholder={triggerType === "score_crosses" ? "70" : "3"}
                    data-testid="input-sub-threshold"
                  />
                </div>
              )}
              {trigger.needsWindow && (
                <div className="space-y-1.5">
                  <Label>Window (days)</Label>
                  <Input
                    type="number"
                    value={thresholdWindow}
                    onChange={(e) => setThresholdWindow(e.target.value)}
                    placeholder="30"
                    data-testid="input-sub-window"
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-sub-cancel">Cancel</Button>
          <Button
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="button-sub-create"
          >
            {createMutation.isPending ? "Creating…" : "Create subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Alerts() {
  const { toast } = useToast();

  const { data: alerts, isLoading: alertsLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: subscriptions, isLoading: subsLoading } = useQuery<AlertSubscription[]>({
    queryKey: ["/api/alert-subscriptions"],
  });
  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const countyLookup = new Map<string, County>((counties ?? []).map((c) => [c.fips, c]));

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

  const deleteSubMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/alert-subscriptions/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count-unack"] });
    },
  });

  const toggleSubMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/alert-subscriptions/${id}/toggle`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-subscriptions"] });
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
  const activeSubs = subscriptions?.filter((s) => s.active).length ?? 0;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto" data-testid="page-alerts">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Custom rules that fire when counties cross thresholds, signals cluster, or hyperscalers are revealed.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Alerts inbox */}
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
                  Create a subscription and we'll evaluate it against every county on record.
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Subscriptions rail */}
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Subscriptions</h2>
              <Badge variant="outline" className="text-[10px]">{activeSubs} active</Badge>
            </div>
            <CreateSubscriptionDialog counties={counties ?? []} />
          </div>

          {subsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : subscriptions && subscriptions.length > 0 ? (
            <div className="space-y-2">
              {subscriptions.map((s) => (
                <SubscriptionCard
                  key={s.id}
                  sub={s}
                  countyLookup={countyLookup}
                  onDelete={() => deleteSubMutation.mutate(s.id)}
                  onToggle={() => toggleSubMutation.mutate(s.id)}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center space-y-2">
                <Bell className="h-6 w-6 text-muted-foreground/50 mx-auto" />
                <div className="text-xs text-muted-foreground">
                  No subscriptions yet. Click "New subscription" to define your first rule.
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
