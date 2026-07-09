import { useLocation } from "wouter";
import { PageTabs, type PageTab } from "@/components/PageTabs";
import DataQuality from "./DataQuality";
import IngestionRuns from "./IngestionRuns";
import Heartbeat from "./Heartbeat";

const TABS: PageTab[] = [
  { label: "Freshness", path: "/heartbeat" },
  { label: "Ingestion runs", path: "/ingestion" },
  { label: "Data quality", path: "/data-quality" },
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
      <PageTabs tabs={TABS} />
      {body}
    </div>
  );
}
