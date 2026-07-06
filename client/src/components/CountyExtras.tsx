import { useQuery } from "@tanstack/react-query";
import { LandPlot, FileText, Flame, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type ParcelRow = {
  id: string;
  apn: string | null;
  acres: number | null;
  owner_name: string | null;
  owner_is_shell_llc: number | null;
  resolved_operator: string | null;
  substation_distance_mi: number | null;
  fiber_distance_mi: number | null;
  zoning: string | null;
  land_price: number | null;
  last_transfer_date: string | null;
  parcel_score: number | null;
  status: string | null;
};

type PermitRow = {
  id: string;
  permit_type: string | null;
  applicant: string | null;
  resolved_operator: string | null;
  parcel_apn: string | null;
  filed_date: string | null;
  status: string | null;
  megawatts: number | null;
  acres: number | null;
  description: string | null;
  source_url: string | null;
};

type BidRow = {
  id: string;
  competing_operators: string | null;
  recent_deals_90d: number | null;
  avg_deal_size_mw: number | null;
  price_pressure_pct: number | null;
  supply_squeeze_score: number | null;
  heat_score: number | null;
  narrative: string | null;
  updated_at: string | null;
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

function fmtAcres(a?: number | null) {
  if (a == null) return "—";
  return `${Math.round(a).toLocaleString()} ac`;
}

function fmtMoney(v?: number | null) {
  if (v == null || v === 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function CountyExtras({ fips }: { fips: string }) {
  const { data: parcelData, isLoading: parcelsLoading } = useQuery<{ parcels: ParcelRow[] }>({
    queryKey: ["/api/counties", fips, "parcel-list"],
    enabled: !!fips,
  });
  const { data: permitData, isLoading: permitsLoading } = useQuery<{ permits: PermitRow[] }>({
    queryKey: ["/api/counties", fips, "permits"],
    enabled: !!fips,
  });
  const { data: bidData, isLoading: bidsLoading } = useQuery<{ bids: BidRow[] }>({
    queryKey: ["/api/counties", fips, "competitive-bids"],
    enabled: !!fips,
  });

  const parcels = parcelData?.parcels ?? [];
  const permits = permitData?.permits ?? [];
  const bids = bidData?.bids ?? [];

  const total = parcels.length + permits.length + bids.length;
  const anyLoading = parcelsLoading || permitsLoading || bidsLoading;

  if (!anyLoading && total === 0) return null;

  return (
    <Card data-testid="card-county-extras">
      <CardHeader className="pb-3">
        <CardTitle className="text-base inline-flex items-center gap-2">
          <LandPlot className="h-4 w-4 text-primary" />
          Site-level activity
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Individual parcels, filed permits, and competitive-bid heat rolled up for this county.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="parcels" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="parcels" data-testid="tab-parcels">
              <LandPlot className="h-3.5 w-3.5 mr-1.5" />
              Parcels ({parcels.length})
            </TabsTrigger>
            <TabsTrigger value="permits" data-testid="tab-permits">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Permits ({permits.length})
            </TabsTrigger>
            <TabsTrigger value="bids" data-testid="tab-bids">
              <Flame className="h-3.5 w-3.5 mr-1.5" />
              Bids ({bids.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="parcels" className="mt-4">
            {parcelsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : parcels.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No site-level parcels tracked for this county yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">APN</TableHead>
                      <TableHead className="text-xs">Owner</TableHead>
                      <TableHead className="text-xs text-right">Acres</TableHead>
                      <TableHead className="text-xs text-right">Sub mi</TableHead>
                      <TableHead className="text-xs text-right">Fiber mi</TableHead>
                      <TableHead className="text-xs">Zoning</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parcels.slice(0, 30).map((p) => (
                      <TableRow key={p.id} data-testid={`row-parcel-detail-${p.id}`}>
                        <TableCell className="text-xs font-mono py-2">{p.apn ?? "—"}</TableCell>
                        <TableCell className="text-xs py-2">
                          <div>{p.owner_name ?? "Unknown"}</div>
                          {p.resolved_operator && (
                            <div className="text-[10px] text-primary mt-0.5">→ {p.resolved_operator}</div>
                          )}
                          {p.owner_is_shell_llc ? (
                            <Badge variant="outline" className="text-[9px] mt-0.5 border-amber-500/40 text-amber-500">
                              shell LLC
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right py-2">{fmtAcres(p.acres)}</TableCell>
                        <TableCell className="text-xs font-mono text-right py-2 text-muted-foreground">
                          {p.substation_distance_mi != null ? p.substation_distance_mi.toFixed(1) : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right py-2 text-muted-foreground">
                          {p.fiber_distance_mi != null ? p.fiber_distance_mi.toFixed(1) : "—"}
                        </TableCell>
                        <TableCell className="text-xs py-2">{p.zoning ?? "—"}</TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {p.status ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right py-2">
                          {p.parcel_score != null ? Math.round(p.parcel_score) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parcels.length > 30 && (
                  <div className="text-[11px] text-muted-foreground mt-2 text-center">
                    Showing top 30 of {parcels.length} parcels. See the Parcels page for full listing + CSV export.
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="permits" className="mt-4">
            {permitsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : permits.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No permits filed for this county yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Filed</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Applicant</TableHead>
                      <TableHead className="text-xs text-right">MW</TableHead>
                      <TableHead className="text-xs text-right">Acres</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permits.slice(0, 30).map((p) => (
                      <TableRow key={p.id} data-testid={`row-permit-detail-${p.id}`}>
                        <TableCell className="text-xs font-mono py-2">{fmtDate(p.filed_date)}</TableCell>
                        <TableCell className="text-xs py-2">
                          <Badge variant="outline" className="text-[10px]">{p.permit_type ?? "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          <div>{p.applicant ?? "—"}</div>
                          {p.resolved_operator && (
                            <div className="text-[10px] text-primary mt-0.5">→ {p.resolved_operator}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right py-2">
                          {p.megawatts != null ? Math.round(p.megawatts) : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right py-2">{fmtAcres(p.acres)}</TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[10px] uppercase">{p.status ?? "—"}</Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          {p.source_url ? (
                            <a
                              href={p.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                              data-testid={`link-permit-source-${p.id}`}
                            >
                              link <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {permits.length > 30 && (
                  <div className="text-[11px] text-muted-foreground mt-2 text-center">
                    Showing top 30 of {permits.length} permits. See the Permits page for full listing.
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bids" className="mt-4">
            {bidsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : bids.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No competitive-bid data recorded for this county yet.
              </p>
            ) : (
              <div className="space-y-3">
                {bids.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-md border border-border p-3"
                    data-testid={`row-bid-detail-${b.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40">
                        <Flame className="h-3 w-3 mr-1" />
                        Heat {b.heat_score != null ? Math.round(b.heat_score) : "—"}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {b.recent_deals_90d ?? 0} deals · 90d
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        avg {b.avg_deal_size_mw != null ? Math.round(b.avg_deal_size_mw) : "—"} MW
                      </span>
                      {b.price_pressure_pct != null && (
                        <span className="text-xs text-muted-foreground font-mono">
                          price pressure {b.price_pressure_pct.toFixed(1)}%
                        </span>
                      )}
                      {b.supply_squeeze_score != null && (
                        <span className="text-xs text-muted-foreground font-mono">
                          supply squeeze {Math.round(b.supply_squeeze_score)}
                        </span>
                      )}
                    </div>
                    {b.competing_operators && (
                      <div className="text-xs mb-1">
                        <span className="text-muted-foreground">Competitors: </span>
                        <span className="font-medium">{b.competing_operators}</span>
                      </div>
                    )}
                    {b.narrative && <div className="text-xs text-muted-foreground">{b.narrative}</div>}
                    {b.updated_at && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-1">
                        updated {fmtDate(b.updated_at)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
        {/* Silence unused import warnings */}
        <span className="hidden">{fmtMoney(0)}</span>
      </CardContent>
    </Card>
  );
}
