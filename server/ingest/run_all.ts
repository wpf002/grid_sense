// Orchestrator that runs every pipeline in order and then rescores.
// Called by the cron endpoint and by the CLI at build time.

import { ingestEia860 } from "./eia860.js";
import { ingestEdgar } from "./edgar.js";
import { ingestDcNews } from "./dc_news.js";
import { ingestFemaNri } from "./fema_nri.js";
import { ingestMisoQueue } from "./miso_queue.js";
import { ingestPjmQueue } from "./pjm_queue.js";
import { ingestErcotQueue } from "./ercot_queue.js";
import { ingestSppQueue } from "./spp_queue.js";
import { ingestCaisoQueue } from "./caiso_queue.js";
import { ingestNyisoQueue } from "./nyiso_queue.js";
import { ingestIsoneQueue } from "./isone_queue.js";
import { ingestFccBdc } from "./fcc_bdc.js";
import { ingestUsgsWater } from "./usgs_water.js";
import { ingestUsdaLand } from "./usda_land.js";
import { ingestUsdaRucc } from "./usda_rucc.js";
import { ingestStateIncentives } from "./state_incentives.js";
import { ingestPeeringDb } from "./peeringdb.js";
import { ingestShellLlcs } from "./shell_llcs.js";
import { ingestEia861 } from "./eia861.js";
import { ingestHifldTransmission } from "./hifld_transmission.js";
import { ingestEiaPowerPrice } from "./eia_power_price.js";
import { ingestIsoQueueHistory } from "./iso_queue_history.js";
import { ingestWaterStress } from "./water_stress.js";
import { ingestNoaaClimate } from "./noaa_climate.js";
import { ingestStateEnergyFactors } from "./state_energy_factors.js";
import { ingestSocrataPermits } from "./socrata_permits.js";
import { ingestArcgisParcels } from "./arcgis_parcels.js";
import { ingestRealAnnouncements } from "./dc_announcements_real.js";
import { ingestCompetitiveFromAnnouncements } from "./competitive_from_announcements.js";
import { ingestDcBacktest } from "./dc_backtest.js";
import { ingestComps } from "./comps.js";
import { ingestScoreHistory } from "./score_history.js";
import { generateAlerts } from "./generate_alerts.js";
import { expandTrackedCounties } from "./expand_counties.js";
import { enrichCounties } from "./enrich.js";
import { clearOverlayCaches } from "./overlay.js";

type PipeName =
  | "eia860"
  | "edgar"
  | "dc_news"
  | "fema_nri"
  | "miso_queue"
  | "pjm_queue"
  | "ercot_queue"
  | "spp_queue"
  | "caiso_queue"
  | "nyiso_queue"
  | "isone_queue"
  | "fcc_bdc"
  | "usgs_water"
  | "usda_land"
  | "usda_rucc"
  | "state_incentives"
  | "peeringdb"
  | "shell_llcs"
  | "eia861"
  | "hifld_transmission"
  | "eia_power_price"
  | "iso_queue_history"
  | "water_stress"
  | "noaa_climate"
  | "socrata_permits"
  | "arcgis_parcels"
  | "dc_backtest"
  | "dc_announcements_real"
  | "comps"
  | "score_history"
  | "expand_counties"
  | "enrich";

async function safe<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    console.log(`\n=== ${name} ===`);
    const r = await fn();
    console.log(`✓ ${name}`);
    return r;
  } catch (e: any) {
    console.error(`✗ ${name}:`, e?.message || e);
    return null;
  }
}

