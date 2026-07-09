import { useLocation, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/PageTabs";
import DataQuality from "./DataQuality";
import IngestionRuns from "./IngestionRuns";
import Heartbeat from "./Heartbeat";

const TABS: PageTab[] = [
  { label: "Freshness", path: "/heartbeat" },
  { label: "Ingestion Runs", path: "/ingestion" },
  { label: "Data Quality", path: "/data-quality" },
];

// Consolidated "Data health" — pipeline freshness, ingestion run history, and
// factor data-quality, which were three separate ops nav items.
export default function DataHealth() {
  const [location] = useLocation();
  const body =
    location === "/ingestion" ? <IngestionRuns embedded /> :
    location === "/data-quality" ? <DataQuality embedded /> :
    <Heartbeat embedded />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Link>
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
