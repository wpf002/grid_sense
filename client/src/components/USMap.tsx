import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, GeoJSON } from "react-leaflet";
import { Link } from "wouter";
import { Layers, Zap } from "lucide-react";
import type { County } from "@shared/schema";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { CountyDrillPanel } from "./CountyDrillPanel";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { feature } from "topojson-client";

// FIPS state code (2-digit) -> USPS abbrev, so we can join topojson polygons to counties.
const STATE_FIPS_TO_ABBR: Record<string, string> = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL",
  "13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME",
  "24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH",
  "34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI",
  "45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY",
};

function StatesLayer({ counties, show }: { counties: County[]; show: boolean }) {
  const [geo, setGeo] = useState<any | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!show || geo) return;
    let cancelled = false;
    fetch("/us-states-10m.json")
      .then((r) => r.json())
      .then((topo: any) => {
        if (cancelled) return;
        const fc = feature(topo, topo.objects.states) as any;
        setGeo(fc);
        setKey((k) => k + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show, geo]);

  // Aggregate median score by state abbrev.
  const stateScore = useMemo(() => {
    const buckets: Record<string, number[]> = {};
    for (const c of counties) {
      if (c.landingProbability == null) continue;
      const st = c.state;
      if (!buckets[st]) buckets[st] = [];
      buckets[st].push(c.landingProbability);
    }
    const med: Record<string, number> = {};
    for (const st of Object.keys(buckets)) {
      const s = buckets[st].sort((a, b) => a - b);
      med[st] = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    }
    return med;
  }, [counties]);

  if (!show || !geo) return null;

  const colorFor = (score: number | undefined): string => {
    if (score == null) return "hsl(220 10% 25%)";
    if (score >= 60) return "hsl(175 84% 45%)";
    if (score >= 45) return "hsl(155 70% 50%)";
    if (score >= 30) return "hsl(30 90% 55%)";
    if (score >= 15) return "hsl(15 85% 55%)";
    return "hsl(220 15% 30%)";
  };

  const styleFor = (feat: any) => {
    const fips = String(feat?.id ?? "").padStart(2, "0");
    const abbr = STATE_FIPS_TO_ABBR[fips];
    const score = abbr ? stateScore[abbr] : undefined;
    return {
      fillColor: colorFor(score),
      color: "hsl(220 15% 45%)",
      weight: 0.6,
      fillOpacity: score != null ? 0.35 : 0.14,
      opacity: 0.7,
    };
  };

  return (
    <GeoJSON
      key={`states-${key}`}
      data={geo}
      style={styleFor as any}
      onEachFeature={(feat: any, layer: any) => {
        const fips = String(feat?.id ?? "").padStart(2, "0");
        const abbr = STATE_FIPS_TO_ABBR[fips];
        const name = feat?.properties?.name ?? abbr ?? "";
        const score = abbr ? stateScore[abbr] : undefined;
        layer.bindTooltip(
          `<div class="gs-map-tooltip"><div class="font-semibold text-xs">${name}</div><div class="text-[10px] font-mono text-muted-foreground">Median score ${score != null ? score.toFixed(0) : "—"}</div></div>`,
          { direction: "center", sticky: true, opacity: 0.95, className: "" }
        );
      }}
    />
  );
}

type DeltaRow = { fips: string; delta: number; score_today: number; score_prior: number };
type DeltaResp = { rows: DeltaRow[]; today: string | null; prior: string | null; days_apart?: number };

type TxFeatureCollection = { type: "FeatureCollection"; features: Array<any> };

