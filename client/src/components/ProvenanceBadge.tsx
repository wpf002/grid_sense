import { useQuery } from "@tanstack/react-query";
import { Info, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface Prov {
  factor_key: string;
  quality: "verified" | "estimated" | "stale" | string;
  source_name: string;
  source_url: string | null;
  fetched_at: string;
  note: string | null;
}

function qualityIcon(q: string) {
  if (q === "verified") return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
  if (q === "estimated") return <Sparkles className="h-3 w-3 text-amber-500" />;
  return <AlertCircle className="h-3 w-3 text-muted-foreground" />;
}

export function ProvenanceBadge({ fips }: { fips: string }) {
  const { data } = useQuery<Prov[]>({
    queryKey: [`/api/counties/${fips}/provenance`],
  });

  const rows = data ?? [];
  const estimatedCount = rows.filter((r) => r.quality === "estimated").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md px-2 py-1 border border-border hover-elevate"
          data-testid="button-provenance"
        >
          <Info className="h-3.5 w-3.5" />
          Data sources
          {estimatedCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-500/40 text-amber-500">
              {estimatedCount} est.
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0 max-h-[420px] overflow-y-auto" align="end">
        <div className="p-3 border-b border-border sticky top-0 bg-popover">
          <div className="text-xs font-semibold uppercase tracking-wider">
            Provenance for {rows.length} factors
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Every scoring input has a traceable source. Estimated values are flagged.
          </div>
        </div>
        {rows.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">
            No provenance records for this county yet.
          </div>
        )}
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.factor_key} className="p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-foreground truncate">
                  {r.factor_key}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  {qualityIcon(r.quality)}
                  {r.quality}
                </span>
              </div>
              <div className="text-muted-foreground">
                {r.source_url ? (
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {r.source_name} ↗
                  </a>
                ) : (
                  <span>{r.source_name}</span>
                )}
              </div>
              {r.note && <div className="text-[10px] text-muted-foreground">{r.note}</div>}
              <div className="text-[10px] text-muted-foreground/70 font-mono">
                fetched {r.fetched_at?.slice(0, 10)}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