export async function runAll(pipes?: PipeName[]): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  const shouldRun = (p: PipeName) => !pipes || pipes.includes(p);
  if (shouldRun("eia860")) results.eia860 = await safe("EIA-860", () => ingestEia860());

  if (shouldRun("fema_nri")) results.fema_nri = await safe("FEMA NRI", () => ingestFemaNri());
  if (shouldRun("miso_queue")) results.miso_queue = await safe("MISO queue", () => ingestMisoQueue());
  if (shouldRun("pjm_queue")) results.pjm_queue = await safe("PJM queue", () => ingestPjmQueue());
  if (shouldRun("ercot_queue")) results.ercot_queue = await safe("ERCOT queue", () => ingestErcotQueue());
  if (shouldRun("spp_queue")) results.spp_queue = await safe("SPP queue", () => ingestSppQueue());
  if (shouldRun("caiso_queue")) results.caiso_queue = await safe("CAISO queue", () => ingestCaisoQueue());
  if (shouldRun("nyiso_queue")) results.nyiso_queue = await safe("NYISO queue", () => ingestNyisoQueue());
  if (shouldRun("isone_queue")) results.isone_queue = await safe("ISO-NE queue", () => ingestIsoneQueue());
  if (shouldRun("fcc_bdc")) results.fcc_bdc = await safe("FCC BDC (fiber)", () => ingestFccBdc());
  if (shouldRun("usgs_water")) results.usgs_water = await safe("USGS water use 2015", () => ingestUsgsWater());
  if (shouldRun("usda_land")) results.usda_land = await safe("USDA NASS Land Values 2025", () => ingestUsdaLand());
  if (shouldRun("usda_rucc")) results.usda_rucc = await safe("USDA ERS RUCC 2023", () => ingestUsdaRucc());
  if (shouldRun("state_incentives")) results.state_incentives = await safe("State DC tax incentives 2024", () => ingestStateIncentives());
  if (shouldRun("peeringdb")) results.peeringdb = await safe("PeeringDB IX facilities", () => ingestPeeringDb());
  if (shouldRun("shell_llcs")) results.shell_llcs = await safe("Shell LLC resolver", () => ingestShellLlcs());
  if (shouldRun("eia861")) results.eia861 = await safe("EIA-861 utility service territories", () => ingestEia861());
  if (shouldRun("hifld_transmission")) results.hifld_transmission = await safe("HIFLD transmission lines", () => ingestHifldTransmission());
  if (shouldRun("eia_power_price")) results.eia_power_price = await safe("EIA state industrial power price", () => ingestEiaPowerPrice());
  if (shouldRun("iso_queue_history")) results.iso_queue_history = await safe("ISO queue history snapshot", () => ingestIsoQueueHistory());
  if (shouldRun("water_stress")) results.water_stress = await safe("State water stress overlay", () => ingestWaterStress());
  if (shouldRun("noaa_climate")) results.noaa_climate = await safe("NOAA climate normals (cooling)", () => ingestNoaaClimate());
  if (shouldRun("noaa_climate")) results.state_energy = await safe("Carbon + gas factors (eGRID/EIA)", () => ingestStateEnergyFactors());
  if (shouldRun("socrata_permits")) results.socrata_permits = await safe("Real permits (Austin + Chicago)", () => ingestSocrataPermits());
  if (shouldRun("arcgis_parcels")) results.arcgis_parcels = await safe("Real parcels (Loudoun + Maricopa)", () => ingestArcgisParcels());
  if (shouldRun("dc_backtest")) results.dc_backtest = await safe("DC announcements backtest", () => ingestDcBacktest());
  // Overwrite the seed with the FIPS-verified real announcement set.
  if (shouldRun("dc_announcements_real")) results.dc_announcements_real = await safe("Real DC announcements (FIPS-verified)", () => ingestRealAnnouncements());
  if (shouldRun("dc_announcements_real")) results.competitive_real = await safe("Competitive bids from real announcements", () => ingestCompetitiveFromAnnouncements());
  if (shouldRun("comps")) results.comps = await safe("DC land comps database", () => ingestComps());
  if (shouldRun("edgar")) results.edgar = await safe("SEC EDGAR", () => ingestEdgar());
  if (shouldRun("dc_news")) results.dc_news = await safe("Data Center Dynamics RSS", () => ingestDcNews());
  if (shouldRun("expand_counties")) results.expand_counties = await safe("Expand tracked counties", async () => expandTrackedCounties(200));
  clearOverlayCaches();
  if (shouldRun("enrich")) results.enrich = await safe("Rescore counties", () => enrichCounties());
  if (shouldRun("score_history")) results.score_history = await safe("Score history snapshot", () => ingestScoreHistory());
  if (shouldRun("score_history")) results.generate_alerts = await safe("Generate alerts from score moves", () => generateAlerts());
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const only = arg ? (arg.split(",") as PipeName[]) : undefined;
  runAll(only)
    .then((r) => { console.log("\n=== RESULTS ===\n", JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
