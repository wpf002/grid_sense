import { useState } from "react";
import { Link } from "wouter";
import { Code2, Copy, Check, Zap, Key, Database, Radio, LandPlot, Building2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  summary: string;
  example: string;
  responseExample: string;
  category: "counties" | "signals" | "operators" | "user" | "exports";
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET", path: "/api/counties", category: "counties",
    summary: "List all 3,109 US counties with score, tier, and headline factors.",
    example: `curl https://gridsense.app/api/counties`,
    responseExample: `[
  {
    "fips": "48441",
    "name": "Taylor",
    "state": "TX",
    "landingProbability": 88.0,
    "scoreTier": "hot",
    "queuedLoadMw": 4800,
    "iso": "ERCOT"
  }
]`,
  },
  {
    method: "GET", path: "/api/counties/:fips", category: "counties",
    summary: "Detailed factor breakdown, sub-scores, and metadata for one county.",
    example: `curl https://gridsense.app/api/counties/48441`,
    responseExample: `{
  "fips": "48441",
  "name": "Taylor",
  "landingProbability": 88.0,
  "scoreTier": "hot",
  "factorBreakdown": {
    "power": 92,
    "land": 84,
    "water": 71,
    "policy": 89
  }
}`,
  },
  {
    method: "GET", path: "/api/counties/:fips/history", category: "counties",
    summary: "Daily score snapshots for the last 90 days (score_history_daily).",
    example: `curl https://gridsense.app/api/counties/48441/history`,
    responseExample: `[
  { "snapshot_date": "2026-07-05", "score": 88.0 },
  { "snapshot_date": "2026-07-04", "score": 87.5 }
]`,
  },
  {
    method: "GET", path: "/api/counties/:fips/provenance", category: "counties",
    summary: "Source-of-truth records for every scoring factor on this county.",
    example: `curl https://gridsense.app/api/counties/48441/provenance`,
    responseExample: `[
  {
    "factor_key": "queued_load_mw",
    "quality": "verified",
    "source_name": "ERCOT GIS Report",
    "source_url": "https://www.ercot.com/gridinfo/resource"
  }
]`,
  },
  {
    method: "GET", path: "/api/counties/map", category: "counties",
    summary: "Lightweight payload for map rendering: fips, lat/lng, tier, score.",
    example: `curl https://gridsense.app/api/counties/map`,
    responseExample: `[
  { "fips": "48441", "lat": 32.3, "lng": -99.7, "landing_probability": 88.0, "score_tier": "hot" }
]`,
  },
  {
    method: "GET", path: "/api/signals", category: "signals",
    summary: "Every detected event feeding the score model (LLC filings, permits, filings, etc).",
    example: `curl https://gridsense.app/api/signals`,
    responseExample: `[
  {
    "id": 12,
    "signalType": "llc_land_purchase",
    "headline": "Raven Northbrook LLC acquires 640 acres",
    "suspectedOperator": "Meta",
    "detectedAt": "2026-07-03"
  }
]`,
  },
  {
    method: "GET", path: "/api/operators", category: "operators",
    summary: "45+ tracked operators with shell LLC names, codenames, and capex.",
    example: `curl https://gridsense.app/api/operators`,
    responseExample: `[
  {
    "name": "Meta",
    "shell_llcs": ["Raven Northbrook LLC", "Greater Kudu LLC"],
    "codenames": ["Hyperion", "Prometheus"],
    "annual_capex_billions": 40
  }
]`,
  },
  {
    method: "GET", path: "/api/operators/:name/activity", category: "operators",
    summary: "Cross-table activity feed for one operator (parcels, permits, bids, signals).",
    example: `curl https://gridsense.app/api/operators/Meta/activity`,
    responseExample: `{
  "operator": "Meta",
  "totals": { "parcels": 12, "permits": 8, "bids": 4, "signals": 27 }
}`,
  },
  {
    method: "GET", path: "/api/parcels", category: "counties",
    summary: "Site-level parcels with owner, acres, zoning, substation distance.",
    example: `curl https://gridsense.app/api/parcels`,
    responseExample: `[
  {
    "county_fips": "48441",
    "owner_name": "Cypress Bayou LLC",
    "acres": 640,
    "zoning": "industrial",
    "substation_distance_mi": 1.2
  }
]`,
  },
  {
    method: "GET", path: "/api/permits", category: "counties",
    summary: "Permit tracker: building, electrical, water, and rezoning filings.",
    example: `curl https://gridsense.app/api/permits`,
    responseExample: `[
  {
    "county_fips": "48503",
    "permit_type": "building",
    "applicant": "Cypress Bayou LLC",
    "filed_date": "2026-07-02"
  }
]`,
  },
  {
    method: "GET", path: "/api/user/watchlist", category: "user",
    summary: "Authenticated user's watchlist. Cookie-based session required.",
    example: `curl -b cookies.txt https://gridsense.app/api/user/watchlist`,
    responseExample: `[
  { "fips": "48441", "note": "Priority 1", "score_today_snap": 88.0 }
]`,
  },
  {
    method: "POST", path: "/api/auth/demo", category: "user",
    summary: "One-click demo account provisioning. Returns a session cookie.",
    example: `curl -X POST -c cookies.txt https://gridsense.app/api/auth/demo`,
    responseExample: `{ "id": 1, "email": "demo@gridsense.app", "demo": true }`,
  },
  {
    method: "GET", path: "/api/exports/counties", category: "exports",
    summary: "Bulk export scored counties as CSV or JSON. Filter by tier, state, iso, or minimum score. Streaming, up to 5,000 rows.",
    example: `curl 'https://gridsense.app/api/exports/counties?tier=hot&format=csv' -o hot-counties.csv`,
    responseExample: `fips,name,state,iso,landing_probability,score_tier,queued_load_mw,...
48441,Taylor,TX,ERCOT,88.0,hot,1420,...
51107,Loudoun,VA,PJM,86.4,hot,2185,...`,
  },
  {
    method: "POST", path: "/api/webhooks", category: "user",
    summary: "Subscribe a webhook URL to score-change, new-permit, tier-upgrade, or new-bid events. HMAC-SHA256 signed.",
    example: `curl -X POST https://gridsense.app/api/webhooks -H 'content-type: application/json' -d '{"url":"https://api.example.com/hook","events":["tier_upgrade"]}'`,
    responseExample: `{ "id": "wh_...", "url": "https://api.example.com/hook", "events": ["tier_upgrade"], "created_at": "2026-07-05T14:00:00Z" }`,
  },
];

