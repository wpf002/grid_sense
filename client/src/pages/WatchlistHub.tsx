import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import MyWatchlist from "./MyWatchlist";
import SharedWatchlist from "./Watchlist";

type Me = { id: number; email: string } | null;

// Single consolidated Watchlist (was two nav items: "Watchlist" shared list +
// "My Watchlist" personal list). Signed-in users get their personal watchlist
// and alert rules; everyone else sees the shared/starter list.
export default function WatchlistHub() {
  const { data: me, isLoading } = useQuery<Me>({ queryKey: ["/api/auth/me"] });
  if (isLoading) {
    return <div className="p-6"><Skeleton className="h-40" /></div>;
  }
  return me?.id ? <MyWatchlist /> : <SharedWatchlist />;
}
