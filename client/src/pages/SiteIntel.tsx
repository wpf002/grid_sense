import { useLocation, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
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
      <Link href="/" className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Link>
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
