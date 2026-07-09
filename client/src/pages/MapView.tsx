import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Map as MapIcon, Layers, Flame, Snowflake, ArrowLeft } from "lucide-react";

interface CountyMapRow {
  fips: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  landing_probability: number;
  score_tier: "hot" | "warm" | "emerging" | "cold";
  queued_load_mw: number;
  existing_dc_count: number;
  iso: string | null;
}

const TIER_COLORS: Record<string, string> = {
  hot: "#ef4444",
  warm: "#f59e0b",
  emerging: "#3b82f6",
  cold: "#64748b",
};

const TIER_ORDER = ["hot", "warm", "emerging", "cold"] as const;

function FlyToActive({ active }: { active: CountyMapRow | null }) {
  const map = useMap();
  useEffect(() => {
    if (active) map.flyTo([active.lat, active.lng], 7, { duration: 0.6 });
  }, [active, map]);
  return null;
}

export default function MapView() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [activeTier, setActiveTier] = useState<CountyMapRow | null>(null);

  const { data, isLoading } = useQuery<CountyMapRow[]>({
    queryKey: ["/api/counties/map"],
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.filter((c) => {
      if (tierFilter !== "all" && c.score_tier !== tierFilter) return false;
      if (q) {
        return (
          c.name.toLowerCase().includes(q) ||
          c.state.toLowerCase().includes(q) ||
          c.fips.startsWith(q)
        );
      }
      return true;
    });
  }, [data, query, tierFilter]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = { hot: 0, warm: 0, emerging: 0, cold: 0 };
    for (const r of data ?? []) c[r.score_tier] = (c[r.score_tier] ?? 0) + 1;
    return c;
  }, [data]);

  const topByTier = useMemo(() => {
    if (!filtered.length) return [];
    return [...filtered]
      .sort((a, b) => b.landing_probability - a.landing_probability)
      .slice(0, 10);
  }, [filtered]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
      </Link>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-primary" />
            National Radar
          </h1>
          <p className="text-sm text-muted-foreground">
            All {data?.length ?? 3109} US counties colored by 12-18 month data-center landing probability.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {TIER_ORDER.map((t) => (
            <Badge
              key={t}
              variant="outline"
              className="text-[10px] font-mono uppercase cursor-pointer"
              style={{ borderColor: TIER_COLORS[t], color: TIER_COLORS[t] }}
              onClick={() => setTierFilter(tierFilter === t ? "all" : t)}
              data-testid={`legend-${t}`}
            >
              {t === "hot" && <Flame className="h-3 w-3 mr-1" />}
              {t === "cold" && <Snowflake className="h-3 w-3 mr-1" />}
              {t} · {tierCounts[t] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search county, state, or FIPS"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-map-search"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-map-tier">
            <Layers className="h-3.5 w-3.5 mr-1.5 opacity-60" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {TIER_ORDER.map((t) => (
              <SelectItem key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <Skeleton className="h-[640px] w-full" />
            ) : (
              <div className="h-[640px]">
                <MapContainer
                  center={[38.5, -95.5]}
                  zoom={4}
                  minZoom={4}
                  maxBounds={[[8, -172], [72, -52]]}
                  maxBoundsViscosity={0.9}
                  scrollWheelZoom
                  className="h-full w-full bg-slate-900"
                  worldCopyJump
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors, &copy; CARTO'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
                  />
                  <FlyToActive active={activeTier} />
                  {filtered.map((c) => {
                    const radius =
                      c.score_tier === "hot" ? 8 :
                      c.score_tier === "warm" ? 6 :
                      c.score_tier === "emerging" ? 4 : 2.5;
                    const opacity = c.score_tier === "cold" ? 0.35 : 0.85;
                    return (
                      <CircleMarker
                        key={c.fips}
                        center={[c.lat, c.lng]}
                        radius={radius}
                        pathOptions={{
                          color: TIER_COLORS[c.score_tier],
                          fillColor: TIER_COLORS[c.score_tier],
                          fillOpacity: opacity,
                          weight: c.score_tier === "hot" ? 1.5 : 1,
                        }}
                        eventHandlers={{
                          click: () => setLocation(`/counties/${c.fips}`),
                        }}
                      >
                        <Popup>
                          <div className="text-xs space-y-1">
                            <div className="font-semibold text-sm">
                              {c.name} County, {c.state}
                            </div>
                            <div>Score: <span className="font-mono">{c.landing_probability}</span> · <span className="uppercase font-mono">{c.score_tier}</span></div>
                            <div>Queued load: <span className="font-mono">{c.queued_load_mw.toLocaleString()} MW</span></div>
                            {c.existing_dc_count > 0 && (
                              <div>Existing DCs: <span className="font-mono">{c.existing_dc_count}</span></div>
                            )}
                            <Link href={`/counties/${c.fips}`} className="text-primary hover:underline block pt-1">
                              Open county page →
                            </Link>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Top 10 in View
            </div>
            <div className="space-y-2">
              {topByTier.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6">
                  No counties match.
                </div>
              )}
              {topByTier.map((c) => (
                <button
                  key={c.fips}
                  onClick={() => setActiveTier(c)}
                  className="w-full text-left flex items-center justify-between gap-2 p-2 rounded-md hover-elevate"
                  data-testid={`map-top-${c.fips}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.name}, {c.state}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.queued_load_mw.toLocaleString()} MW queued · {c.iso ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{ color: TIER_COLORS[c.score_tier], borderColor: TIER_COLORS[c.score_tier], borderWidth: 1 }}
                    >
                      {c.landing_probability}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full mt-4"
              data-testid="button-map-goto-counties"
            >
              <Link href="/counties">Open the full counties table →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground text-center">
        Colored circles show county centroids. Click any dot to open its detail page.
        Cold counties are dimmed at 35% opacity so hot/warm signal reads through.
      </div>
    </div>
  );
}