function TransmissionLayer({ show }: { show: boolean }) {
  const map = useMap();
  const [data, setData] = useState<TxFeatureCollection | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!show) {
      setData(null);
      return;
    }
    let cancelled = false;
    const fetchLines = async () => {
      // Only load transmission when zoomed enough to keep payloads reasonable
      if (map.getZoom() < 7) {
        setData(null);
        return;
      }
      const b = map.getBounds();
      const bbox = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
      try {
        const res = await apiRequest("GET", `/api/transmission/lines?bbox=${bbox}`);
        const fc = (await res.json()) as TxFeatureCollection;
        if (!cancelled) {
          setData(fc);
          setKey((k) => k + 1);
        }
      } catch (e) {
        // silent — overlay is optional
      }
    };
    fetchLines();
    const onMove = () => fetchLines();
    map.on("moveend", onMove);
    return () => {
      cancelled = true;
      map.off("moveend", onMove);
    };
  }, [show, map]);

  if (!show || !data || data.features.length === 0) return null;
  const styleFor = (feat: any) => {
    const v = feat?.properties?.voltage ?? 0;
    const color = v >= 345 ? "hsl(0 85% 60%)" : v >= 230 ? "hsl(30 90% 55%)" : v >= 115 ? "hsl(50 90% 55%)" : "hsl(200 70% 60%)";
    return { color, weight: v >= 345 ? 1.6 : 1.0, opacity: 0.75 };
  };
  return (
    <GeoJSON
      key={`tx-${key}`}
      data={data as any}
      style={styleFor as any}
    />
  );
}

interface USMapProps {
  counties: County[];
}

export function tierColor(tier: string | null | undefined): string {
  switch (tier) {
    case "hot":
      return "hsl(175 84% 45%)";
    case "warm":
      return "hsl(30 90% 55%)";
    case "emerging":
      return "hsl(220 70% 55%)";
    default:
      return "hsl(220 10% 55%)";
  }
}

