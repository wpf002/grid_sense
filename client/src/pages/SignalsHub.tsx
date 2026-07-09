import { useLocation } from "wouter";
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
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
