import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { GitCompare, Plus, X, ArrowLeft } from "lucide-react";
import type { County, CountyDetail as CountyDetailType } from "@shared/schema";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// Distinct colors per compared county (up to 4)
const SERIES_COLORS = [
  "hsl(175 84% 45%)", // teal
  "hsl(30 90% 55%)",  // orange
  "hsl(220 70% 60%)", // blue
  "hsl(280 70% 60%)", // purple
];

function formatMw(mw?: number | null): string {
  if (mw == null || mw === 0) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${mw.toFixed(0)} MW`;
}

function parseFipsFromQuery(search: string): string[] {
  const params = new URLSearchParams(search);
  const raw = params.get("fips") ?? "";
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

export default function Compare() {
  const search = useSearch();
  const initialFips = useMemo(() => parseFipsFromQuery(search), [search]);
  const [selected, setSelected] = useState<string[]>(initialFips);

  const { data: allCounties, isLoading: loadingList } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  // Fetch detail for each selected FIPS. useQueries keeps the hook count stable
  // across renders regardless of how many counties are selected.
  const detailQueries = useQueries({
    queries: selected.map((fips) => ({
      queryKey: ["/api/counties", fips] as const,
      enabled: !!fips,
    })),
  }) as ReturnType<typeof useQuery<CountyDetailType>>[];

  const details = detailQueries
    .map((q) => q.data)
    .filter((d): d is CountyDetailType => !!d);

  const availableForAdd = useMemo(() => {
    if (!allCounties) return [];
    return allCounties.filter((c) => !selected.includes(c.fips));
  }, [allCounties, selected]);

  const addCounty = (fips: string) => {
    if (selected.length >= 4 || !fips) return;
    setSelected((prev) => [...prev, fips]);
  };

  const removeCounty = (fips: string) => {
    setSelected((prev) => prev.filter((f) => f !== fips));
  };

  // Chart data: one row per factor, one bar series per selected county
  const factorChartData = useMemo(() => {
    if (details.length === 0) return [];
    const firstFactors = details[0].factors;
    return firstFactors.map((f) => {
      const row: Record<string, string | number> = { label: f.label };
      details.forEach((d, idx) => {
        const found = d.factors.find((x) => x.key === f.key);
        row[`county${idx}`] = found ? Number(found.value.toFixed(1)) : 0;
      });
      return row;
    });
  }, [details]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-2">
        <Link
          href="/counties"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit"
          data-testid="link-back-compare"
        >
          <ArrowLeft className="h-3 w-3" /> All Counties
        </Link>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md border border-border bg-card flex items-center justify-center">
            <GitCompare className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-compare-title">
              County Comparison
            </h1>
            <p className="text-xs text-muted-foreground">
              Side-by-side factor breakdown for up to four counties.
            </p>
          </div>
        </div>
      </div>

      {/* County picker chips */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Selected Counties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No counties selected yet. Add up to four to compare.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {selected.map((fips, idx) => {
                const detail = details.find((d) => d.fips === fips);
                const listRow = allCounties?.find((c) => c.fips === fips);
                const displayName = detail
                  ? `${detail.name}, ${detail.state}`
                  : listRow
                  ? `${listRow.name}, ${listRow.state}`
                  : fips;
                return (
                  <div
                    key={fips}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1 py-1"
                    data-testid={`chip-county-${fips}`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: SERIES_COLORS[idx] }}
                    />
                    <span className="text-xs font-medium">{displayName}</span>
                    <button
                      onClick={() => removeCounty(fips)}
                      className="p-0.5 rounded hover:bg-muted"
                      data-testid={`button-remove-${fips}`}
                      aria-label={`Remove ${displayName}`}
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {selected.length < 4 && (
            <div className="flex items-center gap-2 pt-1">
              <Select value="" onValueChange={addCounty}>
                <SelectTrigger className="w-[280px]" data-testid="select-add-county">
                  <SelectValue
                    placeholder={
                      loadingList
                        ? "Loading counties..."
                        : `Add a county (${selected.length}/4)`
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {availableForAdd.map((c) => (
                    <SelectItem key={c.fips} value={c.fips}>
                      <span className="font-mono text-[10px] text-muted-foreground mr-2">
                        {(c.landingProbability ?? 0).toFixed(0)}
                      </span>
                      {c.name}, {c.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">
                <Plus className="h-3 w-3 inline mr-0.5" /> pick from {availableForAdd.length} tracked counties
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {selected.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <GitCompare className="h-8 w-8 mx-auto text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              Select two or more counties above to see them side by side.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Snapshot stat rows */}
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.max(selected.length, 1)}, minmax(0, 1fr))`,
            }}
          >
            {selected.map((fips, idx) => {
              const d = details.find((x) => x.fips === fips);
              const q = detailQueries[idx];
              if (q?.isLoading || !d) {
                return <Skeleton key={fips} className="h-56" />;
              }
              return (
                <Card key={fips} className="relative overflow-hidden">
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: SERIES_COLORS[idx] }}
                  />
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-semibold">
                          <Link
                            href={`/counties/${d.fips}`}
                            className="hover:text-primary transition-colors"
                            data-testid={`link-detail-${d.fips}`}
                          >
                            {d.name}, {d.state}
                          </Link>
                        </CardTitle>
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          {d.iso ?? "—"} · FIPS {d.fips}
                        </div>
                      </div>
                      <ScoreBadge
                        score={d.landingProbability ?? 0}
                        tier={d.scoreTier ?? undefined}
                        size="sm"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <StatRow label="Queued generation" value={formatMw(d.queuedLoadMw)} />
                    <StatRow
                      label="Time-to-power"
                      value={d.timeToPowerMonths ? `${d.timeToPowerMonths.toFixed(0)} mo` : "—"}
                    />
                    <StatRow
                      label="Fiber density"
                      value={`${(d.fiberDensityScore ?? 0).toFixed(0)}/100`}
                    />
                    <StatRow label="Large parcels" value={String(d.largeParcelCount ?? 0)} />
                    <StatRow
                      label="Median $/acre"
                      value={
                        d.medianLandPricePerAcre
                          ? `$${(d.medianLandPricePerAcre / 1000).toFixed(0)}k`
                          : "—"
                      }
                    />
                    <StatRow label="Signals" value={String(d.signals.length)} />
                    <StatRow label="Existing DCs" value={String(d.existingDcCount ?? 0)} />
                    {d.moratoriumStatus && d.moratoriumStatus !== "none" && (
                      <Badge
                        variant="outline"
                        className="mt-2 text-[10px] uppercase border-orange-500/40 text-orange-500"
                      >
                        Moratorium {d.moratoriumStatus}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Factor comparison chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Factor Scores Side by Side</CardTitle>
              <p className="text-xs text-muted-foreground">
                {selected.length === 1
                  ? "Snapshot of every factor for this county. Add another to compare against a peer."
                  : "Each factor scored 0-100. Weights are equal across counties, so tall bars mean a stronger raw signal."}
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[420px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={factorChartData}
                    layout="vertical"
                    margin={{ left: 8, right: 32, top: 8, bottom: 8 }}
                    barCategoryGap="20%"
                  >
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      dataKey="label"
                      type="category"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      width={130}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    {selected.map((fips, idx) => {
                      const d = details.find((x) => x.fips === fips);
                      const label = d ? `${d.name}, ${d.state}` : fips;
                      return (
                        <Bar
                          key={fips}
                          dataKey={`county${idx}`}
                          name={label}
                          fill={SERIES_COLORS[idx]}
                          radius={[0, 3, 3, 0]}
                        />
                      );
                    })}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  );
}
