import { LayoutDashboard, Map, Radio, Star, Building2, BookOpen, GitCompare, Bell, Target, Users, Lock, HeartPulse, FolderUp, LandPlot, Inbox, Table2, Code2, DollarSign, Shield, Webhook } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  testid: string;
  badgeKey?: "alerts";
  // Paths that should also mark this item active (for consolidated tab hubs).
  match?: string[];
}

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, testid: "link-dashboard" },
      { title: "National Radar", url: "/map", icon: Map, testid: "link-map" },
      { title: "Counties", url: "/counties", icon: Table2, testid: "link-counties" },
      { title: "Compare", url: "/compare", icon: GitCompare, testid: "link-compare" },
      { title: "Operators", url: "/operators", icon: Building2, testid: "link-operators" },
    ],
  },
  {
    label: "Signals",
    items: [
      { title: "Signals", url: "/signals", icon: Radio, testid: "link-signals", match: ["/signals", "/triggers", "/movers"] },
      { title: "Alerts", url: "/alerts", icon: Bell, testid: "link-alerts", badgeKey: "alerts" },
      { title: "Digest", url: "/digest", icon: Inbox, testid: "link-digest" },
    ],
  },
  {
    label: "Site Intel",
    items: [
      { title: "Site Intel", url: "/parcels", icon: LandPlot, testid: "link-site-intel", match: ["/parcels", "/permits", "/competitive"] },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Watchlist", url: "/watchlist", icon: Star, testid: "link-watchlist", match: ["/watchlist", "/my-watchlist"] },
      { title: "Portfolio", url: "/portfolio", icon: FolderUp, testid: "link-portfolio" },
      { title: "Lead-Gen", url: "/leadgen", icon: Users, testid: "link-leadgen" },
      { title: "Backtest", url: "/backtest", icon: Target, testid: "link-backtest" },
    ],
  },
  {
    label: "Data & Ops",
    items: [
      { title: "Data Health", url: "/heartbeat", icon: HeartPulse, testid: "link-data-health", match: ["/heartbeat", "/ingestion", "/data-quality"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Methodology", url: "/methodology", icon: BookOpen, testid: "link-methodology" },
      { title: "API", url: "/api-docs", icon: Code2, testid: "link-api" },
      { title: "Pricing", url: "/pricing", icon: DollarSign, testid: "link-pricing" },
      { title: "Webhooks", url: "/webhooks", icon: Webhook, testid: "link-webhooks" },
      { title: "Admin", url: "/admin", icon: Shield, testid: "link-admin" },
      { title: "Account", url: "/login", icon: Lock, testid: "link-login" },
    ],
  },
];

function GridSenseLogo() {
  return (
    <div className="flex items-center gap-2 px-2 py-3">
      {/* Same mark as the header BrandMark (rack + transmission lines), in the
          sidebar's teal accent so the logo is consistent everywhere. */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="GridSense logo"
        className="text-primary"
      >
        <rect x="10" y="8" width="12" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <line x1="10" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10" y1="21" x2="22" y2="21" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="1.5" fill="currentColor" />
      </svg>
      <div className="flex flex-col">
        <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">GridSense</span>
        <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">DC Land Radar</span>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { data: alertCount } = useQuery<{ count: number }>({
    queryKey: ["/api/alerts/count-unack"],
    refetchInterval: 30_000,
  });
  const unread = alertCount?.count ?? 0;
  const { data: health } = useQuery<{ counties: number }>({ queryKey: ["/api/health"] });
  const countyCount = health?.counties;

  return (
    <Sidebar>
      <SidebarHeader>
        <GridSenseLogo />
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const paths = item.match ?? [item.url];
                  const isActive = paths.some(
                    (p) => location === p || (p !== "/" && location.startsWith(p + "/")),
                  );
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive} data-testid={item.testid}>
                        <Link href={item.url}>
                          <item.icon />
                          <span className="flex-1">{item.title}</span>
                          {item.badgeKey === "alerts" && unread > 0 && (
                            <Badge
                              className="bg-primary/25 text-primary border border-primary/40 h-4 min-w-4 px-1 text-[10px]"
                              data-testid="badge-sidebar-alerts"
                            >
                              {unread}
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="px-3 py-3 text-[11px] text-sidebar-foreground/60 space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span>Live public data · v2.0</span>
          </div>
          <div>US-only · {countyCount ? countyCount.toLocaleString() : "3,109"} counties tracked</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
