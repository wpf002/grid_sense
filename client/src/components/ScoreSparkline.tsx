import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, YAxis, XAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ScoreHistoryRow } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

function formatMonth(m: string): string {
  // "YYYY-MM" → "MMM 'YY"
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function ScoreSparkline({
  fips,
  currentScore,
  height = 120,
}: {
  fips: string;
  currentScore: number;
  height?: number;
}) {
  const { data: history, isLoading } = useQuery<ScoreHistoryRow[]>({
    queryKey: ["/api/counties", fips, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/counties/${fips}/history`);
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: !!fips,
  });

  const chartData = useMemo(() => {
    if (!history) return [];
    return history.map((h) => ({
      month: h.month,
      label: formatMonth(h.month),
      score: Number(h.score.toFixed(1)),
    }));
  }, [history]);

  const stats = useMemo(() => {
    if (chartData.length < 2) return null;
    const start = chartData[0].score;
    const end = chartData[chartData.length - 1].score;
    const delta = end - start;
    const trend: "up" | "down" | "flat" = delta > 2 ? "up" : delta < -2 ? "down" : "flat";
    return { start, end, delta, trend };
  }, [chartData]);

  if (isLoading) {
    return <Skeleton className="w-full" style={{ height }} />;
  }

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground border border-border rounded-md"
        style={{ height }}
      >
        No history available
      </div>
    );
  }

  const TrendIcon =
    stats?.trend === "up" ? TrendingUp : stats?.trend === "down" ? TrendingDown : Minus;
  const trendColor =
    stats?.trend === "up"
      ? "text-primary"
      : stats?.trend === "down"
      ? "text-orange-500"
      : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          12-month trajectory · {chartData[0].label} → {chartData[chartData.length - 1].label}
        </div>
        {stats && (
          <div className={`inline-flex items-center gap-1 text-xs font-mono ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            <span className="tabular-nums">
              {stats.delta >= 0 ? "+" : ""}
              {stats.delta.toFixed(1)} pts
            </span>
          </div>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
            <defs>
              <linearGradient id={`spark-${fips}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(175 84% 45%)" stopOpacity={0.9} />
                <stop offset="100%" stopColor="hsl(175 84% 45%)" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
              tickLine={false}
              interval={1}
            />
            <YAxis
              domain={[
                (dmin: number) => Math.max(0, Math.floor(dmin - 5)),
                (dmax: number) => Math.min(100, Math.ceil(dmax + 5)),
              ]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(v: number) => [v.toFixed(1), "Score"]}
            />
            <ReferenceLine
              y={75}
              stroke="hsl(175 84% 45%)"
              strokeDasharray="2 3"
              strokeOpacity={0.35}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="hsl(175 84% 45%)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "hsl(175 84% 45%)", strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
