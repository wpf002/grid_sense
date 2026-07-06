import { useState, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { FolderUp, Upload, FileText, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Result {
  input_line: number;
  label?: string;
  fips: string;
  name: string;
  state: string;
  score: number | null;
  tier: string | null;
  queued_load_mw: number | null;
  time_to_power_months: number | null;
  hazard_score: number | null;
  water_stress_score: number | null;
  moratorium_status: string | null;
  iso: string | null;
  utility: string | null;
}

interface Response {
  results: Result[];
  not_found: { input_line: number; raw: string }[];
  summary: {
    rows_scored: number;
    rows_unmatched: number;
    hot: number;
    warm: number;
    emerging: number;
    cold: number;
    avg_score: number;
    top_iso: { iso: string; n: number }[];
  };
}

const EXAMPLE = `fips,label
48201,Houston site A
17197,Will County parcel
51107,Loudoun VA - Sterling
06037,LA option
36061,NYC infill`;

export default function Portfolio() {
  const [csv, setCsv] = useState<string>("");
  const [resp, setResp] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Preview the header row + count so users see column mapping before scoring.
  const parsedPreview = ((): { headers: string[]; rows: number; firstRow: string } | null => {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const headers = lines[0].split(",").map((h) => h.trim());
    if (headers.length === 0) return null;
    return {
      headers,
      rows: Math.max(0, lines.length - 1),
      firstRow: lines[1] ?? "",
    };
  })();
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsv(text);
  };

  const handleScore = async () => {
    if (!csv.trim()) {
      toast({ title: "Paste or upload a CSV first", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/portfolio/score", { csv });
      const data = (await res.json()) as Response;
      setResp(data);
    } catch (e: any) {
      toast({ title: "Scoring failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const downloadResults = () => {
    if (!resp) return;
    const header = "line,label,fips,county,state,score,tier,queued_mw,time_to_power_months,hazard,water_stress,moratorium,iso,utility";
    const rows = resp.results.map((r) => [
      r.input_line,
      r.label ?? "",
      r.fips,
      r.name,
      r.state,
      r.score ?? "",
      r.tier ?? "",
      r.queued_load_mw ?? "",
      r.time_to_power_months ?? "",
      r.hazard_score ?? "",
      r.water_stress_score ?? "",
      r.moratorium_status ?? "",
      r.iso ?? "",
      r.utility ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gridsense-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">
          <FolderUp className="h-5 w-5 text-primary" />
          Portfolio scoring
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paste or upload a CSV of parcels, sites, or counties. GridSense scores each one against the 626-county model and returns the tier, queued load, time-to-power, and hazard profile. Accepts either a <code className="text-xs bg-muted px-1 rounded">fips</code> column (5-digit county FIPS) or <code className="text-xs bg-muted px-1 rounded">lat,lng</code> columns (nearest-county fallback). Optional <code className="text-xs bg-muted px-1 rounded">label</code> column preserves your row names.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCsv(EXAMPLE)} data-testid="button-load-example">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Load example
            </Button>
            <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md cursor-pointer hover:bg-accent" data-testid="label-upload-csv">
              <Upload className="h-3.5 w-3.5" />
              Upload CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                data-testid="input-file-csv"
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => { setCsv(""); setResp(null); }} data-testid="button-clear">
              Clear
            </Button>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={`relative border-2 border-dashed rounded-md p-1 transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="dropzone-csv"
          >
            {dragActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-md pointer-events-none z-10">
                <div className="text-xs font-medium text-primary flex items-center gap-2">
                  <Upload className="h-4 w-4" /> Drop CSV to score
                </div>
              </div>
            )}
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="Drag a .csv file here or paste rows:&#10;fips,label&#10;48201,Houston site A&#10;51107,Loudoun VA&#10;..."
              className="font-mono text-xs min-h-[160px] border-0 focus-visible:ring-0"
              data-testid="textarea-csv"
            />
          </div>
          {parsedPreview && (
            <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detected columns</div>
              <div className="flex flex-wrap gap-1.5 font-mono">
                {parsedPreview.headers.map((h) => (
                  <span key={h} className={`px-1.5 py-0.5 rounded ${
                    ["fips","lat","lng","label"].includes(h.toLowerCase()) ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  }`}>{h}</span>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1.5">{parsedPreview.rows} row{parsedPreview.rows === 1 ? "" : "s"} · first row: <span className="font-mono">{parsedPreview.firstRow || "—"}</span></div>
            </div>
          )}
          <div className="flex justify-between items-center">
            <div className="text-xs text-muted-foreground">
              {csv.split(/\r?\n/).filter((l) => l.trim()).length} lines · Max 5,000 rows
            </div>
            <Button onClick={handleScore} disabled={loading || !csv.trim()} data-testid="button-score-portfolio">
              {loading ? "Scoring…" : "Score portfolio"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {resp && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card data-testid="tile-portfolio-scored">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Scored</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold">{resp.summary.rows_scored}</div></CardContent>
            </Card>
            <Card data-testid="tile-portfolio-hot">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Hot (≥80)</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold text-primary">{resp.summary.hot}</div></CardContent>
            </Card>
            <Card data-testid="tile-portfolio-warm">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Warm (60-80)</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold">{resp.summary.warm}</div></CardContent>
            </Card>
            <Card data-testid="tile-portfolio-emerging">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Emerging</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold">{resp.summary.emerging}</div></CardContent>
            </Card>
            <Card data-testid="tile-portfolio-cold">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Cold (&lt;40)</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold text-muted-foreground">{resp.summary.cold}</div></CardContent>
            </Card>
            <Card data-testid="tile-portfolio-avg">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Avg score</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-semibold">{resp.summary.avg_score.toFixed(1)}</div></CardContent>
            </Card>
          </div>

          {resp.summary.top_iso.length > 0 && (
            <div className="text-xs text-muted-foreground">
              ISO mix: {resp.summary.top_iso.map((t) => `${t.iso} (${t.n})`).join(" · ")}
            </div>
          )}

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Scored parcels ({resp.results.length})</CardTitle>
              <Button size="sm" variant="outline" onClick={downloadResults} data-testid="button-download-csv">
                Download CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Line</TableHead>
                    <TableHead className="text-xs">Label</TableHead>
                    <TableHead className="text-xs">County</TableHead>
                    <TableHead className="text-xs">Score</TableHead>
                    <TableHead className="text-xs">Queued MW</TableHead>
                    <TableHead className="text-xs">TTP (mo)</TableHead>
                    <TableHead className="text-xs">ISO</TableHead>
                    <TableHead className="text-xs">Moratorium</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resp.results.map((r) => (
                    <TableRow key={`${r.input_line}-${r.fips}`} data-testid={`row-portfolio-${r.input_line}`}>
                      <TableCell className="text-xs font-mono py-2 text-muted-foreground">{r.input_line}</TableCell>
                      <TableCell className="text-xs py-2">{r.label ?? "—"}</TableCell>
                      <TableCell className="text-xs py-2">
                        <Link href={`/counties/${r.fips}`} className="text-primary hover:underline">
                          {r.name}, {r.state}
                        </Link>
                      </TableCell>
                      <TableCell className="py-2">
                        {r.score != null ? <ScoreBadge score={r.score} /> : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono py-2">{r.queued_load_mw ? Math.round(r.queued_load_mw).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs font-mono py-2">{r.time_to_power_months != null ? r.time_to_power_months.toFixed(0) : "—"}</TableCell>
                      <TableCell className="text-xs py-2">{r.iso ?? "—"}</TableCell>
                      <TableCell className="text-xs py-2">
                        {r.moratorium_status && r.moratorium_status !== "none" ? (
                          <Badge variant="destructive" className="text-[10px]">{r.moratorium_status}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {resp.not_found.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm inline-flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Unmatched rows ({resp.not_found.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  These rows didn't match any county in the 626-county universe. Check the FIPS code (should be 5 digits, zero-padded) or add lat/lng columns for a nearest-neighbor fallback.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Line</TableHead>
                      <TableHead className="text-xs">Raw input</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resp.not_found.slice(0, 50).map((n) => (
                      <TableRow key={n.input_line}>
                        <TableCell className="text-xs font-mono py-2 text-muted-foreground">{n.input_line}</TableCell>
                        <TableCell className="text-xs font-mono py-2">{n.raw}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Privacy:</strong> Data stays in-session — nothing is stored server-side. Refresh the page to clear.</p>
        <p><strong>Formats accepted:</strong> comma, semicolon, tab, or pipe-separated. Header row optional (auto-detected).</p>
      </div>
    </div>
  );
}
