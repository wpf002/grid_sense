import { useLocation } from "wouter";
import { PageTabs, type PageTab } from "@/components/PageTabs";
import Parcels from "./Parcels";
import Permits from "./Permits";
import CompetitiveBids from "./CompetitiveBids";

const TABS: PageTab[] = [
  { label: "Parcels", path: "/parcels" },
  { label: "Permits", path: "/permits" },
  { label: "Competitive", path: "/competitive" },
];

// Consolidated "Site intelligence" — parcels, permits, and competitive activity
// (the same three tabs that appear on a county-detail page, at national scope).
export default function SiteIntel() {
  const [location] = useLocation();
  const body =
    location === "/permits" ? <Permits embedded /> :
    location === "/competitive" ? <CompetitiveBids embedded /> :
    <Parcels embedded />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
