import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Database, Activity, Users, Server, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

type AdminStats = {
  db_size_mb: number;
  tables: Array<{ name: string; row_count: number }>;
  pipelines: Array<{ pipeline: string; status: string; last_started_iso: string | null; age_hours: number; stale: boolean }>;
  ingest_runs_last_24h: number;
  users_total: number;
  operators_total: number;
  counties_by_tier: Record<string, number>;
  api_rate_buckets: number;
  uptime_seconds: number;
};

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Admin() {
  const { data, isLoading } = useQuery<AdminStats>({ queryKey: ["/api/admin/stats"] });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-32 w-full max-w-3xl" />
        <Skeleton className="h-64 w-full max-w-6xl" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto" data-testid="page-admin">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" /> Admin
        </h1>
        <p className="text-sm text-muted-foreground">
          System-level view of GridSense: database size, ingest health, active users, and API rate-limit buckets.
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Database className="h-3 w-3" />Database</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-db-size">{data.db_size_mb.toFixed(1)} MB</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Users className="h-3 w-3" />Users</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-users">{data.users_total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Server className="h-3 w-3" />Operators</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-operators">{data.operators_total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Activity className="h-3 w-3" />Ingest 24h</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-ingest-24h">{data.ingest_runs_last_24h}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Clock className="h-3 w-3" />Uptime</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-uptime">{formatUptime(data.uptime_seconds)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Shield className="h-3 w-3" />Rate buckets</div>
          <div className="text-lg font-semibold tabular-nums mt-1" data-testid="stat-rate-buckets">{data.api_rate_buckets}</div>
        </CardContent></Card>
      </div>

      {/* Counties by tier */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Counties by Tier</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            {Object.entries(data.counties_by_tier).map(([tier, count]) => (
              <div key={tier} className="rounded-md border border-border bg-card px-3 py-2 flex items-baseline gap-2" data-testid={`tier-count-${tier}`}>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{tier}</span>
                <span className="text-sm font-semibold tabular-nums">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Ingest pipelines */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Ingest Pipelines ({data.pipelines.length})</span>
            <Link href="/ingestion" className="text-xs text-primary hover:underline">See full runs →</Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Age (h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pipelines.map((p) => (
                <TableRow key={p.pipeline} data-testid={`admin-pipeline-${p.pipeline}`}>
                  <TableCell className="font-mono text-xs">{p.pipeline}</TableCell>
                  <TableCell>
                    {p.status === "error"
                      ? <Badge variant="destructive" className="text-[9px]"><AlertTriangle className="h-2.5 w-2.5 mr-1" />{p.status}</Badge>
                      : p.stale
                        ? <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[9px]">stale</Badge>
                        : <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 text-[9px]"><CheckCircle2 className="h-2.5 w-2.5 mr-1" />{p.status}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.last_started_iso)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.age_hours.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Tables */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Tables ({data.tables.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tables.map((t) => (
                <TableRow key={t.name} data-testid={`admin-table-${t.name}`}>
                  <TableCell className="font-mono text-xs">{t.name}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{t.row_count.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
