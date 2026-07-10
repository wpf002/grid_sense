import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Swords, TrendingUp, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

type HeatRow = {
  fips: string;
  name: string;
  state: string;
  score: number;
  bid_count: number;
  unique_operators: number;
  operators: string;
  active_count: number;
};

const STAGE_STYLE: Record<string, string> = {
  sniffing: "bg-muted text-muted-foreground",
  loi: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  option: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  under_contract: "bg-primary/20 text-primary",
  closed: "bg-green-500/20 text-green-700 dark:text-green-400",
  walked: "bg-red-500/20 text-red-700 dark:text-red-400",
};

export default function CompetitiveBids({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: heat, isLoading } = useQuery<HeatRow[]>({
    queryKey: ["/api/competitive-bids/heat"],
  });

  const totals = useMemo(() => {
    const rows = heat ?? [];
    return {
      hot_counties: rows.filter((r) => r.active_count >= 2).length,
      total_bids: rows.reduce((s, r) => s + r.bid_count, 0),
      active_deals: rows.reduce((s, r) => s + r.active_count, 0),
      unique_operators: new Set(
        rows.flatMap((r) => (r.operators ?? "").split(",").map((o) => o.trim()).filter(Boolean))
      ).size,
    };
  }, [heat]);

  // Pagination — 25 rows per page. This list has no client-side filters, so the
  // page only resets when the underlying data length changes.
  const heatRows = heat ?? [];
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(heatRows.length / PAGE_SIZE));
  useEffect(() => { setPage(0); }, [heatRows.length]);
  const pageSafe = Math.min(page, pageCount - 1);
  const paged = heatRows.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = heatRows.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd = Math.min(heatRows.length, (pageSafe + 1) * PAGE_SIZE);

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" /> Competitive Bid Intel
          </h1>
          <p className="text-sm text-muted-foreground">
            Who else is looking at your target counties. Detected from SEC 8-Ks, shell-LLC filings, brokerage rumors, county planning agendas, and utility filings over the last 180 days.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={(heat ?? []).length === 0}
          onClick={() => downloadCsv(heat ?? [], "gridsense_competitive_heat", [
            { key: "name", label: "County" },
            { key: "state", label: "State" },
            { key: "score", label: "Score" },
            { key: "bid_count", label: "Bids" },
            { key: "unique_operators", label: "Unique operators" },
            { key: "active_count", label: "Active" },
            { key: "operators", label: "Operators" },
          ])}
          data-testid="button-export-competitive"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Contested counties</div>
          <div className="text-xl font-semibold">{totals.hot_counties}</div>
          <div className="text-[10px] text-muted-foreground">2+ operators active</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Total signals</div>
          <div className="text-xl font-semibold">{totals.total_bids}</div>
          <div className="text-[10px] text-muted-foreground">last 180 days</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Active deals</div>
          <div className="text-xl font-semibold">{totals.active_deals}</div>
          <div className="text-[10px] text-muted-foreground">LOI · option · UC · closed</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">Operators observed</div>
          <div className="text-xl font-semibold">{totals.unique_operators}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Hottest Counties (Most Competitive Activity)
          </CardTitle>
          <p className="text-xs text-muted-foreground">Click a county to see the full bid timeline.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-96 w-full" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>County</TableHead>
                    <TableHead className="text-right">GS score</TableHead>
                    <TableHead className="text-right">Total signals</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Unique ops</TableHead>
                    <TableHead>Operators involved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(heat ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground" data-testid="empty-bids">
                        No competitive bids match your filters. Try selecting a broader operator set.
                      </TableCell>
                    </TableRow>
                  )}
                  {paged.map((r) => (
                    <TableRow key={r.fips} data-testid={`row-heat-${r.fips}`}>
                      <TableCell>
                        <Link href={`/counties/${r.fips}`}>
                          <button className="text-primary hover:underline text-left text-sm font-medium">{r.name}, {r.state}</button>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono">{Math.round(r.score)}</TableCell>
                      <TableCell className="text-right font-mono">{r.bid_count}</TableCell>
                      <TableCell className="text-right font-mono">
                        {r.active_count > 0 ? <Badge className="bg-primary/20 text-primary text-[10px]">{r.active_count}</Badge> : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.unique_operators}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(r.operators ?? "").split(",").map((op) => (
                            <Badge key={op.trim()} variant="outline" className="text-[10px]">{op.trim()}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && heatRows.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
          <div className="text-muted-foreground text-xs tabular-nums">
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {heatRows.length.toLocaleString()}
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

export { STAGE_STYLE };
