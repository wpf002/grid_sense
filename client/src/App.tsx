import { Switch, Route, Router } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import Dashboard from "@/pages/Dashboard";
import MapView from "@/pages/MapView";
import ApiDocs from "@/pages/ApiDocs";
import Pricing from "@/pages/Pricing";
import Counties from "@/pages/Counties";
import CountyDetail from "@/pages/CountyDetail";
import Compare from "@/pages/Compare";
import Operators from "@/pages/Operators";
import Methodology from "@/pages/Methodology";
import Alerts from "@/pages/Alerts";
import Backtest from "@/pages/Backtest";
import LeadGen from "@/pages/LeadGen";
import Login from "@/pages/Login";
import Portfolio from "@/pages/Portfolio";
import Digest from "@/pages/Digest";
// Consolidated tab hubs (each groups what were several separate nav items).
import SignalsHub from "@/pages/SignalsHub";
import SiteIntel from "@/pages/SiteIntel";
import DataHealth from "@/pages/DataHealth";
import WatchlistHub from "@/pages/WatchlistHub";
import Landing from "@/pages/Landing";
import Admin from "@/pages/Admin";
import Webhooks from "@/pages/Webhooks";
import NotFound from "@/pages/not-found";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScoreExplainer } from "@/components/ScoreExplainer";
import { BrandMark } from "@/components/BrandMark";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/landing" component={Landing} />
      <Route path="/map" component={MapView} />
      <Route path="/counties" component={Counties} />
      <Route path="/counties/:fips" component={CountyDetail} />
      <Route path="/compare" component={Compare} />
      <Route path="/operators" component={Operators} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/leadgen" component={LeadGen} />
      <Route path="/login" component={Login} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/digest" component={Digest} />
      {/* Signals & activity hub (Feed / Triggers / Movers) */}
      <Route path="/signals" component={SignalsHub} />
      <Route path="/triggers" component={SignalsHub} />
      <Route path="/movers" component={SignalsHub} />
      {/* Site intelligence hub (Parcels / Permits / Competitive) */}
      <Route path="/parcels" component={SiteIntel} />
      <Route path="/permits" component={SiteIntel} />
      <Route path="/competitive" component={SiteIntel} />
      {/* Data health hub (Freshness / Ingestion runs / Data quality) */}
      <Route path="/heartbeat" component={DataHealth} />
      <Route path="/ingestion" component={DataHealth} />
      <Route path="/data-quality" component={DataHealth} />
      {/* Watchlist (personal when signed in, shared otherwise) */}
      <Route path="/watchlist" component={WatchlistHub} />
      <Route path="/my-watchlist" component={WatchlistHub} />
      <Route path="/api-docs" component={ApiDocs} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/admin" component={Admin} />
      <Route path="/webhooks" component={Webhooks} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Router must wrap everything that calls Link/useLocation (sidebar,
            command palette, page routes) — not just the routed pages —
            otherwise those components render outside the shared routing
            context. wouter defaults to real browser History routing (no
            `hook` prop needed); the Express catch-all in server/vite.ts and
            server/static.ts serves index.html for any non-API path so direct
            loads/refreshes on a route like /counties work. */}
        <Router>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full bg-background">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 gap-4">
                  <div className="flex items-center gap-3">
                    <SidebarTrigger data-testid="button-sidebar-toggle" />
                    <BrandMark size="md" />
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4">
                    <CommandPalette />
                    <ScoreExplainer />
                  </div>
                </header>
                <main className="flex-1 overflow-y-auto">
                  <ErrorBoundary>
                    <AppRouter />
                  </ErrorBoundary>
                </main>
              </div>
            </div>
          </SidebarProvider>
          <KeyboardShortcuts />
        </Router>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
