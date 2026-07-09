import { Link } from "wouter";
import { Check, Zap, Building2, Rocket, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Tier {
  name: string;
  price: string;
  frequency: string;
  tagline: string;
  icon: any;
  featured?: boolean;
  features: string[];
  cta: string;
  ctaHref: string;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    frequency: "forever",
    tagline: "For analysts, journalists, and land-owners kicking the tires.",
    icon: Zap,
    features: [
      "All 3,109 US counties on the national radar",
      "Score, tier, and headline factors on every county",
      "Public signal feed (LLC filings, permits, ISO queue)",
      "1 saved watchlist (up to 10 counties)",
      "CSV export on any table",
      "Public REST API — 60 req/min",
    ],
    cta: "Start free",
    ctaHref: "/login",
  },
  {
    name: "Pro",
    price: "$299",
    frequency: "per month",
    tagline: "For site selectors, brokers, and utility BD teams.",
    icon: Rocket,
    featured: true,
    features: [
      "Everything in Free, plus:",
      "Site-level parcel intel with owner resolution",
      "Permit tracker (building, electrical, water, rezoning)",
      "Competitive bid intelligence per county",
      "Unlimited watchlists + saved searches",
      "Email alerts on score jumps, signals, moves",
      "90-day score history + backtest module",
      "Authenticated API — 600 req/min",
    ],
    cta: "Start 14-day trial",
    ctaHref: "/login",
  },
  {
    name: "Enterprise",
    price: "Custom",
    frequency: "annual contract",
    tagline: "For hyperscalers, utility execs, and PE infra funds.",
    icon: Building2,
    features: [
      "Everything in Pro, plus:",
      "Snowflake / Databricks / S3 share",
      "Webhook subscriptions on any signal or score event",
      "Custom operator watchlists (shell-LLC coverage)",
      "Priority ingestion for your target markets",
      "Analyst hour bundle for custom deep-dives",
      "SSO (Okta, Azure AD) + audit logs",
      "Uptime SLA + dedicated success manager",
    ],
    cta: "Talk to us",
    ctaHref: "mailto:sales@gridsense.app",
  },
];

export default function Pricing() {
  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-10 max-w-6xl mx-auto">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Link>
      <div className="text-center space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Plans for Solo Analysts to Hyperscalers
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Know where the next hyperscale campus lands before it's public. Free forever
          for individuals, tiered plans for teams, custom deals for the biggest operators.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TIERS.map((t) => {
          const Icon = t.icon;
          return (
            <Card
              key={t.name}
              className={t.featured ? "border-primary shadow-lg relative" : ""}
              data-testid={`tier-${t.name.toLowerCase()}`}
            >
              {t.featured && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  Most popular
                </Badge>
              )}
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{t.name}</CardTitle>
                </div>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">{t.price}</div>
                  <div className="text-xs text-muted-foreground">{t.frequency}</div>
                </div>
                <p className="text-xs text-muted-foreground">{t.tagline}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {t.ctaHref.startsWith("mailto:") ? (
                  <Button asChild variant={t.featured ? "default" : "outline"} className="w-full" data-testid={`button-cta-${t.name.toLowerCase()}`}>
                    <a href={t.ctaHref}>{t.cta}</a>
                  </Button>
                ) : (
                  <Button asChild variant={t.featured ? "default" : "outline"} className="w-full" data-testid={`button-cta-${t.name.toLowerCase()}`}>
                    <Link href={t.ctaHref}>{t.cta}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frequently Asked</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="font-semibold mb-1">Where does the data come from?</div>
            <p className="text-muted-foreground">
              Public authoritative sources — ISO interconnection queues, EIA-860, FEMA NRI,
              SEC EDGAR, county permit portals, and utility service territories. Every scored
              factor has traceable provenance available on each county page.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-1">How current is the data?</div>
            <p className="text-muted-foreground">
              ISO queues refresh monthly. SEC EDGAR + news feeds refresh daily. FEMA NRI
              refreshes semi-annually. The score snapshot runs nightly.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-1">Do you have a free trial for Pro?</div>
            <p className="text-muted-foreground">
              Yes — 14 days, no credit card required. The instant demo on the sign-in page
              gives you full read access to explore before deciding.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-1">Can we license the raw data?</div>
            <p className="text-muted-foreground">
              Enterprise plans include Snowflake, Databricks, or S3 shares of the underlying
              tables (counties, parcels, permits, signals, score history) plus daily deltas.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground">
        Not sure which tier? <a href="mailto:sales@gridsense.app" className="text-primary hover:underline">Email us</a> and we'll help you pick.
      </div>
    </div>
  );
}
