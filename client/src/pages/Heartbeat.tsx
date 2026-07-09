import { useQuery } from "@tanstack/react-query";
import { HeartPulse, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Pipe {
  pipeline: string;
  last_started: string;
  status: string;
  age_hours: number;
  stale: boolean;
}
interface Heartbeat {
  pipelines: Pipe[];
  stale_count: number;
  failing_count: number;
  checked_at: string;
}

export default function Heartbeat({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading } = useQuery<Heartbeat>({
    queryKey: ["/api/cron/heartbeat"],
    refetchInterval: 60_000,
  });

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto"}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-primary" />
          Cron heartbeat
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Freshness monitor for every data pipeline. A pipeline is flagged
          stale after 8 days without a successful run. Also polls the daily
          GridSense cron.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pipelines tracked" value={data?.pipelines.length ?? "—"} tone="neutral" />
        <StatCard label="Stale (>8 days)" value={data?.stale_count ?? "—"} tone={data?.stale_count ? "warn" : "ok"} />
        <StatCard label="Currently failing" value={data?.failing_count ?? "—"} tone={data?.failing_count ? "err" : "ok"} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pipeline freshness</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Age (hours)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.pipelines.map((p) => (
                  <TableRow key={p.pipeline} data-testid={`row-pipe-${p.pipeline}`}>
                    <TableCell className="font-mono text-xs">{p.pipeline}</TableCell>
                    <TableCell className="text-xs font-mono">{new Date(p.last_started).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-mono">{p.age_hours.toFixed(1)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "ok" ? "outline" : p.status === "error" ? "destructive" : "secondary"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.stale ? (
                        <span className="inline-flex items-center gap-1 text-orange-600">
                          <AlertTriangle className="h-3 w-3" /> stale
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> fresh
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: "ok" | "warn" | "err" | "neutral" }) {
  const color =
    tone === "ok"
      ? "text-green-600"
      : tone === "warn"
      ? "text-orange-600"
      : tone === "err"
      ? "text-red-600"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
