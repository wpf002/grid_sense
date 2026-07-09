import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

export interface PageTab {
  label: string;
  path: string;
}

/**
 * Route-driven tab strip for consolidated hub pages. The active tab is derived
 * from the current path (so each tab is a real, deep-linkable URL), not from
 * internal state.
 */
export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const [location] = useLocation();
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {tabs.map((t) => {
        const active = location === t.path;
        return (
          <Link
            key={t.path}
            href={t.path}
            data-testid={`tab-${t.path.replace(/\//g, "")}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
