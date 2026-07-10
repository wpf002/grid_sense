import { describe, it, expect } from "vitest";
import { pipelineLabel } from "./pipelines";

// Pipeline names are mostly acronyms. The generic humanize() produced "Fema nri"
// and "Epa ozone", which violates the acronyms-stay-uppercase rule.
describe("pipelineLabel", () => {
  it("keeps acronyms uppercase", () => {
    expect(pipelineLabel("fema_nri")).toBe("FEMA NRI");
    expect(pipelineLabel("epa_ozone")).toBe("EPA Ozone");
    expect(pipelineLabel("usgs_water")).toBe("USGS Water");
    expect(pipelineLabel("hifld_transmission")).toBe("HIFLD Transmission");
    expect(pipelineLabel("fcc_bdc")).toBe("FCC BDC");
    expect(pipelineLabel("usda_rucc")).toBe("USDA RUCC");
  });

  it("renders ISO/RTO queues correctly", () => {
    expect(pipelineLabel("pjm_queue")).toBe("PJM Queue");
    expect(pipelineLabel("miso_queue")).toBe("MISO Queue");
    expect(pipelineLabel("ercot_queue")).toBe("ERCOT Queue");
    expect(pipelineLabel("isone_queue")).toBe("ISO-NE Queue");
    expect(pipelineLabel("caiso_queue")).toBe("CAISO Queue");
    expect(pipelineLabel("nyiso_queue")).toBe("NYISO Queue");
    expect(pipelineLabel("spp_queue")).toBe("SPP Queue");
    expect(pipelineLabel("lbnl_queue")).toBe("LBNL Queue");
  });

  it("handles mixed-case brand names", () => {
    expect(pipelineLabel("arcgis_parcels")).toBe("ArcGIS Parcels");
    expect(pipelineLabel("arcgis_permits")).toBe("ArcGIS Permits");
    expect(pipelineLabel("peeringdb")).toBe("PeeringDB");
  });

  it("splits a trailing dataset number", () => {
    expect(pipelineLabel("eia860")).toBe("EIA-860");
    expect(pipelineLabel("eia861")).toBe("EIA-861");
  });

  it("uses whole-name overrides where token formatting reads badly", () => {
    expect(pipelineLabel("score_history_daily")).toBe("Daily Score Snapshot");
    expect(pipelineLabel("shell_llcs")).toBe("Shell LLC Resolver");
    expect(pipelineLabel("enrich")).toBe("Rescore Counties");
    expect(pipelineLabel("dc_news")).toBe("DC News");
    expect(pipelineLabel("wholesale_price")).toBe("Wholesale Power Prices");
  });

  it("Title Cases an unknown pipeline rather than showing raw snake_case", () => {
    expect(pipelineLabel("austin_permits")).toBe("Austin Permits");
    expect(pipelineLabel("brand_new_source")).toBe("Brand New Source");
  });

  it("never leaves an underscore in the output", () => {
    const REAL_PIPELINES = [
      "arcgis_parcels", "arcgis_permits", "austin_permits", "caiso_queue",
      "competitive_from_announcements", "comps", "dc_announcements_real", "dc_backtest",
      "dc_news", "edgar", "eia860", "eia861", "eia_power_price", "enrich", "epa_ozone",
      "ercot_queue", "expand_counties", "fcc_bdc", "fema_nri", "generate_alerts",
      "hifld_transmission", "iso_queue_history", "isone_queue", "lbnl_queue", "miso_queue",
      "noaa_climate", "nyiso_queue", "overpass_parcels", "peeringdb", "pjm_queue",
      "score_history_daily", "sec_edgar", "shell_llcs", "socrata_permits", "spp_queue",
      "state_energy_factors", "state_incentives", "usda_land", "usda_rucc", "usgs_water",
      "water_stress", "wholesale_price",
    ];
    for (const p of REAL_PIPELINES) {
      const label = pipelineLabel(p);
      expect(label, `${p} -> ${label}`).not.toContain("_");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("survives empty input", () => {
    expect(pipelineLabel("")).toBe("");
  });
});
