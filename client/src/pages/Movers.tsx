import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface MoverRow {
  fips: string;
  name: string;
  state: string;
  today_score: number;
  yesterday_score: number;
  delta: number;
}

interface MoversPayload {
  today: string | null;
  yesterday: string | null;
  gainers: MoverRow[];
  losers: MoverRow[];
}

export default function Movers({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading } = useQuery<MoversPayload>({
    queryKey: ["/api/score-history/daily-diff"],
  });

  return (
    <div className={embedded ? "space-y-4 sm:space-y-6" : "p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto"}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Daily movers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Counties whose landing-probability score changed most between the last
          two daily snapshots. Powered by the nightly score-history table (Gap 12).
        </p>
        {data?.today && data?.yesterday && (
          <p className="mt-1 text-xs font-mono text-muted-foreground">
            {data.yesterday} → {data.today}
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card data-testid="card-gainers">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Top gainers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : data?.gainers?.length ? (
              data.gainers.map((r) => <MoverRowUi key={r.fips} row={r} />)
            ) : (
              <p className="text-xs text-muted-foreground">No gainers today.</p>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-losers">
          <CardHeader className="pb-3">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Top losers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : data?.losers?.length ? (
              data.losers.map((r) => <MoverRowUi key={r.fips} row={r} />)
            ) : (
              <p className="text-xs text-muted-foreground">No losers today.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MoverRowUi({ row }: { row: MoverRow }) {
  const positive = row.delta > 0;
  return (
    <Link
      href={`/counties/${row.fips}`}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
      data-testid={`link-mover-${row.fips}`}
    >
      <div className="flex-1">
        <div className="font-medium">{row.name} County, {row.state}</div>
        <div className="text-muted-foreground font-mono">
          {row.yesterday_score.toFixed(0)} → {row.today_score.toFixed(0)}
        </div>
      </div>
      <Badge variant={positive ? "default" : "destructive"} className="font-mono">
        {positive ? "+" : ""}{row.delta.toFixed(1)}
      </Badge>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
    </Link>
  );
}
