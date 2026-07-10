import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Search, Download, X, Bookmark, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { County } from "@shared/schema";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatMw(mw?: number | null): string {
  if (mw == null || mw === 0) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toFixed(0)} MW`;
}

// URL-synced filters live in the real query string now that routing is
// path-based (was hash-fragment parsing when the app used hash routing).
function readUrlQuery(): URLSearchParams {
  return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
}

function writeUrlQuery(params: URLSearchParams) {
  if (typeof window === "undefined") return;
  const q = params.toString();
  const base = window.location.pathname;
  window.history.replaceState(null, "", q ? `${base}?${q}` : base);
}

function toCsv(rows: County[]): string {
  const header = [
    "fips","name","state","iso","utility",
    "landing_probability","score_tier",
    "queued_load_mw","time_to_power_months",
    "fiber_density_score","large_parcel_count",
    "median_land_price_per_acre","existing_dc_count","existing_dc_capacity_mw",
    "moratorium_status","hazard_score","water_stress_score","tax_incentive_score",
    "updated_at",
  ];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const c of rows) {
    lines.push([
      c.fips, c.name, c.state, c.iso ?? "", c.utility ?? "",
      (c.landingProbability ?? 0).toFixed(2), c.scoreTier ?? "",
      c.queuedLoadMw ?? 0, c.timeToPowerMonths ?? "",
      c.fiberDensityScore ?? 0, c.largeParcelCount ?? 0,
      c.medianLandPricePerAcre ?? "", c.existingDcCount ?? 0, c.existingDcCapacityMw ?? 0,
      c.moratoriumStatus ?? "none", c.hazardScore ?? 0, c.waterStressScore ?? 0, c.taxIncentiveScore ?? 0,
      c.updatedAt ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

function downloadCsv(rows: County[], filename: string) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Counties() {
  const [location] = useLocation();
  // Read initial state from URL
  const initial = useMemo(() => readUrlQuery(), [location]);
  const [query, setQuery] = useState(initial.get("q") ?? "");
  const [tierFilter, setTierFilter] = useState<string>(initial.get("tier") ?? "all");
  const [isoFilter, setIsoFilter] = useState<string>(initial.get("iso") ?? "all");
  const [stateFilter, setStateFilter] = useState<string>(initial.get("state") ?? "all");
  const [moratoriumFilter, setMoratoriumFilter] = useState<string>(initial.get("mor") ?? "all");
  const [minScore, setMinScore] = useState<string>(initial.get("min") ?? "0");
  const [sortBy, setSortBy] = useState<string>(initial.get("sort") ?? "score");

  const { data: counties, isLoading } = useQuery<County[]>({ queryKey: ["/api/counties"] });

  // Persist filter state to URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (tierFilter !== "all") p.set("tier", tierFilter);
    if (isoFilter !== "all") p.set("iso", isoFilter);
    if (stateFilter !== "all") p.set("state", stateFilter);
    if (moratoriumFilter !== "all") p.set("mor", moratoriumFilter);
    if (minScore !== "0") p.set("min", minScore);
    if (sortBy !== "score") p.set("sort", sortBy);
    writeUrlQuery(p);
  }, [query, tierFilter, isoFilter, stateFilter, moratoriumFilter, minScore, sortBy]);

  const uniqueIsos = useMemo(() => {
    if (!counties) return [];
    return Array.from(new Set(counties.map((c) => c.iso).filter((x): x is string => !!x))).sort();
  }, [counties]);

  const uniqueStates = useMemo(() => {
    if (!counties) return [];
    return Array.from(new Set(counties.map((c) => c.state))).sort();
  }, [counties]);

  const filtered = useMemo(() => {
    if (!counties) return [];
    const minS = Number(minScore);
    let rows = counties.filter((c) => {
      const q = query.trim().toLowerCase();
      const matchesQ =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.state.toLowerCase().includes(q) ||
        (c.utility ?? "").toLowerCase().includes(q) ||
        (c.iso ?? "").toLowerCase().includes(q);
      const matchesTier = tierFilter === "all" || c.scoreTier === tierFilter;
      const matchesIso = isoFilter === "all" || c.iso === isoFilter;
      const matchesState = stateFilter === "all" || c.state === stateFilter;
      const matchesMor =
        moratoriumFilter === "all" ||
        (moratoriumFilter === "clean" && (!c.moratoriumStatus || c.moratoriumStatus === "none")) ||
        (moratoriumFilter === "risk" && c.moratoriumStatus && c.moratoriumStatus !== "none");
      const matchesMin = (c.landingProbability ?? 0) >= minS;
      return matchesQ && matchesTier && matchesIso && matchesState && matchesMor && matchesMin;
    });

    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "queue":
          return (b.queuedLoadMw ?? 0) - (a.queuedLoadMw ?? 0);
        case "ttp":
          return (a.timeToPowerMonths ?? 999) - (b.timeToPowerMonths ?? 999);
        case "land":
          return (a.medianLandPricePerAcre ?? Infinity) - (b.medianLandPricePerAcre ?? Infinity);
        case "score":
        default:
          return (b.landingProbability ?? 0) - (a.landingProbability ?? 0);
      }
    });
    return rows;
  }, [counties, query, tierFilter, isoFilter, stateFilter, moratoriumFilter, minScore, sortBy]);

  const activeFilterCount =
    (tierFilter !== "all" ? 1 : 0) +
    (isoFilter !== "all" ? 1 : 0) +
    (stateFilter !== "all" ? 1 : 0) +
    (moratoriumFilter !== "all" ? 1 : 0) +
    (minScore !== "0" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  // Pagination — 50 rows per page. Reset to the first page whenever the filtered
  // set changes so you never land on an out-of-range page.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [query, tierFilter, isoFilter, stateFilter, moratoriumFilter, minScore, sortBy]);
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (pageSafe + 1) * PAGE_SIZE);

  // Saved searches (auth-gated)
  const { data: me } = useQuery<{ id: number; email: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const r = await apiRequest("GET", "/api/auth/me");
        if (!r.ok) return null;
        const j = await r.json();
        return j?.user ?? null;
      } catch {
        return null;
      }
    },
  });
  const isAuthed = me != null && me.id != null;
  const { data: savedSearches } = useQuery<Array<{ id: string; name: string; filters: Record<string, string> }>>({
    queryKey: ["/api/user/saved-searches"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/user/saved-searches");
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isAuthed,
  });
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const saveMutation = useMutation({
    mutationFn: async (name: string) => {
      const filters: Record<string, string> = {};
      if (query) filters.q = query;
      if (tierFilter !== "all") filters.tier = tierFilter;
      if (isoFilter !== "all") filters.iso = isoFilter;
      if (stateFilter !== "all") filters.state = stateFilter;
      if (moratoriumFilter !== "all") filters.mor = moratoriumFilter;
      if (minScore !== "0") filters.min = minScore;
      if (sortBy !== "score") filters.sort = sortBy;
      const r = await apiRequest("POST", "/api/user/saved-searches", { name, filters });
      if (!r.ok) throw new Error("Failed to save");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/saved-searches"] });
      setSaveOpen(false);
      setSaveName("");
      toast({ title: "Saved", description: `Search "${saveName}" saved.` });
    },
    onError: () => toast({ title: "Error", description: "Could not save search.", variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("DELETE", `/api/user/saved-searches/${id}`);
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/saved-searches"] });
      toast({ title: "Deleted" });
    },
  });
  const applySavedSearch = (filters: Record<string, string>) => {
    setQuery(filters.q ?? "");
    setTierFilter(filters.tier ?? "all");
    setIsoFilter(filters.iso ?? "all");
    setStateFilter(filters.state ?? "all");
    setMoratoriumFilter(filters.mor ?? "all");
    setMinScore(filters.min ?? "0");
    setSortBy(filters.sort ?? "score");
  };

  const clearFilters = () => {
    setQuery("");
    setTierFilter("all");
    setIsoFilter("all");
    setStateFilter("all");
    setMoratoriumFilter("all");
    setMinScore("0");
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Counties</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {counties?.length ?? 0} US counties scored on the composite landing-probability model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAuthed && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-saved-searches">
                  <Bookmark className="h-3.5 w-3.5 mr-1.5" />
                  Saved ({savedSearches?.length ?? 0})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-2" align="end">
                <div className="space-y-1">
                  {(savedSearches ?? []).length === 0 && (
                    <div className="text-xs text-muted-foreground p-2">
                      No saved searches. Use "Save current" to bookmark filter presets.
                    </div>
                  )}
                  {(savedSearches ?? []).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-accent group"
                      data-testid={`saved-search-${s.id}`}
                    >
                      <button
                        onClick={() => applySavedSearch(s.filters)}
                        className="flex-1 text-left text-sm truncate"
                        data-testid={`button-apply-search-${s.id}`}
                      >
                        {s.name}
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(s.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        data-testid={`button-delete-search-${s.id}`}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {isAuthed && (
            <Popover open={saveOpen} onOpenChange={setSaveOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeFilterCount === 0}
                  data-testid="button-save-search"
                >
                  <Bookmark className="h-3.5 w-3.5 mr-1.5" />
                  Save current
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="end">
                <div className="space-y-2">
                  <div className="text-xs font-medium">Save current filters as</div>
                  <Input
                    placeholder="e.g. Texas Hot ERCOT"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    data-testid="input-save-search-name"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveName.trim() && saveMutation.mutate(saveName.trim())}
                      disabled={!saveName.trim() || saveMutation.isPending}
                      data-testid="button-confirm-save-search"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(filtered, `gridsense-counties-${new Date().toISOString().slice(0, 10)}.csv`)}
            disabled={filtered.length === 0}
            data-testid="button-export-csv"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV ({filtered.length})
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search county, state, ISO, or utility"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              data-testid="input-county-search"
            />
          </div>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="emerging">Emerging</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full sm:w-[170px]" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Sort: Score</SelectItem>
              <SelectItem value="queue">Sort: Gen Queue MW</SelectItem>
              <SelectItem value="ttp">Sort: Time to Power</SelectItem>
              <SelectItem value="land">Sort: Land Price</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={isoFilter} onValueChange={setIsoFilter}>
            <SelectTrigger className="w-[140px] h-9" data-testid="select-iso">
              <SelectValue placeholder="ISO / RTO" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ISOs</SelectItem>
              {uniqueIsos.map((iso) => (
                <SelectItem key={iso} value={iso}>{iso}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[130px] h-9" data-testid="select-state">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {uniqueStates.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moratoriumFilter} onValueChange={setMoratoriumFilter}>
            <SelectTrigger className="w-[170px] h-9" data-testid="select-moratorium">
              <SelectValue placeholder="Moratorium" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Moratorium</SelectItem>
              <SelectItem value="clean">No moratorium</SelectItem>
              <SelectItem value="risk">Proposed or active</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minScore} onValueChange={setMinScore}>
            <SelectTrigger className="w-[160px] h-9" data-testid="select-min-score">
              <SelectValue placeholder="Min Score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Min Score: Any</SelectItem>
              <SelectItem value="50">Min Score: 50</SelectItem>
              <SelectItem value="60">Min Score: 60</SelectItem>
              <SelectItem value="70">Min Score: 70</SelectItem>
              <SelectItem value="80">Min Score: 80</SelectItem>
            </SelectContent>
          </Select>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="h-3 w-3 mr-1" />
              Clear ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>County</TableHead>
                    <TableHead>ISO / Utility</TableHead>
                    <TableHead className="text-right">Gen Queue</TableHead>
                    <TableHead className="text-right">TTP</TableHead>
                    <TableHead className="text-right">Fiber</TableHead>
                    <TableHead className="text-right">Land $/ac</TableHead>
                    <TableHead className="text-right">DCs</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((c) => (
                    <TableRow key={c.fips} data-testid={`row-county-${c.fips}`}>
                      <TableCell className="py-3">
                        <Link href={`/counties/${c.fips}`} className="block hover:text-primary">
                          <div className="font-medium text-sm">{c.name}, {c.state}</div>
                          {c.moratoriumStatus && c.moratoriumStatus !== "none" && (
                            <div className="text-[10px] text-orange-500 uppercase tracking-wider mt-0.5">
                              Moratorium: {c.moratoriumStatus}
                            </div>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-mono">{c.iso ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{c.utility ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMw(c.queuedLoadMw)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {c.timeToPowerMonths ? `${c.timeToPowerMonths.toFixed(0)}mo` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {(c.fiberDensityScore ?? 0).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {c.medianLandPricePerAcre ? `$${(c.medianLandPricePerAcre / 1000).toFixed(0)}k` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {c.existingDcCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreBadge score={c.landingProbability ?? 0} tier={c.scoreTier ?? undefined} size="sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                        No counties match your filters.
                        {activeFilterCount > 0 && (
                          <Button variant="link" size="sm" onClick={clearFilters} className="ml-1 h-auto p-0">
                            Clear filters
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
          <div className="text-muted-foreground text-xs tabular-nums">
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filtered.length.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pageSafe === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="button-page-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
            </Button>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              Page {pageSafe + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pageSafe >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              data-testid="button-page-next"
            >
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
