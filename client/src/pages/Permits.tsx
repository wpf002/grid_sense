import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileCheck2, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Permit = {
  id: number;
  county_fips: string;
  county_name: string;
  state: string;
  county_score: number;
  permit_type: string;
  applicant: string;
  resolved_operator: string | null;
  parcel_apn: string | null;
  filed_date: string;
  status: string;
  megawatts: number | null;
  acres: number | null;
  description: string;
  source_url: string | null;
};

const TYPE_STYLE: Record<string, string> = {
  rezoning: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  building: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  electrical: "bg-primary/20 text-primary",
  water: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400",
};
const STATUS_STYLE: Record<string, string> = {
  filed: "bg-muted text-muted-foreground",
  under_review: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  approved: "bg-green-500/20 text-green-700 dark:text-green-400",
  denied: "bg-red-500/20 text-red-700 dark:text-red-400",
  appealed: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
};

export default function Permits({ embedded = false }: { embedded?: boolean } = {}) {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [operatorOnly, setOperatorOnly] = useState(false);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<Permit[]>({
    queryKey: ["/api/permits/recent", 200],
    queryFn: async () => {
      const r = await fetch("/api/permits/recent?limit=200");
      return r.json();
    },
  });

  const rows = useMemo(() => {
    const q2 = q.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (type !== "all" && r.permit_type !== type) return false;
      if (status !== "all" && r.status !== status) return false;
      if (operatorOnly && !r.resolved_operator) return false;
      if (q2 && !`${r.county_name} ${r.state} ${r.applicant} ${r.description} ${r.resolved_operator ?? ""}`.toLowerCase().includes(q2)) return false;
      return true;
    });
  }, [data, type, status, operatorOnly, q]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const r of data ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return byStatus;
  }, [data]);

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto"}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" /> Permit tracker
          </h1>
          <p className="text-sm text-muted-foreground">
            Rezoning, building, electrical, and water permits filed at county planning offices. Cross-referenced against known shell LLCs and operators.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(rows, "gridsense_permits", [
            { key: "filed_date", label: "Filed" },
            { key: "county_name", label: "County" },
            { key: "state", label: "State" },
            { key: "permit_type", label: "Type" },
            { key: "applicant", label: "Applicant" },
            { key: "resolved_operator", label: "Operator" },
            { key: "megawatts", label: "MW" },
            { key: "acres", label: "Acres" },
            { key: "status", label: "Status" },
            { key: "description", label: "Description" },
            { key: "source_url", label: "Source" },
          ])}
          data-testid="button-export-permits"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["filed", "under_review", "approved", "denied", "appealed"] as const).map((s) => (
          <Card key={s}>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground capitalize">{s.replace("_", " ")}</div>
              <div className="text-2xl font-semibold">{counts[s] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[240px]">
              <Input placeholder="Search county, applicant, description" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-permits-search" />
            </div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[160px]" data-testid="select-permit-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="rezoning">Rezoning</SelectItem>
                <SelectItem value="building">Building</SelectItem>
                <SelectItem value="electrical">Electrical</SelectItem>
                <SelectItem value="water">Water</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[160px]" data-testid="select-permit-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="filed">Filed</SelectItem>
                <SelectItem value="under_review">Under review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
                <SelectItem value="appealed">Appealed</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={operatorOnly} onChange={(e) => setOperatorOnly(e.target.checked)} data-testid="checkbox-operator-only" />
              Operator-matched only
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent permits</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-96 w-full" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filed</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Src</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground" data-testid="empty-permits">
                        No permits match your filters. Try clearing the status filter or widening the date range.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-permit-${r.id}`}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{r.filed_date}</TableCell>
                      <TableCell>
                        <Link href={`/counties/${r.county_fips}`}>
                          <button className="text-primary hover:underline text-left text-sm">{r.county_name}, {r.state}</button>
                        </Link>
                      </TableCell>
                      <TableCell><Badge className={`text-[10px] uppercase ${TYPE_STYLE[r.permit_type] ?? ""}`}>{r.permit_type}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[240px] truncate" title={r.applicant}>{r.applicant}</TableCell>
                      <TableCell>{r.resolved_operator ?? <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap font-mono">
                        {r.megawatts ? `${r.megawatts} MW` : r.acres ? `${r.acres.toFixed(0)} ac` : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[380px] truncate" title={r.description}>{r.description}</TableCell>
                      <TableCell><Badge className={`text-[10px] uppercase ${STATUS_STYLE[r.status] ?? ""}`}>{r.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell>
                        {r.source_url ? (
                          <a href={r.source_url} target="_blank" rel="noreferrer" className="text-primary" data-testid={`link-permit-source-${r.id}`}>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
