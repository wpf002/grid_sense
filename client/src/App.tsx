import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
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
import Triggers from "@/pages/Triggers";
import Signals from "@/pages/Signals";
import Watchlist from "@/pages/Watchlist";
import Operators from "@/pages/Operators";
import Methodology from "@/pages/Methodology";
import Alerts from "@/pages/Alerts";
import DataQuality from "@/pages/DataQuality";
import IngestionRuns from "@/pages/IngestionRuns";
import Backtest from "@/pages/Backtest";
import Movers from "@/pages/Movers";
import LeadGen from "@/pages/LeadGen";
import Login from "@/pages/Login";
import Heartbeat from "@/pages/Heartbeat";
import MyWatchlist from "@/pages/MyWatchlist";
import Portfolio from "@/pages/Portfolio";
import Parcels from "@/pages/Parcels";
import Permits from "@/pages/Permits";
import CompetitiveBids from "@/pages/CompetitiveBids";
import Digest from "@/pages/Digest";
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
      <Route path="/triggers" component={Triggers} />
      <Route path="/signals" component={Signals} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/operators" component={Operators} />
      <Route path="/data-quality" component={DataQuality} />
      <Route path="/ingestion" component={IngestionRuns} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/movers" component={Movers} />
      <Route path="/leadgen" component={LeadGen} />
      <Route path="/login" component={Login} />
      <Route path="/heartbeat" component={Heartbeat} />
      <Route path="/my-watchlist" component={MyWatchlist} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/parcels" component={Parcels} />
      <Route path="/permits" component={Permits} />
      <Route path="/competitive" component={CompetitiveBids} />
      <Route path="/digest" component={Digest} />
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
                  <div className="text-xs text-muted-foreground font-mono hidden lg:block">
                    US data center land radar
                  </div>
                </div>
              </header>
              <main className="flex-1 overflow-y-auto">
                <ErrorBoundary>
                  <Router hook={useHashLocation}>
                    <AppRouter />
                  </Router>
                </ErrorBoundary>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <KeyboardShortcuts />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
