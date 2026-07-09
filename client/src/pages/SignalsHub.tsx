import { useLocation, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/PageTabs";
import Signals from "./Signals";
import Triggers from "./Triggers";
import Movers from "./Movers";

const TABS: PageTab[] = [
  { label: "Feed", path: "/signals" },
  { label: "Triggers", path: "/triggers" },
  { label: "Movers", path: "/movers" },
];

// Consolidated "Signals & activity" — the raw signal feed, clustered triggers,
// and daily score movers, which were three separate nav items.
export default function SignalsHub() {
  const [location] = useLocation();
  const body =
    location === "/triggers" ? <Triggers embedded /> :
    location === "/movers" ? <Movers embedded /> :
    <Signals embedded />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Link>
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
