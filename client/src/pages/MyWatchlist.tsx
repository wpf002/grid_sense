// Per-user watchlist (auth-gated) — enriches user_watchlist rows with today's
// day-over-day score delta and shows the user's active alert rules alongside.

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Star, Trash2, Bell, LogIn, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";

type WatchRow = {
  fips: string;
  note: string | null;
  added_at: string;
  name: string;
  state: string;
  score: number | null;
  tier: string | null;
  queued_load_mw: number | null;
  iso: string | null;
  utility: string | null;
  dayDelta: number | null;
};

type Alert = {
  id: number;
  fips: string | null;
  operator: string | null;
  trigger_kind: string;
  email_enabled: number;
  created_at: string;
};

type Me = { id: number; email: string } | null;

function tierColor(t: string | null): string {
  switch (t) {
    case "hot": return "bg-teal-500/10 text-teal-500 border-teal-500/30";
    case "warm": return "bg-orange-500/10 text-orange-500 border-orange-500/30";
    case "emerging": return "bg-blue-500/10 text-blue-500 border-blue-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export default function MyWatchlistPage() {
  const { toast } = useToast();
  const { data: me, isLoading: meLoading } = useQuery<Me>({ queryKey: ["/api/auth/me"] });

  const authed = !!me?.id;

  const { data: rows, isLoading: watchLoading } = useQuery<WatchRow[]>({
    queryKey: ["/api/user/watchlist"],
    enabled: authed,
  });
  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ["/api/user/alerts"],
    enabled: authed,
  });

  const removeMutation = useMutation({
    mutationFn: async (fips: string) => {
      await apiRequest("DELETE", `/api/user/watchlist/${fips}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/watchlist"] });
      toast({ title: "Removed from your watchlist" });
    },
  });

  const addWatchMutation = useMutation({
    mutationFn: async (fips: string) => {
      await apiRequest("POST", `/api/user/watchlist`, { fips });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user/watchlist"] }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/user/alerts/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/user/alerts"] }),
  });

  if (meLoading) {
    return <div className="p-6"><Skeleton className="h-32" /></div>;
  }

  if (!authed) {
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <Card>
          <CardContent className="text-center py-16">
            <LogIn className="h-8 w-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-sm font-medium">Sign in to use your personal watchlist</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Personal accounts persist watchlists across devices and drive email alert rules.
            </p>
            <Link href="/account">
              <Button variant="outline" size="sm" data-testid="link-account">Sign in / create account</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sortedRows = (rows ?? []).slice().sort((a, b) => {
    const ad = a.dayDelta ?? 0;
    const bd = b.dayDelta ?? 0;
    if (Math.abs(bd) !== Math.abs(ad)) return Math.abs(bd) - Math.abs(ad);
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" />
          My Watchlist
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <b>{me!.email}</b>. Nightly snapshots compute the day-over-day score delta shown below.
        </p>
      </div>

      {watchLoading ? (
        <Skeleton className="h-40" />
      ) : sortedRows.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-sm">You haven't added any counties yet.</p>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Open a county detail page and add it to sync across your devices.</p>
            <Link href="/counties">
              <Button size="sm" variant="outline">Browse counties</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedRows.map((r) => {
            const d = r.dayDelta;
            const trendColor = d == null ? "text-muted-foreground" : d > 0 ? "text-green-600 dark:text-green-400" : d < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
            const Arrow = d == null || d === 0 ? null : d > 0 ? ArrowUpRight : ArrowDownRight;
            return (
              <Card key={r.fips} data-testid={`user-watch-${r.fips}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/counties/${r.fips}`} className="flex-1 min-w-0 hover:text-primary">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-sm truncate">{r.name}, {r.state}</div>
                        <Badge variant="outline" className={`text-[9px] uppercase tracking-wider ${tierColor(r.tier)}`}>
                          {r.tier ?? "cold"}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                        {r.iso ?? "—"} · {r.utility ?? "—"}
                      </div>
                    </Link>
                    <div className="text-right">
                      <div className="text-lg font-semibold font-mono">{r.score?.toFixed(0) ?? "—"}</div>
                      <div className={`text-xs font-mono flex items-center justify-end gap-1 ${trendColor}`}>
                        {Arrow ? <Arrow className="h-3 w-3" /> : null}
                        {d == null ? "no history" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                      </div>
                    </div>
                  </div>
                  {r.note ? (
                    <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">{r.note}</p>
                  ) : null}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] text-muted-foreground">
                      Added {new Date(r.added_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMutation.mutate(r.fips)}
                      disabled={removeMutation.isPending}
                      data-testid={`button-remove-${r.fips}`}
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Alert rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            My Alert Rules
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Rules are evaluated by the nightly snapshot. Email-enabled rules dispatch to <b>{me!.email}</b> once SMTP is configured.
          </p>
        </CardHeader>
        <CardContent>
          {!alerts || alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No alert rules yet. Create one from a county page or via the API.</p>
          ) : (
            <div className="space-y-1">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between border rounded-sm px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[9px] font-mono">{humanize(a.trigger_kind)}</Badge>
                    <span>
                      {a.fips ? `FIPS ${a.fips}` : a.operator ? `operator=${a.operator}` : "all counties"}
                    </span>
                    {a.email_enabled ? <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">email</Badge> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteAlertMutation.mutate(a.id)}
                    className="h-6 text-xs text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-alert-${a.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick add-rule helper */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add an Alert Rule</CardTitle>
          <p className="text-xs text-muted-foreground">
            Two rule types are supported right now:
            <br />• <b>Score change</b> — score moves ≥5 points in a day
            <br />• <b>Tier upgrade</b> — county crosses tier boundary
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={async () => {
              await apiRequest("POST", "/api/user/alerts", { trigger_kind: "SCORE_CHANGE", email_enabled: true });
              queryClient.invalidateQueries({ queryKey: ["/api/user/alerts"] });
              toast({ title: "Rule added" });
            }}
            data-testid="button-add-score-change"
          >
            + Score change (all)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={async () => {
              await apiRequest("POST", "/api/user/alerts", { trigger_kind: "TIER_UPGRADE", email_enabled: true });
              queryClient.invalidateQueries({ queryKey: ["/api/user/alerts"] });
              toast({ title: "Rule added" });
            }}
            data-testid="button-add-tier-upgrade"
          >
            + Tier upgrade (all)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
