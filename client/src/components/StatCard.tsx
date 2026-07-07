import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: "primary" | "orange" | "blue" | "red" | "muted";
  testId?: string;
}

const ACCENTS = {
  primary: { value: "text-primary", iconBg: "bg-primary/10 text-primary", border: "border-l-primary/60" },
  red: { value: "text-red-600 dark:text-red-400", iconBg: "bg-red-500/10 text-red-600 dark:text-red-400", border: "border-l-red-500/60" },
  orange: { value: "text-orange-600 dark:text-orange-400", iconBg: "bg-orange-500/10 text-orange-600 dark:text-orange-400", border: "border-l-orange-500/60" },
  blue: { value: "text-blue-600 dark:text-blue-400", iconBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400", border: "border-l-blue-500/60" },
  muted: { value: "text-foreground", iconBg: "bg-muted/60 text-muted-foreground", border: "border-l-border" },
} as const;

export function StatCard({ label, value, hint, icon: Icon, accent = "muted", testId }: StatCardProps) {
  const a = ACCENTS[accent];
  const display = typeof value === "number" ? value.toLocaleString() : value;

  return (
    <Card
      data-testid={testId}
      className={cn("border-l-2 transition-colors hover:bg-muted/30", a.border)}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <span className={cn("text-xl font-semibold tabular-nums tracking-tight", a.value)}>
              {display}
            </span>
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          </div>
          {Icon && (
            <div className={cn("rounded-lg p-2 shrink-0", a.iconBg)}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