const CATEGORY_META: Record<string, { label: string; icon: any; color: string }> = {
  counties: { label: "Counties", icon: Database, color: "text-blue-500" },
  signals: { label: "Signals", icon: Radio, color: "text-emerald-500" },
  operators: { label: "Operators", icon: Building2, color: "text-amber-500" },
  user: { label: "User", icon: Key, color: "text-purple-500" },
  exports: { label: "Exports", icon: LandPlot, color: "text-red-500" },
};

function toSnippet(curl: string, lang: "ts" | "py"): string {
  // Extract URL and method from a curl example.
  const urlMatch = curl.match(/https?:\/\/[^\s"']+/);
  const url = urlMatch ? urlMatch[0] : "https://gridsense.app/api/counties";
  const isPost = /-X\s+POST/i.test(curl);
  const withCookies = /-b\s+cookies|--cookie/i.test(curl);
  if (lang === "ts") {
    if (isPost) {
      return `import { fetch } from "undici";\n\nconst r = await fetch("${url}", {\n  method: "POST",${withCookies ? '\n  credentials: "include",' : ""}\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify({}),\n});\nconst data = await r.json();`;
    }
    return `const r = await fetch("${url}"${withCookies ? ", { credentials: \"include\" }" : ""});\nconst data = await r.json();`;
  }
  // Python
  if (isPost) {
    return `import requests\n\nr = requests.post(\n    "${url}",${withCookies ? "\n    cookies={\"connect.sid\": \"...\"}," : ""}\n    json={},\n)\ndata = r.json()`;
  }
  return `import requests\n\nr = requests.get("${url}"${withCookies ? ", cookies={\"connect.sid\": \"...\"}" : ""})\ndata = r.json()`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      data-testid="button-copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EndpointSnippet({ ep }: { ep: Endpoint }) {
  const [lang, setLang] = useState<"curl" | "ts" | "py">("curl");
  const snippet = lang === "curl" ? ep.example : lang === "ts" ? toSnippet(ep.example, "ts") : toSnippet(ep.example, "py");
  return (
    <div className="rounded-md bg-muted p-3 font-mono text-xs relative">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1" role="tablist">
          {([
            ["curl", "cURL"],
            ["ts", "TypeScript"],
            ["py", "Python"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setLang(k)}
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors ${
                lang === k ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-lang-${k}-${ep.path.replace(/[^a-z0-9]/gi, "-")}`}
            >
              {label}
            </button>
          ))}
        </div>
        <CopyButton text={snippet} />
      </div>
      <pre className="whitespace-pre-wrap break-all mt-1">{snippet}</pre>
    </div>
  );
}

export default function ApiDocs() {
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Link>
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Code2 className="h-5 w-5 text-primary" />
          API Reference
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every dataset in GridSense is also available as REST JSON. Read-only endpoints are open;
          user-scoped endpoints require a session cookie.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Quickstart
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md bg-muted p-3 font-mono text-xs relative">
            <CopyButton text="curl https://gridsense.app/api/counties?state=TX | jq '.[0:3]'" />
            <div className="mt-2">curl https://gridsense.app/api/counties?state=TX | jq '.[0:3]'</div>
          </div>
          <p className="text-muted-foreground text-xs">
            Rate limits: 60 requests/min on public endpoints, 600 requests/min for authenticated sessions.
            Contact <a href="mailto:api@gridsense.app" className="text-primary hover:underline">api@gridsense.app</a> for
            higher tiers, webhook subscriptions, or a Snowflake/Databricks share.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {ENDPOINTS.map((ep) => {
            const meta = CATEGORY_META[ep.category];
            const Icon = meta.icon;
            return (
              <div key={ep.path + ep.method} className="space-y-2 border-b border-border last:border-0 pb-6 last:pb-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {ep.method}
                  </Badge>
                  <code className="text-sm font-mono font-semibold">{ep.path}</code>
                  <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider ${meta.color}`}>
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{ep.summary}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <EndpointSnippet ep={ep} />
                  <div className="rounded-md bg-muted p-3 font-mono text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Response (sample)</div>
                    <pre className="whitespace-pre-wrap">{ep.responseExample}</pre>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Freshness</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>ISO interconnection queues</TableCell><TableCell className="font-mono text-xs">Monthly</TableCell><TableCell className="text-xs">PJM, MISO, ERCOT, ISO-NE, SPP, CAISO, NYISO</TableCell></TableRow>
              <TableRow><TableCell>EIA-860 generators</TableCell><TableCell className="font-mono text-xs">Annual + preliminary quarterly</TableCell><TableCell className="text-xs">U.S. Energy Information Administration</TableCell></TableRow>
              <TableRow><TableCell>FEMA NRI (hazard, water)</TableCell><TableCell className="font-mono text-xs">Semi-annual</TableCell><TableCell className="text-xs">FEMA National Risk Index</TableCell></TableRow>
              <TableRow><TableCell>SEC EDGAR shell filings</TableCell><TableCell className="font-mono text-xs">Daily</TableCell><TableCell className="text-xs">SEC EDGAR full-text search</TableCell></TableRow>
              <TableRow><TableCell>Data-center news</TableCell><TableCell className="font-mono text-xs">Daily</TableCell><TableCell className="text-xs">DCD, Bisnow, Data Center Knowledge, Utility Dive, Reuters</TableCell></TableRow>
              <TableRow><TableCell>Score snapshot</TableCell><TableCell className="font-mono text-xs">Nightly</TableCell><TableCell className="text-xs">GridSense scoring engine v5</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
