import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  score: number;
  tier?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function tierColor(tier: string): string {
  switch (tier) {
    case "hot":
      return "bg-primary/15 text-primary border-primary/30";
    case "warm":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30";
    case "emerging":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function tierFromScore(score: number): string {
  if (score >= 75) return "hot";
  if (score >= 60) return "warm";
  if (score >= 45) return "emerging";
  return "cold";
}

export function ScoreBadge({ score, tier, size = "md", className }: ScoreBadgeProps) {
  const resolvedTier = tier ?? tierFromScore(score);
  const sizeCls =
    size === "sm"
      ? "text-[11px] px-1.5 py-0.5"
      : size === "lg"
      ? "text-sm px-3 py-1"
      : "text-xs px-2 py-0.5";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium uppercase tracking-wide",
        tierColor(resolvedTier),
        sizeCls,
        className
      )}
      data-testid={`badge-tier-${resolvedTier}`}
    >
      <span className="font-semibold">{score.toFixed(0)}</span>
      <span className="opacity-80">{resolvedTier}</span>
    </span>
  );
}
