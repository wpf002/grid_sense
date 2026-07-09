import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Inbox, FileCheck2, Swords, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

type Digest = {
  since: string;
  permits: Array<{
    filed_date: string; county_fips: string; county: string; state: string;
    permit_type: string; applicant: string; resolved_operator: string | null;
    megawatts: number | null; acres: number | null; status: string; description: string; source_url: string | null;
  }>;
  bids: Array<{
    observed_date: string; county_fips: string; county: string; state: string;
    operator: string; stage: string; megawatts: number | null;
    source: string; notes: string; confidence: number; source_url: string | null;
  }>;
  movers: Array<{
    fips: string; name: string; state: string; delta: number;
    score_today: number; score_prior: number; today: string; prior: string;
  }>;
};

const STAGE_STYLE: Record<string, string> = {
  loi: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  option: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  under_contract: "bg-primary/20 text-primary",
  closed: "bg-green-500/20 text-green-700 dark:text-green-400",
};

export default function Digest() {
  const { data, isLoading } = useQuery<Digest>({
    queryKey: ["/api/digest/recent"],
    queryFn: async () => (await fetch("/api/digest/recent")).json(),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full max-w-4xl" /></div>;
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" /> Weekly Digest
        </h1>
        <p className="text-sm text-muted-foreground">
          The biggest moves across your markets in the last week — the same rundown the weekly email sends.
        </p>
      </div>

      {/* Digest email preview card */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subject</div>
          <CardTitle className="text-base">GridSense Weekly · {data.permits.length} permits, {data.bids.length} new bids, {data.movers.length} movers</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          {/* Movers */}
          <section>
            <div className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Score movers ({data.movers.length})
            </div>
            {data.movers.length === 0 ? (
              <div className="text-xs text-muted-foreground">No county's score moved by 3 points or more this week.</div>
            ) : (
              <div className="space-y-1">
                {data.movers.slice(0, 8).map((m) => (
                  <div key={m.fips} className="flex items-center gap-3 text-sm border-b border-border/50 py-1.5" data-testid={`digest-mover-${m.fips}`}>
                    {m.delta > 0
                      ? <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                      : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                    <Link href={`/counties/${m.fips}`}>
                      <button className="text-primary hover:underline flex-1 text-left">{m.name}, {m.state}</button>
                    </Link>
                    <span className={`font-mono text-sm font-semibold ${m.delta > 0 ? "text-green-600" : "text-red-600"}`}>
                      {m.delta > 0 ? "+" : ""}{m.delta.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs w-24 text-right">
                      {Math.round(m.score_prior)} → {Math.round(m.score_today)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Permits */}
          <section>
            <div className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-primary" /> Notable permits ({data.permits.length})
            </div>
            {data.permits.length === 0 ? (
              <div className="text-xs text-muted-foreground">No major permits filed this week.</div>
            ) : (
              <div className="space-y-2">
                {data.permits.slice(0, 8).map((p, i) => (
                  <div key={i} className="border-l-2 border-primary/50 pl-3 py-1" data-testid={`digest-permit-${i}`}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{p.filed_date}</span>
                      <Badge variant="outline" className="text-[9px] uppercase">{humanize(p.permit_type)}</Badge>
                      {p.resolved_operator && <Badge className="bg-primary/20 text-primary text-[9px]">{p.resolved_operator}</Badge>}
                      <Link href={`/counties/${p.county_fips}`}>
                        <button className="text-primary hover:underline">{p.county}, {p.state}</button>
                      </Link>
                    </div>
                    <div className="text-sm mt-0.5">{p.description}</div>
                    <div className="text-[11px] text-muted-foreground">{p.applicant}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Active bids */}
          <section>
            <div className="text-sm font-semibold mb-2 inline-flex items-center gap-2">
              <Swords className="h-4 w-4 text-primary" /> Active competitive moves ({data.bids.length})
            </div>
            {data.bids.length === 0 ? (
              <div className="text-xs text-muted-foreground">No new competitive activity (LOIs, options, closings) this week.</div>
            ) : (
              <div className="space-y-2">
                {data.bids.slice(0, 8).map((b, i) => (
                  <div key={i} className="border-l-2 border-amber-500/50 pl-3 py-1" data-testid={`digest-bid-${i}`}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{b.observed_date}</span>
                      <Badge className={`text-[9px] uppercase ${STAGE_STYLE[b.stage] ?? ""}`}>{humanize(b.stage)}</Badge>
                      <span className="font-medium">{b.operator}</span>
                      →
                      <Link href={`/counties/${b.county_fips}`}>
                        <button className="text-primary hover:underline">{b.county}, {b.state}</button>
                      </Link>
                      {b.megawatts && <span className="font-mono text-muted-foreground">{b.megawatts} MW</span>}
                    </div>
                    <div className="text-xs mt-0.5">{b.notes}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Source: {b.source} · confidence {(b.confidence * 100).toFixed(0)}%
                      {b.source_url && <a href={b.source_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 ml-2"><ExternalLink className="h-2.5 w-2.5" />link</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="text-[10px] text-muted-foreground text-center border-t pt-3">
            Schedule this as a weekly email, or set per-county rules in <Link href="/alerts"><button className="text-primary">Alerts</button></Link>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
