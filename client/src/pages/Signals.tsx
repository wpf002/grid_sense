import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, Radio, Download, ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import type { Signal } from "@shared/schema";
import { SignalDetailModal } from "@/components/SignalDetailModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const signalTypes = [
  { value: "all", label: "All types" },
  { value: "llc_land_purchase", label: "LLC land purchase" },
  { value: "rezoning", label: "Rezoning" },
  { value: "substation_filing", label: "Substation filing" },
  { value: "water_permit", label: "Water permit" },
  { value: "interconnection_request", label: "Interconnection" },
  { value: "building_permit", label: "Building permit" },
  { value: "incentive_deal", label: "Incentive deal" },
  { value: "codename_resolved", label: "Codename resolved" },
];

export default function Signals() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState("all");
  const [countyFilter, setCountyFilter] = useState("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

  const { data: signals, isLoading } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });

  const operatorOptions = useMemo(() => {
    if (!signals) return [] as string[];
    const set = new Set<string>();
    for (const s of signals) {
      if (s.suspectedOperator && s.suspectedOperator !== "unknown") set.add(s.suspectedOperator);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [signals]);

  const countyOptions = useMemo(() => {
    if (!signals) return [] as string[];
    const set = new Set<string>();
    for (const s of signals) if (s.countyFips) set.add(s.countyFips);
    return Array.from(set).sort();
  }, [signals]);

  const filtered = useMemo(() => {
    if (!signals) return [];
    const out = signals.filter((s) => {
      const q = query.trim().toLowerCase();
      const matchesQ =
        !q ||
        s.headline.toLowerCase().includes(q) ||
        (s.detail ?? "").toLowerCase().includes(q) ||
        (s.suspectedOperator ?? "").toLowerCase().includes(q) ||
        (s.shellLlc ?? "").toLowerCase().includes(q);
      const matchesType = typeFilter === "all" || s.signalType === typeFilter;
      const matchesOp = operatorFilter === "all" || s.suspectedOperator === operatorFilter;
      const matchesCounty = countyFilter === "all" || s.countyFips === countyFilter;
      return matchesQ && matchesType && matchesOp && matchesCounty;
    });
    return out.sort((a, b) => {
      const at = new Date(a.detectedAt).getTime();
      const bt = new Date(b.detectedAt).getTime();
      return sortDir === "desc" ? bt - at : at - bt;
    });
  }, [signals, query, typeFilter, operatorFilter, countyFilter, sortDir]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            Signal feed
          </h1>
          <p className="text-sm text-muted-foreground">
            Every detected event that feeds the parcel-trigger layer of the scoring model.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(filtered as unknown as Record<string, unknown>[], "gridsense_signals", [
            { key: "detectedAt", label: "Detected" },
            { key: "signalType", label: "Type" },
            { key: "headline", label: "Headline" },
            { key: "countyFips", label: "County FIPS" },
            { key: "suspectedOperator", label: "Operator" },
            { key: "weight", label: "Weight" },
            { key: "sourceUrl", label: "Source" },
          ])}
          data-testid="button-export-signals"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search headline, operator, or shell LLC"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-signal-search"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger data-testid="select-signal-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {signalTypes.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={operatorFilter} onValueChange={setOperatorFilter}>
          <SelectTrigger data-testid="select-signal-operator">
            <SelectValue placeholder="All operators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All operators</SelectItem>
            {operatorOptions.map((op) => (
              <SelectItem key={op} value={op}>{op}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={countyFilter} onValueChange={setCountyFilter}>
            <SelectTrigger data-testid="select-signal-county" className="flex-1">
              <SelectValue placeholder="All counties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All counties</SelectItem>
              {countyOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            title={sortDir === "desc" ? "Newest first" : "Oldest first"}
            data-testid="button-signal-sort"
          >
            {sortDir === "desc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card
              key={s.id}
              data-testid={`signal-card-${s.id}`}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedSignal(s)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-1 shrink-0 w-16">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {new Date(s.detectedAt).toLocaleDateString("en-US", { month: "short" })}
                    </div>
                    <div className="text-lg font-semibold tabular-nums leading-none">
                      {new Date(s.detectedAt).getDate()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{new Date(s.detectedAt).getFullYear()}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className="text-[10px] font-mono uppercase">
                        {s.signalType.replace(/_/g, " ")}
                      </Badge>
                      {s.confidence != null && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          conf {(s.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                      {s.leadTimeMonths != null && (
                        <span className="text-[10px] text-muted-foreground">
                          lead {s.leadTimeMonths.toFixed(0)}mo
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium hover:text-primary block">
                      {s.headline}
                    </div>
                    {s.detail && <p className="text-xs text-muted-foreground mt-1">{s.detail}</p>}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                      {s.suspectedOperator && s.suspectedOperator !== "unknown" && (
                        <span>
                          Operator: <span className="text-foreground font-medium">{s.suspectedOperator}</span>
                        </span>
                      )}
                      {s.shellLlc && <span className="font-mono">{s.shellLlc}</span>}
                      {s.parcelAcres != null && <span>{s.parcelAcres.toLocaleString()} acres</span>}
                      {s.sourceUrl && (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.sourceName ?? "Source"} ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card>
              <CardContent className="text-center py-12 text-sm text-muted-foreground space-y-2">
                <Radio className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <div>No signals match your filters.</div>
                {(query || typeFilter !== "all" || operatorFilter !== "all" || countyFilter !== "all") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setTypeFilter("all");
                      setOperatorFilter("all");
                      setCountyFilter("all");
                    }}
                    data-testid="button-clear-signal-filters"
                  >
                    Clear filters
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <SignalDetailModal
        signal={selectedSignal}
        onClose={() => setSelectedSignal(null)}
      />
    </div>
  );
}
