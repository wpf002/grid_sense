import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Inbox, FileCheck2, Swords, TrendingUp, TrendingDown, ExternalLink, CalendarRange,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";
import { formatDay } from "@/lib/dates";

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
  loi: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  option: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  under_contract: "bg-primary/15 text-primary",
  closed: "bg-green-500/15 text-green-700 dark:text-green-400",
};

/** "2026-07-03" -> "July 3" */
const longDate = (iso: string) => formatDay(iso, { month: "long", day: "numeric" });

/** "2026-07-03" -> "Jul 3" */
const shortDate = (iso: string) => formatDay(iso, { month: "short", day: "numeric" });

/**
 * The headline the reader actually wants: what happened this week, in a
 * sentence, instead of three counts they have to assemble themselves.
 */
function summarize(d: Digest): string {
  const parts: string[] = [];
  const rising = d.movers.filter((m) => m.delta > 0).length;
  const falling = d.movers.length - rising;

  if (d.movers.length === 0) parts.push("no county moved by 3 points or more");
  else if (falling === 0) parts.push(`${rising} ${rising === 1 ? "county" : "counties"} climbed`);
  else if (rising === 0) parts.push(`${falling} ${falling === 1 ? "county" : "counties"} slipped`);
  else parts.push(`${rising} up and ${falling} down`);

  if (d.permits.length) parts.push(`${d.permits.length} new ${d.permits.length === 1 ? "permit" : "permits"}`);
  if (d.bids.length) parts.push(`${d.bids.length} competitive ${d.bids.length === 1 ? "move" : "moves"}`);

  const last = parts.pop();
  const body = parts.length ? `${parts.join(", ")}, and ${last}` : last;
  return `Since ${longDate(d.since)}: ${body}.`;
}

function SectionHeading({ icon: Icon, title, count }: { icon: any; title: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">({count})</span>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export default function Digest() {
  const { data, isLoading } = useQuery<Digest>({ queryKey: ["/api/digest/recent"] });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!data) return null;

  const rising = data.movers.filter((m) => m.delta > 0);
  const falling = data.movers.filter((m) => m.delta < 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6" data-testid="page-digest">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Inbox className="h-5 w-5 text-primary" /> Weekly Digest
        </h1>
        <p className="text-sm text-muted-foreground">
          What changed across all 3,109 counties in the last seven days — the same rundown the weekly email sends.
        </p>
      </header>

      {/* Lead paragraph: the week in one sentence. */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <CalendarRange className="h-3 w-3" />
            Week of {longDate(data.since)}
          </div>
          <CardTitle className="text-base font-medium leading-relaxed" data-testid="text-digest-summary">
            {summarize(data)}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-7 pt-5">
          {/* Movers */}
          <section>
            <SectionHeading icon={TrendingUp} title="Score Movers" count={data.movers.length} />
            {data.movers.length === 0 ? (
              <EmptyNote>No county's score moved by 3 points or more this week.</EmptyNote>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  {rising.length > 0 && falling.length > 0
                    ? `${rising.length} ${rising.length === 1 ? "county" : "counties"} gained ground, ${falling.length} lost it.`
                    : rising.length > 0
                      ? "Every mover this week gained ground."
                      : "Every mover this week lost ground."}{" "}
                  Scores compare {shortDate(data.movers[0].prior)} to {shortDate(data.movers[0].today)}.
                </p>
                <div className="divide-y divide-border/50 rounded-md border">
                  {data.movers.slice(0, 10).map((m) => (
                    <div key={m.fips} className="flex items-center gap-3 px-3 py-2" data-testid={`digest-mover-${m.fips}`}>
                      {m.delta > 0
                        ? <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500" />
                        : <TrendingDown className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-500" />}
                      <Link
                        href={`/counties/${m.fips}`}
                        className="flex-1 truncate text-sm hover:text-primary hover:underline"
                      >
                        {m.name} County, {m.state}
                      </Link>
                      <span className="w-32 text-right text-xs text-muted-foreground">
                        {Math.round(m.score_prior)} → <span className="font-medium text-foreground">{Math.round(m.score_today)}</span>
                      </span>
                      <span
                        className={`w-14 text-right font-mono text-sm font-semibold ${
                          m.delta > 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
                        }`}
                      >
                        {m.delta > 0 ? "+" : ""}{m.delta.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
                {data.movers.length > 10 && (
                  <div className="pt-2 text-center">
                    <Link href="/movers" className="text-xs text-primary hover:underline" data-testid="link-all-movers">
                      See all {data.movers.length} movers
                    </Link>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Permits */}
          <section>
            <SectionHeading icon={FileCheck2} title="Notable Permits" count={data.permits.length} />
            {data.permits.length === 0 ? (
              <EmptyNote>
                No data-center permits were filed in a tracked county this week. We only show permits we can
                trace to a real county filing — never a placeholder.
              </EmptyNote>
            ) : (
              <div className="space-y-3">
                {data.permits.slice(0, 8).map((p, i) => (
                  <div key={i} className="border-l-2 border-primary/50 pl-3" data-testid={`digest-permit-${i}`}>
                    <div className="text-sm">{p.description}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>Filed {shortDate(p.filed_date)}</span>
                      <span>·</span>
                      <Link href={`/counties/${p.county_fips}`} className="text-primary hover:underline">
                        {p.county} County, {p.state}
                      </Link>
                      <span>·</span>
                      <span>{p.applicant}</span>
                      <Badge variant="outline" className="h-4 text-[9px]">{humanize(p.permit_type)}</Badge>
                      {p.resolved_operator && (
                        <Badge className="h-4 bg-primary/15 text-[9px] text-primary">{p.resolved_operator}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Competitive moves */}
          <section>
            <SectionHeading icon={Swords} title="Competitive Moves" count={data.bids.length} />
            {data.bids.length === 0 ? (
              <EmptyNote>
                No letters of intent, land options, or closings surfaced this week.
              </EmptyNote>
            ) : (
              <div className="space-y-3">
                {data.bids.slice(0, 8).map((b, i) => (
                  <div key={i} className="border-l-2 border-amber-500/50 pl-3" data-testid={`digest-bid-${i}`}>
                    <div className="text-sm">
                      <span className="font-medium">{b.operator}</span> in{" "}
                      <Link href={`/counties/${b.county_fips}`} className="text-primary hover:underline">
                        {b.county} County, {b.state}
                      </Link>
                      {b.megawatts ? ` — ${b.megawatts} MW` : ""}
                    </div>
                    {b.notes && <div className="mt-0.5 text-xs text-muted-foreground">{b.notes}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge className={`h-4 text-[9px] ${STAGE_STYLE[b.stage] ?? ""}`}>{humanize(b.stage)}</Badge>
                      <span>Seen {shortDate(b.observed_date)}</span>
                      <span>·</span>
                      <span>{b.source}, {(b.confidence * 100).toFixed(0)}% confidence</span>
                      {b.source_url && (
                        <a
                          href={b.source_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="h-2.5 w-2.5" /> Source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="border-t pt-3 text-center text-xs text-muted-foreground">
            Want this in your inbox? Set per-county rules in{" "}
            <Link href="/alerts" className="text-primary hover:underline">Alerts</Link>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
