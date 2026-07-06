import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, ExternalLink, Search, MapPin, Building2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { County } from "@shared/schema";

// Gap 9 — lead-gen workflow scaffold.
// This page walks the salesman through the free-data steps that get them from
// a hot county to a landowner-outreach list.

export default function LeadGen() {
  const [fips, setFips] = useState("");
  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const hot = counties?.filter((c) => c.scoreTier === "hot").slice(0, 20) ?? [];
  const selected = counties?.find((c) => c.fips === fips);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Lead-gen workflow
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Turn a scored county into a landowner-outreach list. Free-data path
          uses OpenStreetMap building footprints as a proxy; paid Regrid data
          is required for final title-level parcels + owner-of-record names.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 1 · Pick a target county</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Enter FIPS or pick a hot county below"
                value={fips}
                onChange={(e) => setFips(e.target.value)}
                className="pl-7"
                data-testid="input-fips"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hot.map((c) => (
              <Button
                key={c.fips}
                size="sm"
                variant={c.fips === fips ? "default" : "outline"}
                onClick={() => setFips(c.fips)}
                data-testid={`button-hot-${c.fips}`}
              >
                {c.name}, {c.state}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Step 2 · Find candidate parcels
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>
                  Open the{" "}
                  <Link href={`/counties/${selected.fips}`} className="underline">
                    {selected.name} County page
                  </Link>{" "}
                  and scroll to the <em>Parcel proxy (OpenStreetMap)</em> card.
                  Note top industrial and brownfield polygons — those are your
                  free-data starting set.
                </li>
                <li>
                  Cross-reference with the <em>Recent DC land comps</em> card
                  for the state — buyers here (Meta, Google, Amazon, MSFT,
                  Stargate, xAI) show which corridors have already priced in
                  DC use.
                </li>
                <li>
                  Filter for parcels ≥100 acres (data-center pads want
                  200-800 ac contiguous), zoned M1/M2 or agricultural
                  bordering industrial, within 5 miles of a transmission
                  segment ≥230 kV.
                </li>
              </ol>
              <div className="rounded-md border p-3 bg-muted/30">
                <p className="text-xs font-semibold mb-1">Paid upgrade path</p>
                <p className="text-xs">
                  Regrid parcel license ($1-5k/state/yr) gives owner-of-record,
                  APN, prior sale price, deed history and title-linked polygons.
                  See{" "}
                  <a
                    href="https://regrid.com/api"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    regrid.com/api
                  </a>
                  .
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base inline-flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Step 3 · Skip-trace & contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>
                  Free path: county assessor site → search APN → owner name +
                  mailing address. Every US county has an online parcel
                  viewer; most publish PDFs free of charge.
                </li>
                <li>
                  Skip-trace services for phone/email:
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <ExtLink href="https://batchskiptracing.com">BatchSkipTracing ($0.10/rec)</ExtLink>
                    <ExtLink href="https://www.reipro.com">REIPro</ExtLink>
                    <ExtLink href="https://propstream.com">PropStream</ExtLink>
                    <ExtLink href="https://www.tloxp.com">TLOxp (enterprise)</ExtLink>
                  </div>
                </li>
                <li>
                  Outreach templates: mail postcard first (highest response),
                  followed by call at 3-5 days, then email if listed.
                  Reference the county-level score to justify the offer:
                  &ldquo;Your parcel sits inside a top-tier data-center
                  corridor (score {selected.landingProbability}/100). Comps in{" "}
                  {selected.state} closed at $X/acre.&rdquo;
                </li>
                <li>
                  If landowner is receptive → LOI at 10-15% above ag comp,
                  with 90-day due diligence + purchase-option structure. Assign
                  to REIT / operator for 3-5× markup at closing.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Step 4 · Outbound template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <OutboundTemplate county={selected} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Step 5 · Export & track</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/counties/${selected.fips}/site-brief.pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline" size="sm">
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                    Site brief PDF
                  </Button>
                </a>
                <a href="/api/counties.csv" target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                    Ranked counties CSV
                  </Button>
                </a>
                <a href="/api/comps.csv" target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                    Comps CSV
                  </Button>
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                Add promising counties to your watchlist; the daily cron
                (GridSense — daily DC news + SEC watch) will notify you the
                moment a shell LLC or SEC filing lands there.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function OutboundTemplate({ county }: { county: County }) {
  const [channel, setChannel] = useState<"email" | "linkedin" | "cold_call">("email");
  const [copied, setCopied] = useState(false);
  const score = county.landingProbability ?? 0;
  const iso = county.iso ?? "—";
  const state = county.state;
  const name = county.name;
  const tier = county.scoreTier ?? "tracked";
  const queueMw = county.queuedLoadMw ?? 0;
  const queueStr = queueMw >= 1000 ? `${(queueMw/1000).toFixed(1)} GW` : `${queueMw.toFixed(0)} MW`;
  const emailBody = `Subject: 200-acre-plus assemblage near ${name} County — 15-min call this week?

Hi {{FIRST_NAME}},

I cover data-center site sourcing and ${name} County, ${state} just crossed a ${score.toFixed(0)}/100 on our GridSense siting model — top-tier for the ${iso} interconnection footprint. We're actively assembling parcels for ${tier === "hot" ? "a hyperscale campus" : "a build-to-suit customer"} and have ${queueStr} of queued generation within a 30-mile radius.

Quick asks:
1. Are you seeing owner-of-record activity we should be tracking in the county?
2. Any large tracts (200+ acres, dual-fed transmission access) that are quietly on-market?

Happy to trade context — we'll bring EIA-860, FEMA NRI, and ISO queue data. 15 min this week?

Thanks,
{{YOUR_NAME}}`;
  const linkedinBody = `${name} County, ${state} scored ${score.toFixed(0)}/100 on our data-center siting model this week (top-tier ${iso}, ${queueStr} queued nearby). If you have owner-of-record leads on 200+ acre tracts with dual-fed transmission access, would love to compare notes.`;
  const coldCallBody = `— Opener —
"Hi {{FIRST_NAME}}, I run data-center site sourcing. ${name} County just showed up as one of our top-tier corridors this week — ${score.toFixed(0)}/100."
— Reason for the call —
"We're chasing 200-acre-plus assemblages with dual-fed transmission. ${queueStr} of queued generation nearby."
— Ask —
"Two questions: 1) any owner-of-record activity worth tracking, 2) any large tracts quietly on-market?"
— Close —
"Can I send a one-page brief and grab 15 minutes this week?"`;
  const body = channel === "email" ? emailBody : channel === "linkedin" ? linkedinBody : coldCallBody;
  const copy = () => {
    navigator.clipboard?.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist">
        {[["email","Email"],["linkedin","LinkedIn"],["cold_call","Cold call"]].map(([k,label]) => (
          <button
            key={k}
            onClick={() => setChannel(k as any)}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              channel === k ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground border border-border"
            }`}
            data-testid={`button-channel-${k}`}
          >{label}</button>
        ))}
      </div>
      <textarea
        className="w-full font-mono text-xs bg-muted/30 border border-border rounded-md p-3 min-h-[180px]"
        value={body}
        readOnly
        data-testid={`textarea-outbound-${channel}`}
      />
      <div className="flex justify-between items-center">
        <div className="text-[10px] text-muted-foreground">Replace {"{{FIRST_NAME}}"} / {"{{YOUR_NAME}}"} before sending.</div>
        <Button size="sm" variant={copied ? "default" : "outline"} onClick={copy} data-testid="button-copy-outbound">{copied ? "Copied ✓" : "Copy template"}</Button>
      </div>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