function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export function USMap({ counties }: USMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [showStates, setShowStates] = useState(true);
  const [mode, setMode] = useState<"tier" | "delta">("tier");

  const { data: deltaResp } = useQuery<DeltaResp>({
    queryKey: ["/api/counties/score-deltas"],
    enabled: mode === "delta",
  });
  const deltaByFips = new Map<string, DeltaRow>((deltaResp?.rows ?? []).map((r) => [r.fips, r]));

  // Paint low-score markers first so hot/high markers land on top and stay legible
  // in dense, overlapping regions.
  const orderedCounties = useMemo(
    () => [...counties].sort((a, b) => (a.landingProbability ?? 0) - (b.landingProbability ?? 0)),
    [counties],
  );
  const deltaColor = (d: number): string => {
    if (d >= 4) return "hsl(175 84% 45%)";
    if (d >= 2) return "hsl(155 70% 50%)";
    if (d >= 0.5) return "hsl(120 55% 55%)";
    if (d <= -4) return "hsl(0 85% 55%)";
    if (d <= -2) return "hsl(15 85% 55%)";
    if (d <= -0.5) return "hsl(30 70% 55%)";
    return "hsl(220 10% 45%)";
  };

  return (
    <>
      {/* `isolate` traps Leaflet's high z-indexes (controls sit at z-1000) inside
          this element's own stacking context, so the map can't paint over the
          sidebar overlay (z-50) on mobile. */}
      <div className="relative isolate rounded-md overflow-hidden border border-border bg-muted/20" style={{ height: 420 }}>
        <MapContainer
          center={[39.5, -97]}
          zoom={4}
          style={{ height: "100%", width: "100%", background: "hsl(220 30% 12%)" }}
          scrollWheelZoom={false}
          ref={(m) => {
            if (m) mapRef.current = m;
          }}
        >
          <InvalidateOnMount />
          <StatesLayer counties={counties} show={showStates} />
          <TransmissionLayer show={showTx} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
            maxZoom={10}
          />
          {orderedCounties.map((c) => {
            const score = c.landingProbability ?? 0;
            const delta = deltaByFips.get(c.fips)?.delta ?? 0;
            const radius = mode === "delta" ? 3 + Math.min(Math.abs(delta), 8) : 2.5 + (score / 100) * 5.5;
            const color = mode === "delta" ? deltaColor(delta) : tierColor(c.scoreTier);
            const isSelected = selectedFips === c.fips;
            return (
              <CircleMarker
                key={c.fips}
                center={[c.lat, c.lng]}
                radius={isSelected ? radius + 3 : radius}
                pathOptions={{
                  color: isSelected ? "hsl(0 0% 100%)" : color,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.95 : 0.5,
                  weight: isSelected ? 2.5 : 0.6,
                }}
                eventHandlers={{
                  click: () => setSelectedFips(c.fips),
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={1} className="gs-map-tooltip">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-xs">
                      {c.name}, {c.state}
                    </span>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.iso ?? "—"} · Score {score.toFixed(0)} · {c.scoreTier ?? "cold"}
                    </div>
                    {mode === "delta" && deltaByFips.has(c.fips) && (
                      <div className="text-[10px] font-mono" style={{ color: deltaColor(delta) }}>
                        {delta > 0 ? "+" : ""}{delta.toFixed(1)} pts vs {deltaResp?.prior}
                      </div>
                    )}
                    {c.queuedLoadMw ? (
                      <div className="text-[10px] text-muted-foreground">
                        Gen queue {c.queuedLoadMw >= 1000 ? `${(c.queuedLoadMw / 1000).toFixed(1)} GW` : `${c.queuedLoadMw.toFixed(0)} MW`}
                      </div>
                    ) : null}
                    <div className="text-[10px] text-primary mt-0.5">Click to drill in →</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-[400] bg-card/90 backdrop-blur border border-border rounded-md p-2.5 text-[10px] font-mono">
          <div className="text-muted-foreground uppercase tracking-wider mb-1.5">{mode === "delta" ? "Score change" : "Tier"}</div>
          <div className="space-y-1">
            {mode === "delta" ? [
              { key: "up-strong", label: "+4 or more", color: "hsl(175 84% 45%)" },
              { key: "up", label: "+2 to +4", color: "hsl(155 70% 50%)" },
              { key: "flat", label: "±0.5", color: "hsl(220 10% 45%)" },
              { key: "down", label: "-2 to -4", color: "hsl(15 85% 55%)" },
              { key: "down-strong", label: "-4 or worse", color: "hsl(0 85% 55%)" },
            ].map((t) => (
              <div key={t.key} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-foreground">{t.label}</span>
              </div>
            )) : [
              { tier: "hot", label: "Hot ≥75" },
              { tier: "warm", label: "Warm 60-74" },
              { tier: "emerging", label: "Emerging 45-59" },
              { tier: "cold", label: "Cold <45" },
            ].map((t) => (
              <div key={t.tier} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tierColor(t.tier) }}
                />
                <span className="text-foreground">{t.label}</span>
              </div>
            ))}
          </div>
          {mode === "delta" && deltaResp && (
            <div className="mt-1.5 pt-1.5 border-t border-border/50 text-[9px] text-muted-foreground">
              {deltaResp.prior} → {deltaResp.today}
            </div>
          )}
        </div>

        {/* Hint pill + transmission toggle */}
        <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 items-end">
          <div className="bg-card/90 backdrop-blur border border-border rounded-md p-0.5 flex text-[10px] font-mono">
            <button
              data-testid="button-map-mode-tier"
              onClick={() => setMode("tier")}
              className={`px-2 py-1 rounded ${mode === "tier" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >Tier</button>
            <button
              data-testid="button-map-mode-delta"
              onClick={() => setMode("delta")}
              className={`px-2 py-1 rounded ${mode === "delta" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >Δ Score</button>
          </div>
          <button
            data-testid="button-toggle-states"
            onClick={() => setShowStates((v) => !v)}
            className={`bg-card/90 backdrop-blur border rounded-md px-2.5 py-1 text-[10px] font-mono transition-colors inline-flex items-center gap-1.5 ${
              showStates ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="h-3 w-3" />
            {showStates ? "State Choropleth ON" : "Show State Choropleth"}
          </button>
          <button
            data-testid="button-toggle-transmission"
            onClick={() => setShowTx((v) => !v)}
            className={`bg-card/90 backdrop-blur border rounded-md px-2.5 py-1 text-[10px] font-mono transition-colors inline-flex items-center gap-1.5 ${
              showTx ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="h-3 w-3" />
            {showTx ? "Transmission ON (zoom ≥7)" : "Show Transmission"}
          </button>
          {showTx ? (
            <div className="bg-card/90 backdrop-blur border border-border rounded-md p-2 text-[9px] font-mono space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Voltage (kV)</div>
              <div className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{background:"hsl(0 85% 60%)"}} /><span>≥345</span></div>
              <div className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{background:"hsl(30 90% 55%)"}} /><span>230-344</span></div>
              <div className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{background:"hsl(50 90% 55%)"}} /><span>115-229</span></div>
              <div className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{background:"hsl(200 70% 60%)"}} /><span>&lt;115</span></div>
            </div>
          ) : null}
        </div>
      </div>

      <CountyDrillPanel
        fips={selectedFips}
        onClose={() => setSelectedFips(null)}
      />
    </>
  );
}
