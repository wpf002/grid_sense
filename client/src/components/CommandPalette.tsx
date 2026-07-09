import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, MapPin, Building2, Newspaper, LandPlot, FileText, Flame, LayoutDashboard, Bell, Map, GitCompareArrows, Users, Shield, Zap, Webhook, BookOpen, Sparkles, ListChecks, Grid3x3, LineChart, TrendingUp, Star, Radio, Activity, ArrowRight, DollarSign, Globe, KeyRound } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { apiRequest } from "@/lib/queryClient";

type SearchResult = {
  counties: Array<{ fips: string; name: string; state: string; iso: string | null; score: number | null; tier: string | null }>;
  operators: Array<{ name: string; count: number }>;
  signals: Array<{ id: string; headline: string; source: string; publishedAt: string | null; url: string | null }>;
  parcels: Array<{ id: string; apn: string | null; owner_name: string | null; resolved_operator: string | null; acres: number | null; parcel_score: number | null; county_fips: string; county_name: string | null; state: string | null }>;
  permits: Array<{ id: string; permit_type: string | null; applicant: string | null; resolved_operator: string | null; filed_date: string | null; status: string | null; megawatts: number | null; county_fips: string; county_name: string | null; state: string | null }>;
  bids: Array<{ id: string; county_fips: string; competing_operators: string | null; heat_score: number | null; recent_deals_90d: number | null; county_name: string | null; state: string | null }>;
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [, setLocation] = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data } = useQuery<SearchResult>({
    queryKey: ["/api/search", q],
    queryFn: async () => {
      if (!q || q.length < 2) return { counties: [], operators: [], signals: [], parcels: [], permits: [], bids: [] };
      const r = await apiRequest("GET", `/api/search?q=${encodeURIComponent(q)}`);
      return r.json();
    },
    enabled: open,
  });

  const go = (path: string) => {
    setOpen(false);
    setQ("");
    setLocation(path);
  };

  const goExternal = (url: string) => {
    setOpen(false);
    setQ("");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const jumpPages = [
    { path: "/", label: "Dashboard", Icon: LayoutDashboard },
    { path: "/counties", label: "Counties", Icon: Grid3x3 },
    { path: "/map", label: "National radar (map)", Icon: Map },
    { path: "/compare", label: "Compare counties", Icon: GitCompareArrows },
    { path: "/operators", label: "Operators", Icon: Building2 },
    { path: "/parcels", label: "Parcels", Icon: LandPlot },
    { path: "/permits", label: "Permits", Icon: FileText },
    { path: "/competitive", label: "Competitive bids", Icon: Flame },
    { path: "/signals", label: "Signals", Icon: Newspaper },
    { path: "/movers", label: "Movers", Icon: TrendingUp },
    { path: "/digest", label: "Digest", Icon: BookOpen },
    { path: "/alerts", label: "Alerts", Icon: Bell },
    { path: "/triggers", label: "Triggers", Icon: Sparkles },
    { path: "/watchlist", label: "Watchlist", Icon: Star },
    { path: "/my-watchlist", label: "My watchlist", Icon: Star },
    { path: "/portfolio", label: "Portfolio scorer", Icon: ListChecks },
    { path: "/backtest", label: "Backtest", Icon: LineChart },
    { path: "/data-quality", label: "Data quality", Icon: Shield },
    { path: "/ingestion-runs", label: "Ingestion runs", Icon: Activity },
    { path: "/heartbeat", label: "Heartbeat", Icon: Radio },
    { path: "/methodology", label: "Methodology", Icon: BookOpen },
    { path: "/api-docs", label: "API docs", Icon: KeyRound },
    { path: "/webhooks", label: "Webhooks", Icon: Webhook },
    { path: "/admin", label: "Admin", Icon: Zap },
    { path: "/lead-gen", label: "Lead-gen workflow", Icon: Users },
    { path: "/pricing", label: "Pricing", Icon: DollarSign },
    { path: "/landing", label: "Landing (public)", Icon: Globe },
  ];

  const filteredJumps = q.length < 2
    ? jumpPages
    : jumpPages.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()));

  const counties = data?.counties ?? [];
  const operators = data?.operators ?? [];
  const signals = data?.signals ?? [];
  const parcels = data?.parcels ?? [];
  const permits = data?.permits ?? [];
  const bids = data?.bids ?? [];
  const hasResults = counties.length + operators.length + signals.length + parcels.length + permits.length + bids.length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 hover:bg-accent transition-colors"
        data-testid="button-open-command-palette"
        aria-label="Open command palette"
      >
        <Search className="h-3 w-3" />
        <span>Search</span>
        <kbd className="ml-2 font-mono text-[10px] bg-muted px-1 rounded">⌘K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search counties, operators, parcels, permits, bids, signals…"
          value={q}
          onValueChange={setQ}
          data-testid="input-command-palette"
        />
        <CommandList>
          {filteredJumps.length > 0 && (
            <CommandGroup heading="Jump to page">
              {filteredJumps.slice(0, q.length < 2 ? 8 : 12).map((p) => (
                <CommandItem
                  key={p.path}
                  onSelect={() => go(p.path)}
                  data-testid={`command-page-${p.path.replace(/\//g, "-")}`}
                >
                  <p.Icon className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1">{p.label}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{p.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {q.length < 2 && (
            <div className="px-4 py-2 text-[10px] text-muted-foreground text-center">
              Type to search counties, operators, parcels, permits, bids, signals. Press <kbd className="font-mono">?</kbd> for shortcuts.
            </div>
          )}
          {q.length >= 2 && !hasResults && filteredJumps.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
          {counties.length > 0 && (
            <CommandGroup heading="Counties">
              {counties.slice(0, 6).map((c) => (
                <CommandItem
                  key={c.fips}
                  onSelect={() => go(`/counties/${c.fips}`)}
                  data-testid={`command-county-${c.fips}`}
                >
                  <MapPin className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1">
                    {c.name}, {c.state}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {c.iso ?? "—"} · {c.score != null ? Math.round(c.score) : "—"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {operators.length > 0 && (
            <CommandGroup heading="Operators">
              {operators.slice(0, 5).map((o) => (
                <CommandItem
                  key={o.name}
                  onSelect={() => go(`/operators`)}
                  data-testid={`command-operator-${o.name}`}
                >
                  <Building2 className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1">{o.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{o.count} sites</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {parcels.length > 0 && (
            <CommandGroup heading="Parcels">
              {parcels.slice(0, 5).map((p) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => go(`/counties/${p.county_fips}`)}
                  data-testid={`command-parcel-${p.id}`}
                >
                  <LandPlot className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1 truncate">
                    {p.apn ? `APN ${p.apn}` : "Parcel"}
                    {p.owner_name ? ` · ${p.owner_name}` : ""}
                    {p.county_name ? ` · ${p.county_name}, ${p.state}` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {p.acres ? `${Math.round(p.acres)}ac` : "—"} · {p.parcel_score != null ? Math.round(p.parcel_score) : "—"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {permits.length > 0 && (
            <CommandGroup heading="Permits">
              {permits.slice(0, 5).map((p) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => go(`/counties/${p.county_fips}`)}
                  data-testid={`command-permit-${p.id}`}
                >
                  <FileText className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1 truncate">
                    {p.permit_type ?? "Permit"}
                    {p.applicant ? ` · ${p.applicant}` : ""}
                    {p.county_name ? ` · ${p.county_name}, ${p.state}` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {p.megawatts ? `${Math.round(p.megawatts)}MW` : "—"} · {p.status ?? "—"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {bids.length > 0 && (
            <CommandGroup heading="Competitive Bids">
              {bids.slice(0, 5).map((b) => (
                <CommandItem
                  key={b.id}
                  onSelect={() => go(`/counties/${b.county_fips}`)}
                  data-testid={`command-bid-${b.id}`}
                >
                  <Flame className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1 truncate">
                    {b.county_name ? `${b.county_name}, ${b.state}` : "County"}
                    {b.competing_operators ? ` · ${b.competing_operators}` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Heat {b.heat_score != null ? Math.round(b.heat_score) : "—"} · {b.recent_deals_90d ?? 0} deals
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {signals.length > 0 && (
            <CommandGroup heading="Signals">
              {signals.slice(0, 5).map((s) => (
                <CommandItem
                  key={s.id}
                  onSelect={() => (s.url ? goExternal(s.url) : go("/signals"))}
                  data-testid={`command-signal-${s.id}`}
                >
                  <Newspaper className="mr-2 h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{s.headline}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{s.source}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
