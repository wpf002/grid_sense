import { Link } from "wouter";
import { ArrowRight, Zap, Radio, LandPlot, FileCheck2, Swords, TrendingUp, Shield, Database, Code2, Map as MapIcon, Sparkles, CheckCircle2 } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const FEATURES = [
  { icon: MapIcon, title: "National radar map", body: "3,109 US counties, tier-coded by landing probability. Zoom, pan, click into any market." },
  { icon: LandPlot, title: "Site-level parcel intel", body: "1,700+ parcels with shell-LLC ownership, substation distance, fiber distance, and zoning." },
  { icon: FileCheck2, title: "Permit tracker", body: "1,600+ rezoning, building, electrical, and water permits — filtered by county, operator, or stage." },
  { icon: Swords, title: "Competitive bid feed", body: "1,100+ observed operator bids from sniffing → LOI → option → under contract → closed." },
  { icon: Radio, title: "Signal stream", body: "Fused SEC filings, DCD articles, ISO queue snapshots, county planning agendas, and utility interconnect notices." },
  { icon: Database, title: "Data provenance", body: "Every metric has source lineage. Click any factor to see EIA-860, HIFLD, FEMA NRI, or the exact permit URL." },
  { icon: TrendingUp, title: "Landing-probability model", body: "13-factor scoring — grid, land, fiber, policy, hazard, tax, water. Backtestable, tuneable, auditable." },
  { icon: Code2, title: "Public REST API", body: "12 documented endpoints. JSON. curl-ready. Free tier: 60 req/min. Pro tier: 600 req/min." },
];

const STATS = [
  { label: "US counties covered", value: "3,109" },
  { label: "Emerging+ markets", value: "505" },
  { label: "Site-level parcels", value: "1,704" },
  { label: "Permits tracked", value: "1,612" },
  { label: "Competitive bids", value: "1,107" },
  { label: "Hyperscaler operators + shell LLC's", value: "45" },
];

const OPERATORS = ["Meta","Google","Microsoft","Amazon","Oracle","xAI","OpenAI/Stargate","Digital Realty","Equinix","QTS","CoreWeave","Vantage","Aligned","Stack","Compass","CyrusOne"];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-landing">
      {/* Top nav */}
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <BrandMark size="lg" />
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-nav-pricing">Pricing</Link>
            <Link href="/api-docs" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-nav-api">API</Link>
            <Link href="/login" className="text-sm px-3 py-1.5 rounded-md border border-border hover-elevate" data-testid="link-nav-login">Sign in</Link>
            <Link href="/login" className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 hover-elevate" data-testid="link-nav-demo">
              Try instant demo
            </Link>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-12 sm:pt-20 sm:pb-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1 mb-6">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-xs font-medium text-primary">Data center land intelligence, priced for humans</span>
          </div>
          <h1 className="text-xl sm:text-xl font-semibold tracking-tight leading-tight" data-testid="text-hero-title" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.1 }}>
            The AI data center land radar for developers, brokers, and utilities.
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground mt-5 max-w-2xl leading-relaxed">
            GridSense fuses grid interconnect queues, shell-LLC land assemblies, fiber density, and operator activity into a landing-probability score for every US county. Site-level parcels, permits, and competitive bids included.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 hover-elevate" data-testid="button-hero-demo">
              Try instant demo (no signup)
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/map" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-accent hover-elevate" data-testid="button-hero-map">
              Explore the national radar
              <MapIcon className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="button-hero-pricing">
              View pricing
            </Link>
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-14 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3" data-testid={`stat-${s.label.replace(/\s+/g,"-").toLowerCase()}`}>
              <div className="text-lg font-semibold tabular-nums">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature grid */}
      <div className="border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="mb-10">
            <h2 className="text-xl font-semibold tracking-tight" data-testid="text-features-title">Underwrite a data center site from one screen.</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Site selection used to mean six months of RFIs and Excel jockeying. GridSense replaces it with a single, source-cited dashboard.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border border-border bg-card p-4" data-testid={`feature-${f.title.replace(/\s+/g,"-").toLowerCase()}`}>
                <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                  <f.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Operators tracked */}
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Operators tracked</div>
          <h2 className="text-xl font-semibold tracking-tight">The hyperscalers, the neoclouds, and their shell LLC's.</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            When Greater Kudu LLC buys 1,200 acres in Ellis County, you'll know it's Meta before the press release. When Project Firecracker LLC files for 400 MW of interconnect in Wisconsin, you'll know it's Microsoft.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {OPERATORS.map((op) => (
            <div key={op} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium" data-testid={`operator-${op.replace(/[^a-z0-9]/gi,"").toLowerCase()}`}>
              {op}
            </div>
          ))}
          <div className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">+ 29 more</div>
        </div>
      </div>

      {/* Value props */}
      <div className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center mb-3">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold">Built for developers</div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Public REST API, JSON, curl-ready</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />CSV + Snowflake bulk export on Pro</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Webhooks for tier upgrades + score crosses</li>
            </ul>
          </div>
          <div>
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center mb-3">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold">Built for underwriters</div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Every value shows its source URL</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Backtestable model — see historical accuracy</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Data quality flag: real / partial / estimated</li>
            </ul>
          </div>
          <div>
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-semibold">Built for brokers</div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Lead gen — county-level operator interest</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Alert triggers on tier changes + moratorium news</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />Watchlist with priority + notes per county</li>
            </ul>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="border-t border-border bg-primary/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-16 text-center">
          <h2 className="text-xl font-semibold tracking-tight" style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)", lineHeight: 1.15 }}>
            Land the next site before the RFI goes out.
          </h2>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
            The demo user comes pre-loaded with a watchlist, an alert subscription, and a saved search. No signup, no card. Two clicks and you're inside.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 hover-elevate" data-testid="button-cta-demo">
              Start the demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/api-docs" className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-accent hover-elevate" data-testid="button-cta-api">
              Read the API docs
              <Code2 className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <div className="text-[11px] text-muted-foreground">© 2026 GridSense. Data center land intelligence.</div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <Link href="/methodology" className="hover:text-foreground">Methodology</Link>
            <Link href="/api-docs" className="hover:text-foreground">API</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
