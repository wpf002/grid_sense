import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: "primary" | "orange" | "blue" | "muted";
  testId?: string;
}

export function StatCard({ label, value, hint, icon: Icon, accent = "muted", testId }: StatCardProps) {
  const accentCls = {
    primary: "text-primary",
    orange: "text-orange-500 dark:text-orange-400",
    blue: "text-blue-500 dark:text-blue-400",
    muted: "text-muted-foreground",
  }[accent];

  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          </div>
          {Icon && (
            <div className={cn("rounded-md bg-muted/60 p-2", accentCls)}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
