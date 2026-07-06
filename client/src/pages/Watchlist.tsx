import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Star, Trash2, Save, Pencil } from "lucide-react";
import type { County, Watchlist as WatchlistRow } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function priorityColor(p: string | null | undefined): string {
  switch (p) {
    case "high": return "border-red-500/50 text-red-500 bg-red-500/5";
    case "low": return "border-muted-foreground/40 text-muted-foreground";
    default: return "border-primary/40 text-primary";
  }
}

function WatchlistCard({
  w, county, onRemove, isRemoving,
}: {
  w: WatchlistRow;
  county: County;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(w.note ?? "");
  const [priority, setPriority] = useState(w.priority ?? "normal");

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/watchlist/${w.countyFips}`, { note, priority });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Watchlist updated" });
      setEditing(false);
    },
  });

  return (
    <Card data-testid={`watchlist-item-${w.countyFips}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/counties/${county.fips}`} className="flex-1 min-w-0 hover:text-primary">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-medium text-sm">{county.name}, {county.state}</div>
              <Badge variant="outline" className={`text-[9px] uppercase tracking-wider ${priorityColor(w.priority)}`}>
                {w.priority ?? "normal"}
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
              {county.iso ?? "—"} · {county.utility ?? "—"}
            </div>
          </Link>
          <ScoreBadge score={county.landingProbability ?? 0} tier={county.scoreTier ?? undefined} size="sm" />
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notes about why you're tracking this county…"
              rows={3}
              className="text-xs resize-none"
              data-testid={`textarea-note-${w.countyFips}`}
            />
            <div className="flex items-center gap-2">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-8 w-[120px] text-xs" data-testid={`select-priority-${w.countyFips}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid={`button-save-${w.countyFips}`}
                className="h-8 text-xs"
              >
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setEditing(false); setNote(w.note ?? ""); setPriority(w.priority ?? "normal"); }}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {w.note ? (
              <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">{w.note}</p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic mt-2">No note yet</p>
            )}
          </>
        )}

        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-muted-foreground">
            Added {new Date(w.addedAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1">
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                data-testid={`button-edit-${w.countyFips}`}
                className="h-7 text-xs"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={isRemoving}
              data-testid={`button-remove-${w.countyFips}`}
              className="h-7 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remove
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WatchlistPage() {
  const { toast } = useToast();
  const { data: watchlist, isLoading: watchlistLoading } = useQuery<WatchlistRow[]>({
    queryKey: ["/api/watchlist"],
  });
  const { data: counties, isLoading: countiesLoading } = useQuery<County[]>({ queryKey: ["/api/counties"] });

  const removeMutation = useMutation({
    mutationFn: async (fips: string) => {
      await apiRequest("DELETE", `/api/watchlist/${fips}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const isLoading = watchlistLoading || countiesLoading;

  // Sort: high priority first, then by county score
  const priorityRank = (p: string | null | undefined) => (p === "high" ? 0 : p === "normal" ? 1 : 2);
  const items = (watchlist ?? [])
    .map((w) => ({ w, county: counties?.find((c) => c.fips === w.countyFips) }))
    .filter((x): x is { w: WatchlistRow; county: County } => !!x.county)
    .sort((a, b) => {
      const pr = priorityRank(a.w.priority) - priorityRank(b.w.priority);
      if (pr !== 0) return pr;
      return (b.county.landingProbability ?? 0) - (a.county.landingProbability ?? 0);
    });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" />
          Watchlist
        </h1>
        <p className="text-sm text-muted-foreground">
          {items.length > 0
            ? `${items.length} ${items.length === 1 ? "county" : "counties"} you're tracking — notes and priorities persist across sessions.`
            : "Counties you're tracking. Add candidates from any county detail page."}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16">
            <Star className="h-8 w-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-sm font-medium">Your watchlist is empty</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Star counties to track their signals and score changes over time.
            </p>
            <Link href="/counties">
              <Button variant="outline" size="sm" data-testid="link-browse-counties">
                Browse counties
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map(({ w, county }) => (
            <WatchlistCard
              key={w.id}
              w={w}
              county={county}
              onRemove={() => removeMutation.mutate(w.countyFips)}
              isRemoving={removeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
