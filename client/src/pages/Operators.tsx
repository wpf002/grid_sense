import { useQuery } from "@tanstack/react-query";
import { humanize } from "@/lib/utils";
import { useState } from "react";
import { Link } from "wouter";
import { Building2, ChevronDown, ChevronUp, Sparkles, ExternalLink, LandPlot, FileText, Flame, Newspaper, Radar } from "lucide-react";
import type { Operator } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreBadge } from "@/components/ScoreBadge";

interface Profile {
  n_sites: number;
  n_scored: number;
  avg_score: number | null;
  avg_queued_load_mw: number | null;
  avg_substation_headroom_mva: number | null;
  avg_time_to_power_months: number | null;
  avg_fiber_density_score: number | null;
  avg_hazard_score: number | null;
  avg_water_stress_score: number | null;
  avg_tax_incentive_score: number | null;
  total_mw: number;
  total_capex_usd_b: number;
  iso_mix: [string, number][];
  utility_mix: [string, number][];
  state_mix: [string, number][];
}

interface Site {
  fips: string;
  county: string;
  state: string;
  announced_date: string;
  announced_mw: number | null;
  capex_usd_b: number | null;
  status: string;
  source_url: string;
  score: number | null;
}

interface OperatorProfileResp {
  operator: string;
  sites: Site[];
  profile: Profile | null;
  note?: string;
}

interface ActivityResp {
  operator: string;
  shell_llcs: string[];
  parcels: Array<{ id: string; apn: string | null; owner_name: string | null; resolved_operator: string | null; acres: number | null; parcel_score: number | null; status: string | null; last_transfer_date: string | null; county_fips: string; county_name: string | null; state: string | null }>;
  permits: Array<{ id: string; permit_type: string | null; applicant: string | null; resolved_operator: string | null; filed_date: string | null; status: string | null; megawatts: number | null; acres: number | null; description: string | null; source_url: string | null; county_fips: string; county_name: string | null; state: string | null }>;
  bids: Array<{ id: string; county_fips: string; competing_operators: string | null; recent_deals_90d: number | null; avg_deal_size_mw: number | null; heat_score: number | null; narrative: string | null; updated_at: string | null; county_name: string | null; state: string | null }>;
  signals: Array<{ id: string; signal_type: string | null; headline: string | null; detail: string | null; suspected_operator: string | null; shell_llc: string | null; parcel_acres: number | null; detected_at: string | null; source_url: string | null; source_name: string | null; county_fips: string; county_name: string | null; state: string | null }>;
  totals: { parcels: number; permits: number; bids: number; signals: number };
}

function fmtActDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

