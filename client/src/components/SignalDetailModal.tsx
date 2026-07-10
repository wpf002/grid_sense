import { ExternalLink, MapPin, Building2, FileText, Calendar, Gauge, Weight, Clock, Radio } from "lucide-react";
import type { Signal } from "@shared/schema";
import { formatDay } from "@/lib/dates";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

// Same lookup table as the scoring engine for narration. Kept in sync.
const SIGNAL_TYPE_META: Record<string, { label: string; description: string; typicalLeadMonths: [number, number] }> = {
  llc_land_purchase: {
    label: "LLC land purchase",
    description: "A shell LLC (often masking a hyperscaler) closes on a large tract. Highest-confidence early signal — precedes rezoning by 3-12 months.",
    typicalLeadMonths: [6, 18],
  },
  rezoning: {
    label: "Rezoning application",
    description: "Formal application to rezone parcel(s) for data-center use. Public docket entry.",
    typicalLeadMonths: [3, 9],
  },
  substation_filing: {
    label: "Substation / interconnection filing",
    description: "Utility filing for a new substation or major upgrade adjacent to the parcel. Confirms grid intent.",
    typicalLeadMonths: [12, 30],
  },
  water_permit: {
    label: "Water withdrawal permit",
    description: "State/county permit for cooling water. Strong tell for liquid-cooled AI campuses.",
    typicalLeadMonths: [4, 12],
  },
  interconnection_request: {
    label: "Interconnection queue request",
    description: "ISO queue entry for large load service (>100 MW). PJM, MISO, ERCOT publish these publicly.",
    typicalLeadMonths: [18, 48],
  },
  building_permit: {
    label: "Building permit",
    description: "Formal permit issued. Latest-stage signal — construction imminent.",
    typicalLeadMonths: [0, 6],
  },
  incentive_deal: {
    label: "Incentive deal announced",
    description: "Local/state economic development agreement (tax abatement, sales-tax exemption). Often first public confirmation of project.",
    typicalLeadMonths: [3, 12],
  },
  codename_resolved: {
    label: "Codename resolved to operator",
    description: "Investigative reporting or filings link a shell LLC / project codename to a specific hyperscaler.",
    typicalLeadMonths: [-6, 6],
  },
};

// detectedAt is a date-only string; formatDay keeps it on its own calendar day.
const formatDate = (iso: string) => formatDay(iso, { month: "long", day: "numeric", year: "numeric" });

interface SignalDetailModalProps {
  signal: Signal | null;
  countyName?: string;
  onClose: () => void;
}

export function SignalDetailModal({ signal, countyName, onClose }: SignalDetailModalProps) {
  if (!signal) return null;
  const meta = SIGNAL_TYPE_META[signal.signalType] ?? { label: signal.signalType, description: "Custom signal type.", typicalLeadMonths: [0, 12] };
  const conf = signal.confidence ?? 0.5;
  const confPct = Math.round(conf * 100);
  const confColor = conf >= 0.8 ? "text-emerald-500" : conf >= 0.6 ? "text-primary" : conf >= 0.4 ? "text-yellow-500" : "text-muted-foreground";

  return (
    <Dialog open={!!signal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid={`modal-signal-${signal.id}`}>
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
              <Radio className="h-3 w-3 mr-1" />
              {meta.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">
              <MapPin className="h-3 w-3 mr-1" />
              {signal.countyFips}{countyName ? ` · ${countyName}` : ""}
            </Badge>
            <Badge variant="outline" className={`text-[10px] font-mono ${confColor}`}>
              <Gauge className="h-3 w-3 mr-1" />
              Confidence {confPct}%
            </Badge>
          </div>
          <DialogTitle className="text-base leading-snug" data-testid={`text-signal-headline-${signal.id}`}>
            {signal.headline}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {signal.detail && (
            <p className="text-sm leading-relaxed text-muted-foreground" data-testid={`text-signal-detail-${signal.id}`}>
              {signal.detail}
            </p>
          )}

          {/* Fact grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <FactRow icon={Calendar} label="Detected" value={formatDate(signal.detectedAt)} />
            {signal.leadTimeMonths != null && (
              <FactRow icon={Clock} label="Lead time" value={`${signal.leadTimeMonths.toFixed(0)} months`} />
            )}
            {signal.weight != null && (
              <FactRow icon={Weight} label="Model weight" value={signal.weight.toFixed(2)} />
            )}
            {signal.suspectedOperator && signal.suspectedOperator !== "unknown" && (
              <FactRow icon={Building2} label="Suspected operator" value={signal.suspectedOperator} highlight />
            )}
            {signal.shellLlc && (
              <FactRow icon={FileText} label="Shell LLC" value={signal.shellLlc} mono />
            )}
            {signal.parcelAcres != null && (
              <FactRow icon={MapPin} label="Parcel size" value={`${signal.parcelAcres.toLocaleString()} acres`} />
            )}
          </div>

          {/* Signal-type explainer */}
          <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">About this signal type</div>
            <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
            <p className="text-[11px] text-muted-foreground/80">
              Typical lead time: <span className="text-foreground font-mono">
                {meta.typicalLeadMonths[0]}–{meta.typicalLeadMonths[1]} months
              </span> before groundbreaking
            </p>
          </div>

          {/* Source citation */}
          <div className="rounded-md border border-border/50 bg-card p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source citation</div>
            {signal.sourceUrl ? (
              <a
                href={signal.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-xs text-primary hover:underline group"
                data-testid={`link-signal-source-${signal.id}`}
              >
                <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground group-hover:text-primary">
                    {signal.sourceName ?? "External source"}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate font-mono">{signal.sourceUrl}</div>
                </div>
              </a>
            ) : (
              <div className="text-xs text-muted-foreground italic">No source URL on record.</div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <Link href={`/counties/${signal.countyFips}`}>
              <a
                className="text-xs text-primary hover:underline"
                onClick={onClose}
                data-testid={`link-signal-open-county-${signal.id}`}
              >
                Open county profile →
              </a>
            </Link>
            <span className="text-[10px] text-muted-foreground font-mono">signal #{signal.id}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FactRow({
  icon: Icon,
  label,
  value,
  mono = false,
  highlight = false,
}: {
  icon: any;
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-xs ${mono ? "font-mono" : ""} ${highlight ? "text-primary font-medium" : "text-foreground"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
