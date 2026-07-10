import { useQuery } from "@tanstack/react-query";
import { humanize } from "@/lib/utils";
import { Link } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Marker, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import { X, ExternalLink, Layers, Ruler, TrendingUp } from "lucide-react";
import type { CountyDetail as CountyDetailType, Parcel } from "@shared/schema";
import { ScoreBadge } from "./ScoreBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import "leaflet/dist/leaflet.css";

interface Props {
  fips: string | null;
  onClose: () => void;
}

function FitToCounty({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], 9);
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [map, lat, lng]);
  return null;
}

function parcelColor(status: string | null | undefined, score: number): string {
  if (status === "announced") return "hsl(0 80% 60%)";       // red — locked in
  if (status === "rezoning") return "hsl(30 90% 55%)";        // orange — hot
  if (status === "assembling") return "hsl(50 90% 55%)";      // yellow
  if (score >= 75) return "hsl(175 84% 45%)";                 // teal — high score
  if (score >= 60) return "hsl(200 70% 55%)";
  return "hsl(220 10% 55%)";
}

function ParcelRow({ p }: { p: Parcel }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-2 px-3 border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
      data-testid={`parcel-row-${p.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: parcelColor(p.status, p.parcelScore ?? 0) }}
          />
          <span className="text-xs font-medium truncate">
            {p.ownerName ?? "(owner unknown)"}
          </span>
          {p.resolvedOperator && (
            <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-primary/40 text-primary shrink-0">
              → {p.resolvedOperator}
            </Badge>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{p.acres.toFixed(0)} ac</span>
          <span>·</span>
          <span>{p.substationDistanceMi != null ? `${p.substationDistanceMi.toFixed(1)}mi sub` : "sub —"}</span>
          <span>·</span>
          <span>{p.fiberDistanceMi != null ? `${p.fiberDistanceMi.toFixed(1)}mi fib` : "fib —"}</span>
          {p.zoning && <><span>·</span><span>{p.zoning}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant="outline"
          className="text-[9px] uppercase font-mono"
        >
          {p.status ?? "watch"}
        </Badge>
        <span className="font-mono text-xs font-semibold tabular-nums">
          {(p.parcelScore ?? 0).toFixed(0)}
        </span>
      </div>
    </div>
  );
}

export function CountyDrillPanel({ fips, onClose }: Props) {
  const { data, isLoading } = useQuery<CountyDetailType>({
    queryKey: ["/api/counties", fips ?? ""],
    enabled: !!fips,
  });

  if (!fips) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[900]"
        onClick={onClose}
        data-testid="drill-panel-backdrop"
      />
      {/* Panel */}
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[540px] bg-card border-l border-border z-[1000] flex flex-col shadow-2xl"
        data-testid="drill-panel"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          {isLoading || !data ? (
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">
                  {data.name}, {data.state}
                </h3>
                <ScoreBadge score={data.landingProbability ?? 0} tier={data.scoreTier ?? undefined} size="sm" />
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                FIPS {data.fips} · {data.iso ?? "—"} · {data.utility ?? "—"}
              </div>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-drill" className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mini map */}
        <div className="h-[220px] shrink-0 border-b border-border">
          {data && (
            <MapContainer
              center={[data.lat, data.lng]}
              zoom={9}
              style={{ height: "100%", width: "100%", background: "hsl(220 30% 12%)" }}
              scrollWheelZoom={false}
              zoomControl={false}
            >
              <FitToCounty lat={data.lat} lng={data.lng} />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                maxZoom={12}
              />
              {/* County center anchor */}
              <CircleMarker
                center={[data.lat, data.lng]}
                radius={6}
                pathOptions={{
                  color: "hsl(0 0% 100%)",
                  fillColor: "hsl(175 84% 45%)",
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              />
              {/* Parcels — jitter around county center since we don't have real coords */}
              {data.parcels.map((p, idx) => {
                // Deterministic jitter within ~15mi ring based on parcel id
                const seed = (p.id * 9301 + 49297) % 233280;
                const rnd1 = (seed / 233280) - 0.5;
                const seed2 = ((p.id + 7) * 9301 + 49297) % 233280;
                const rnd2 = (seed2 / 233280) - 0.5;
                const lat = data.lat + rnd1 * 0.25;
                const lng = data.lng + rnd2 * 0.30;
                const c = parcelColor(p.status, p.parcelScore ?? 0);
                const r = 4 + ((p.parcelScore ?? 0) / 100) * 5;
                return (
                  <CircleMarker
                    key={p.id}
                    center={[lat, lng]}
                    radius={r}
                    pathOptions={{ color: c, fillColor: c, fillOpacity: 0.75, weight: 1.2 }}
                  >
                    <Tooltip direction="top" offset={[0, -4]} opacity={1} className="gs-map-tooltip">
                      <div className="text-[10px]">
                        <div className="font-semibold">{p.ownerName ?? "(owner unknown)"}</div>
                        <div className="font-mono text-muted-foreground">
                          {p.acres.toFixed(0)} ac · score {(p.parcelScore ?? 0).toFixed(0)} · {humanize(p.status)}
                        </div>
                      </div>
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
        </div>

        {/* Snapshot stats */}
        {data && (
          <div className="grid grid-cols-4 gap-0 border-b border-border shrink-0">
            <div className="p-3 border-r border-border">
              <div className="flex items-center gap-1 text-[9px] uppercase font-mono text-muted-foreground tracking-wider">
                <Layers className="h-3 w-3" /> Parcels
              </div>
              <div className="text-lg font-semibold mt-1 tabular-nums">{data.parcels.length}</div>
            </div>
            <div className="p-3 border-r border-border">
              <div className="flex items-center gap-1 text-[9px] uppercase font-mono text-muted-foreground tracking-wider">
                <TrendingUp className="h-3 w-3" /> Gen Queue
              </div>
              <div className="text-lg font-semibold mt-1 tabular-nums">
                {data.queuedLoadMw && data.queuedLoadMw >= 1000
                  ? `${(data.queuedLoadMw / 1000).toFixed(1)}GW`
                  : data.queuedLoadMw
                  ? `${data.queuedLoadMw.toFixed(0)}MW`
                  : "—"}
              </div>
            </div>
            <div className="p-3 border-r border-border">
              <div className="flex items-center gap-1 text-[9px] uppercase font-mono text-muted-foreground tracking-wider">
                <Ruler className="h-3 w-3" /> Land
              </div>
              <div className="text-lg font-semibold mt-1 tabular-nums">
                {data.medianLandPricePerAcre ? `$${(data.medianLandPricePerAcre / 1000).toFixed(0)}k` : "—"}
              </div>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-1 text-[9px] uppercase font-mono text-muted-foreground tracking-wider">
                DCs
              </div>
              <div className="text-lg font-semibold mt-1 tabular-nums">{data.existingDcCount ?? 0}</div>
            </div>
          </div>
        )}

        {/* Parcel list */}
        <div className="flex-1 overflow-y-auto">
          {data ? (
            <>
              <div className="px-4 py-2 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Candidate parcels ({data.parcels.length})</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Sorted by score
                  </span>
                </div>
              </div>
              {data.parcels.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No parcels catalogued for this county yet.
                </div>
              ) : (
                data.parcels.map((p) => <ParcelRow key={p.id} p={p} />)
              )}
            </>
          ) : (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="border-t border-border p-3 shrink-0">
            <Button asChild className="w-full" size="sm">
              <Link href={`/counties/${data.fips}`} data-testid="link-full-county-detail">
                Open full county profile <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        )}
      </aside>
    </>
  );
}