function OperatorActivity({ name }: { name: string }) {
  const { data, isLoading } = useQuery<ActivityResp>({
    queryKey: ["/api/operators", name, "activity"],
  });
  if (isLoading) return <Skeleton className="h-40" />;
  if (!data) return <div className="text-xs text-muted-foreground py-2">No activity data.</div>;
  const t = data.totals;
  const total = t.parcels + t.permits + t.bids + t.signals;
  if (total === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">No parcels, permits, bids, or signals matched to this operator yet.</div>;
  }
  return (
    <Tabs defaultValue={t.signals > 0 ? "signals" : t.permits > 0 ? "permits" : t.parcels > 0 ? "parcels" : "bids"} className="w-full">
      <TabsList className="grid w-full grid-cols-4 h-8">
        <TabsTrigger value="signals" className="text-[10px]" data-testid={`tab-op-signals-${name}`}>
          <Newspaper className="h-3 w-3 mr-1" />{t.signals}
        </TabsTrigger>
        <TabsTrigger value="parcels" className="text-[10px]" data-testid={`tab-op-parcels-${name}`}>
          <LandPlot className="h-3 w-3 mr-1" />{t.parcels}
        </TabsTrigger>
        <TabsTrigger value="permits" className="text-[10px]" data-testid={`tab-op-permits-${name}`}>
          <FileText className="h-3 w-3 mr-1" />{t.permits}
        </TabsTrigger>
        <TabsTrigger value="bids" className="text-[10px]" data-testid={`tab-op-bids-${name}`}>
          <Flame className="h-3 w-3 mr-1" />{t.bids}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="signals" className="mt-3 max-h-56 overflow-y-auto">
        <div className="space-y-1.5">
          {data.signals.slice(0, 15).map((s) => (
            <div key={s.id} className="text-[11px] rounded border border-border p-2" data-testid={`op-signal-${s.id}`}>
              <div className="flex items-start justify-between gap-2 mb-0.5">
                <Badge variant="outline" className="text-[9px] uppercase">{humanize(s.signal_type ?? "signal")}</Badge>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtActDate(s.detected_at)}</span>
              </div>
              <div className="font-medium">{s.headline ?? "(no headline)"}</div>
              {s.county_name && (
                <Link href={`/counties/${s.county_fips}`} className="text-[10px] text-primary hover:underline">
                  {s.county_name}, {s.state}
                </Link>
              )}
              {s.shell_llc && <span className="text-[10px] text-muted-foreground font-mono ml-2">{s.shell_llc}</span>}
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="parcels" className="mt-3 max-h-56 overflow-y-auto">
        <div className="space-y-1">
          {data.parcels.slice(0, 20).map((p) => (
            <div key={p.id} className="text-[11px] flex items-center justify-between gap-2 py-1 border-b border-border/40" data-testid={`op-parcel-${p.id}`}>
              <div className="flex-1 min-w-0 truncate">
                <span className="font-medium">{p.owner_name ?? p.apn ?? "Parcel"}</span>
                {p.county_name && (
                  <Link href={`/counties/${p.county_fips}`} className="text-primary hover:underline ml-1">
                    · {p.county_name}, {p.state}
                  </Link>
                )}
              </div>
              <span className="font-mono text-muted-foreground text-[10px] shrink-0">
                {p.acres != null ? `${Math.round(p.acres).toLocaleString()}ac` : "—"} · {p.parcel_score != null ? Math.round(p.parcel_score) : "—"}
              </span>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="permits" className="mt-3 max-h-56 overflow-y-auto">
        <div className="space-y-1">
          {data.permits.slice(0, 20).map((p) => (
            <div key={p.id} className="text-[11px] flex items-center justify-between gap-2 py-1 border-b border-border/40" data-testid={`op-permit-${p.id}`}>
              <div className="flex-1 min-w-0 truncate">
                <Badge variant="outline" className="text-[9px] mr-1">{p.permit_type ?? "—"}</Badge>
                <span>{p.applicant ?? "Applicant"}</span>
                {p.county_name && (
                  <Link href={`/counties/${p.county_fips}`} className="text-primary hover:underline ml-1">
                    · {p.county_name}, {p.state}
                  </Link>
                )}
              </div>
              <span className="font-mono text-muted-foreground text-[10px] shrink-0">
                {fmtActDate(p.filed_date)} · {p.megawatts != null ? `${Math.round(p.megawatts)}MW` : "—"}
              </span>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="bids" className="mt-3 max-h-56 overflow-y-auto">
        <div className="space-y-1.5">
          {data.bids.slice(0, 15).map((b) => (
            <div key={b.id} className="text-[11px] rounded border border-border p-2" data-testid={`op-bid-${b.id}`}>
              <div className="flex items-center justify-between mb-0.5">
                <Link href={`/counties/${b.county_fips}`} className="font-medium text-primary hover:underline">
                  {b.county_name ?? "County"}, {b.state}
                </Link>
                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40 text-[9px]">
                  Heat {b.heat_score != null ? Math.round(b.heat_score) : "—"}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {b.recent_deals_90d ?? 0} deals · avg {b.avg_deal_size_mw != null ? Math.round(b.avg_deal_size_mw) : "—"} MW
              </div>
              {b.competing_operators && (
                <div className="text-[10px] mt-0.5">vs {b.competing_operators}</div>
              )}
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function OperatorPlaybook({ name }: { name: string }) {
  const { data, isLoading } = useQuery<OperatorProfileResp>({
    queryKey: ["/api/operators", name, "profile"],
  });
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data || !data.profile) return (
    <div className="text-xs text-muted-foreground py-2">{data?.note ?? "No announcement history for this operator yet."}</div>
  );
  const p = data.profile;
  const fmt = (v: number | null, digits = 0) => (v == null ? "—" : v.toFixed(digits));
  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Avg score</div>
          <div className="font-mono font-semibold">{fmt(p.avg_score, 1)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Sites</div>
          <div className="font-mono font-semibold">{p.n_sites}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Total MW</div>
          <div className="font-mono font-semibold">{p.total_mw.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Total capex</div>
          <div className="font-mono font-semibold">${p.total_capex_usd_b.toFixed(1)}B</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Queue MW</div>
          <div className="font-mono">{fmt(p.avg_queued_load_mw)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">TTP (mo)</div>
          <div className="font-mono">{fmt(p.avg_time_to_power_months)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Fiber</div>
          <div className="font-mono">{fmt(p.avg_fiber_density_score, 1)}</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">Hazard</div>
          <div className="font-mono">{fmt(p.avg_hazard_score, 1)}</div>
        </div>
      </div>
      {p.iso_mix.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">ISO mix</div>
          <div className="flex flex-wrap gap-1">
            {p.iso_mix.slice(0, 5).map(([iso, n]) => (
              <Badge key={iso} variant="outline" className="text-[10px] font-mono">{iso} · {n}</Badge>
            ))}
          </div>
        </div>
      )}
      {p.state_mix.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">State mix</div>
          <div className="flex flex-wrap gap-1">
            {p.state_mix.slice(0, 5).map(([st, n]) => (
              <Badge key={st} variant="secondary" className="text-[10px] font-mono">{st} · {n}</Badge>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Recent sites</div>
        <div className="space-y-1">
          {data.sites.slice(0, 5).map((s, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] py-1">
              <Link href={`/counties/${s.fips}`} className="text-primary hover:underline">
                {s.county}, {s.state}
              </Link>
              <div className="flex items-center gap-2">
                {s.score != null && <ScoreBadge score={s.score} />}
                <span className="font-mono text-muted-foreground text-[10px]">{s.announced_date}</span>
                <a href={s.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Attribution {
  operator: string;
  matchType: "shell" | "codename" | "parent";
  matchedTerm: string;
  confidence: number;
}
interface ShellHit {
  id: number;
  company: string;
  formType: string;
  filedDate: string;
  filingUrl: string;
  attribution: Attribution;
}
interface ShellHitsResp {
  count: number;
  byOperator: Record<string, number>;
  hits: ShellHit[];
}

const MATCH_STYLES: Record<Attribution["matchType"], string> = {
  shell: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  codename: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/40",
  parent: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40",
};

// Hero feed: SEC EDGAR filings attributed to a tracked operator via its
// shell-LLC dictionary, project codenames, or parent name. Nothing else on the
// market productizes EDGAR full-text → operator attribution.
function AttributedFilings() {
  const { data, isLoading } = useQuery<ShellHitsResp>({
    queryKey: ["/api/edgar/shell-hits"],
  });
  return (
    <Card data-testid="card-attributed-filings" className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            Attributed SEC Filings
          </CardTitle>
          {data && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {data.count} filings
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Recent SEC EDGAR filings resolved to a tracked operator by shell-LLC,
          codename, or parent name.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !data || data.count === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            No attributed filings yet. Run the EDGAR ingest to populate.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.byOperator)
                .sort((a, b) => b[1] - a[1])
                .map(([op, n]) => (
                  <Badge key={op} variant="secondary" className="text-[10px] font-mono" data-testid={`chip-attr-op-${op}`}>
                    {op} · {n}
                  </Badge>
                ))}
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {data.hits.slice(0, 25).map((h) => (
                <div key={h.id} className="text-[11px] rounded border border-border p-2" data-testid={`attr-filing-${h.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className="font-medium truncate">{h.attribution.operator}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className={`text-[9px] uppercase ${MATCH_STYLES[h.attribution.matchType]}`}>
                        {humanize(h.attribution.matchType)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono">{h.filedDate}</span>
                    </div>
                  </div>
                  <div className="text-muted-foreground truncate">{h.company}</div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      matched “{h.attribution.matchedTerm}” · {h.formType}
                    </span>
                    <a href={h.filingUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Operators() {
  const { data: operators, isLoading } = useQuery<Operator[]>({ queryKey: ["/api/operators"] });
  const [openPlaybook, setOpenPlaybook] = useState<Record<string, boolean>>({});

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Operators & Shell LLC's
        </h1>
        <p className="text-sm text-muted-foreground">
          Known hyperscaler entities and the shell LLC/codename patterns they use to acquire land discreetly.
        </p>
      </div>

      <AttributedFilings />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {operators?.map((op) => {
            const shellLlcs = JSON.parse(op.shellLlcs || "[]") as string[];
            const codenames = JSON.parse(op.codenames || "[]") as string[];
            const markets = JSON.parse(op.activeMarkets || "[]") as string[];

            return (
              <Card key={op.id} data-testid={`operator-${op.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{op.name}</CardTitle>
                    {op.annualCapexBillions != null && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        ${op.annualCapexBillions.toFixed(0)}B capex
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Shell LLC's
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {shellLlcs.length > 0 ? shellLlcs.map((llc) => (
                        <Badge key={llc} variant="secondary" className="text-[10px] font-mono">
                          {llc}
                        </Badge>
                      )) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Codenames
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {codenames.length > 0 ? codenames.map((cn) => (
                        <Badge key={cn} variant="outline" className="text-[10px] font-mono">
                          {cn}
                        </Badge>
                      )) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Active markets
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {markets.map((m) => (
                        <span key={m} className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs justify-between"
                    data-testid={`button-playbook-${op.id}`}
                    onClick={() => setOpenPlaybook((s) => ({ ...s, [op.name]: !s[op.name] }))}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Siting playbook
                    </span>
                    {openPlaybook[op.name] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                  {openPlaybook[op.name] && (
                    <>
                      <OperatorPlaybook name={op.name} />
                      <div className="pt-3 mt-3 border-t border-border">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">
                          Activity feed
                        </div>
                        <OperatorActivity name={op.name} />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
