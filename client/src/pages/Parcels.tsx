import { useMemo, useState, useEffect } from "react";
import { humanize } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { LandPlot, MapPin, Building2, DollarSign, Cable, Zap, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Parcel = {
  id: number;
  county_fips: string;
  county_name: string;
  state: string;
  county_score: number;
  iso: string | null;
  apn: string;
  acres: number;
  owner_name: string;
  owner_is_shell_llc: number;
  resolved_operator: string | null;
  substation_distance_mi: number;
  fiber_distance_mi: number;
  zoning: string;
  land_price: number | null;
  last_transfer_date: string;
  parcel_score: number;
  status: string;
};

function fmt$(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

const STATUS_STYLE: Record<string, string> = {
  watch: "bg-muted text-muted-foreground",
  rezoning: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  announced: "bg-primary/20 text-primary",
  under_contract: "bg-green-500/20 text-green-700 dark:text-green-400",
};

export default function Parcels({ embedded = false }: { embedded?: boolean } = {}) {
  const [minAcres, setMinAcres] = useState("0");
  const [shellOnly, setShellOnly] = useState(false);
  const [query, setQuery] = useState("");
  const { data, isLoading } = useQuery<Parcel[]>({
    queryKey: ["/api/parcels/top?limit=200"],
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = query.trim().toLowerCase();
    const minA = parseFloat(minAcres);
    return all.filter((r) => {
      if (minA > 0 && r.acres < minA) return false;
      if (shellOnly && !r.owner_is_shell_llc) return false;
      if (q && !`${r.county_name} ${r.state} ${r.owner_name} ${r.apn} ${r.resolved_operator ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, minAcres, shellOnly, query]);

  // Pagination — 25 rows per page. Reset to the first page whenever the filtered
  // set changes so you never land on an out-of-range page.
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [minAcres, shellOnly, query]);
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = rows.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd = Math.min(rows.length, (pageSafe + 1) * PAGE_SIZE);

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
            <LandPlot className="h-5 w-5 text-primary" /> Site-Level Parcels
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} of {data?.length ?? 0} candidate parcels ranked by our composite parcel score (acres, shell-LLC ownership, substation/fiber proximity). Filter for shell-owned to surface likely hyperscaler assemblages.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(rows, "gridsense_parcels", [
            { key: "county_name", label: "County" },
            { key: "state", label: "State" },
            { key: "apn", label: "APN" },
            { key: "acres", label: "Acres" },
            { key: "owner_name", label: "Owner" },
            { key: "resolved_operator", label: "Operator" },
            { key: "substation_distance_mi", label: "Substation (mi)" },
            { key: "fiber_distance_mi", label: "Fiber (mi)" },
            { key: "land_price", label: "Land price" },
            { key: "parcel_score", label: "Parcel score" },
            { key: "status", label: "Status" },
          ])}
          data-testid="button-export-parcels"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[240px]">
              <Input
                placeholder="Search county, owner, APN, operator"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="input-parcels-search"
              />
            </div>
            <Select value={minAcres} onValueChange={setMinAcres}>
              <SelectTrigger className="w-[160px]" data-testid="select-min-acres">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any size</SelectItem>
                <SelectItem value="200">≥ 200 acres</SelectItem>
                <SelectItem value="500">≥ 500 acres</SelectItem>
                <SelectItem value="1000">≥ 1,000 acres</SelectItem>
                <SelectItem value="1500">≥ 1,500 acres</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shellOnly}
                onChange={(e) => setShellOnly(e.target.checked)}
                data-testid="checkbox-shell-only"
              />
              Shell-LLC owned only
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Top Parcels</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Score</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>APN</TableHead>
                    <TableHead className="text-right">Acres</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Zoning</TableHead>
                    <TableHead className="text-right">Substation</TableHead>
                    <TableHead className="text-right">Fiber</TableHead>
                    <TableHead className="text-right">Est. price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground" data-testid="empty-parcels">
                        No parcels match your filters. Try loosening the acreage range or clearing the shell-owned filter.
                      </TableCell>
                    </TableRow>
                  )}
                  {paged.map((r) => (
                    <TableRow key={r.id} data-testid={`row-parcel-${r.id}`}>
                      <TableCell>
                        <div className="text-lg font-bold font-mono text-primary">{(r.parcel_score ?? 0).toFixed(0)}</div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/counties/${r.county_fips}`}>
                          <button className="text-primary hover:underline text-left">
                            <div className="text-sm font-medium">{r.county_name}, {r.state}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">score {Math.round(r.county_score ?? 0)} · {r.iso ?? "—"}</div>
                          </button>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.apn}</TableCell>
                      <TableCell className="text-right font-mono">{(r.acres ?? 0).toFixed(0)}</TableCell>
                      <TableCell>
                        <div className="text-sm">{r.owner_name ?? <span className="text-muted-foreground">—</span>}</div>
                        {r.owner_is_shell_llc ? <Badge variant="outline" className="text-[9px] mt-0.5 border-amber-500/40 text-amber-500">SHELL LLC</Badge> : null}
                      </TableCell>
                      <TableCell>{r.resolved_operator ?? <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                      <TableCell className="text-xs">{r.zoning ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.substation_distance_mi != null ? `${r.substation_distance_mi.toFixed(1)}mi` : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.fiber_distance_mi != null ? `${r.fiber_distance_mi.toFixed(1)}mi` : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{fmt$(r.land_price)}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] uppercase ${STATUS_STYLE[r.status] ?? STATUS_STYLE.watch}`}>{humanize(r.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && rows.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
          <div className="text-muted-foreground text-xs tabular-nums">
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {rows.length.toLocaleString()}
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
