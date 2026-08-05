import type { Express } from "express";
import type { Server } from "node:http";
import { registerAuth, registerExportRoutes } from "./_reexport";
import { registerCounties } from "./counties";
import { registerBacktest } from "./backtest";
import { registerSignals } from "./signals";
import { registerAlerts } from "./alerts";
import { registerSiteIntel } from "./siteintel";
import { registerOps } from "./ops";

// registerRoutes wires every /api route group onto the Express app. The route
// handlers were split out of a single 1,786-line file into these domain modules;
// this is the same surface, just organized. Order preserved from the original.
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerAuth(app);
  registerExportRoutes(app);
  registerCounties(app);
  registerBacktest(app);
  registerSignals(app);
  registerAlerts(app);
  registerSiteIntel(app);
  registerOps(app);
  return httpServer;
}
