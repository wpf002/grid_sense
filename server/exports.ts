import type { Express, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { Parser as CsvParser } from "json2csv";
import { storage, sqlite } from "./storage";
import { computeCountyFactorsV5 } from "./scoring";
import { buildOverlayFor, warmOverlayCaches } from "./ingest/overlay";

let _pdfOverlayWarmed = false;
function ensurePdfOverlayWarm() {
  if (!_pdfOverlayWarmed) {
    try { warmOverlayCaches(); _pdfOverlayWarmed = true; } catch (e) { console.error("[pdf overlay warm]", e); }
  }
}

export function registerExportRoutes(app: Express) {
  // ---- CSV: ranked counties export ---------------------------------------
  app.get("/api/counties.csv", async (_req: Request, res: Response) => {
    try {
      const rows = await storage.listCounties();
      const flat = rows.map((r: any) => ({
        fips: r.fips,
        state: r.state ?? "",
        name: r.name ?? "",
        landing_probability: r.landingProbability ?? 0,
        tier: r.scoreTier ?? "",
        iso: r.iso ?? "",
        utility: r.utility ?? "",
        queued_load_mw: r.queuedLoadMw ?? 0,
        time_to_power_months: r.timeToPowerMonths ?? "",
        fiber_score: r.fiberDensityScore ?? 0,
        median_land_price_per_acre: r.medianLandPricePerAcre ?? "",
        hazard_score: r.hazardScore ?? 0,
        water_stress_score: r.waterStressScore ?? 0,
        moratorium_status: r.moratoriumStatus ?? "none",
        right_to_build_zoning: r.rightToBuildZoning ?? 0,
        existing_dc_count: r.existingDcCount ?? 0,
        existing_dc_capacity_mw: r.existingDcCapacityMw ?? 0,
      }));
      if (!flat.length) {
        res.setHeader("Content-Type", "text/csv");
        res.send("");
        return;
      }
      const parser = new CsvParser({ fields: Object.keys(flat[0]) });
      const csv = parser.parse(flat);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="gridsense-counties-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- CSV: comps ---------------------------------------------------------
  app.get("/api/comps.csv", async (_req: Request, res: Response) => {
    try {
      const rows = sqlite
        .prepare(
          "SELECT * FROM dc_comps ORDER BY deal_date DESC, price_per_acre DESC",
        )
        .all();
      if (!rows.length) {
        res.setHeader("Content-Type", "text/csv");
        res.send("no comps");
        return;
      }
      const parser = new CsvParser({ fields: Object.keys(rows[0] as object) });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="gridsense-comps.csv"`,
      );
      res.send(parser.parse(rows));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- PDF: single-county site brief --------------------------------------
  app.get(
    "/api/counties/:fips/site-brief.pdf",
    async (req: Request, res: Response) => {
      try {
        const fips = String(req.params.fips);
        const county: any = await storage.getCounty(fips);
        if (!county) {
          res.status(404).json({ error: "county not found" });
          return;
        }

        const state = county.state ?? "";

        const inCountyComps = sqlite
          .prepare(
            `SELECT deal_date, county_name, acres, price_usd, price_per_acre, buyer, note FROM dc_comps WHERE fips = ? ORDER BY deal_date DESC LIMIT 8`,
          )
          .all(fips);
        const stateComps = sqlite
          .prepare(
            `SELECT deal_date, county_name, acres, price_usd, price_per_acre, buyer, note FROM dc_comps WHERE state = ? AND fips != ? ORDER BY deal_date DESC LIMIT 8`,
          )
          .all(state, fips);
        const waterRow: any = sqlite
          .prepare("SELECT * FROM state_water_stress WHERE state = ?")
          .get(state);
        const parcelsRow: any = tableExists("osm_county_inspection")
          ? sqlite
              .prepare("SELECT * FROM osm_county_inspection WHERE fips = ?")
              .get(fips)
          : null;
        const transmission: any = sqlite
          .prepare("SELECT * FROM transmission_county_agg WHERE fips = ?")
          .get(fips);
        const powerPrice: any = sqlite
          .prepare("SELECT * FROM state_power_price WHERE state = ?")
          .get(state);
        const shellRow: any = sqlite
          .prepare("SELECT * FROM shell_llc_activity WHERE fips = ?")
          .get(fips);
        const queueRows: any[] = sqlite
          .prepare(
            `SELECT iso, snapshot_date, active_mw, withdrawn_mw, active_projects, withdrawn_projects FROM iso_queue_history WHERE fips = ? ORDER BY snapshot_date DESC LIMIT 6`,
          )
          .all(fips);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="gridsense-${fips}-brief.pdf"`,
        );

        const doc = new PDFDocument({ size: "LETTER", margin: 54 });
        doc.pipe(res);

        // Header
        doc
          .fillColor("#0f172a")
          .fontSize(20)
          .font("Helvetica-Bold")
          .text("GridSense Site Brief");
        doc
          .moveDown(0.15)
          .fontSize(11)
          .font("Helvetica")
          .fillColor("#475569")
          .text(`${county.name ?? "County"}, ${state} · FIPS ${fips}`)
          .text(`ISO: ${county.iso ?? "—"}    Utility: ${county.utility ?? "—"}`)
          .text(`Generated ${new Date().toISOString().slice(0, 10)}`)
          .moveDown(0.6);

        // Score band
        const bandY = doc.y;
        doc.rect(54, bandY, 504, 64).fill("#0ea5e9");
        doc
          .fillColor("#ffffff")
          .fontSize(32)
          .font("Helvetica-Bold")
          .text(
            String(county.landingProbability?.toFixed?.(0) ?? county.landingProbability ?? "—"),
            60,
            bandY + 12,
            { width: 100, align: "center" },
          );
        doc
          .fontSize(9)
          .font("Helvetica")
          .text("SCORE (0–100)", 60, bandY + 48, {
            width: 100,
            align: "center",
          });
        doc
          .fontSize(14)
          .font("Helvetica-Bold")
          .text(`Tier: ${(county.scoreTier ?? "—").toUpperCase()}`, 180, bandY + 12);
        doc
          .fontSize(10)
          .font("Helvetica")
          .text(
            `Queued load: ${fmtMw(county.queuedLoadMw)}    Time to power: ${county.timeToPowerMonths ?? "—"} mo    Fiber: ${county.fiberDensityScore ?? "—"}    Zoning: ${county.rightToBuildZoning ? "By-right" : "Rezone req"}`,
            180,
            bandY + 34,
            { width: 370 },
          );
        doc.y = bandY + 78;
        doc.fillColor("#0f172a");
        doc.moveDown(0.5);

        // ---- Why this score? (strengths + weaknesses w/ live factors) ----
        try {
          ensurePdfOverlayWarm();
          const overlay = buildOverlayFor(fips);
          const liveFactors = computeCountyFactorsV5(county, overlay);
          const total = liveFactors.reduce((s, f) => s + (f.contribution ?? 0), 0);
          const enriched = liveFactors.map((f) => ({
            ...f,
            share: total > 0 ? (f.contribution ?? 0) / total : 0,
          }));
          enriched.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
          const strengths = enriched.filter((f) => f.value >= 60).slice(0, 3);
          const weaknesses = enriched.filter((f) => f.value < 40).sort((a, b) => a.value - b.value).slice(0, 3);

          section(doc, "Why this score?");
          doc.font("Helvetica").fontSize(9).fillColor("#475569")
            .text("Top three factor contributions, then the biggest strengths and weaknesses.");
          doc.moveDown(0.2).fillColor("#0f172a");
          const top3 = enriched.slice(0, 3);
          for (const f of top3) {
            doc.font("Helvetica-Bold").text(f.label + "  ", { continued: true })
              .font("Helvetica")
              .text(`${(f.share * 100).toFixed(0)}% of composite  ·  factor ${(f.value ?? 0).toFixed(0)}/100${f.sourceHint ? `  ·  ${f.sourceHint}` : ""}`);
          }
          doc.moveDown(0.2);
          if (strengths.length) {
            doc.font("Helvetica-Bold").fillColor("#166534").text("Strengths").fillColor("#0f172a").font("Helvetica");
            for (const f of strengths) doc.text(`• ${f.label} — ${(f.value ?? 0).toFixed(0)}/100${f.sourceHint ? ` (${f.sourceHint})` : ""}`);
          }
          if (weaknesses.length) {
            doc.moveDown(0.1);
            doc.font("Helvetica-Bold").fillColor("#991b1b").text("Weaknesses").fillColor("#0f172a").font("Helvetica");
            for (const f of weaknesses) doc.text(`• ${f.label} — ${(f.value ?? 0).toFixed(0)}/100${f.sourceHint ? ` (${f.sourceHint})` : ""}`);
          }
          doc.moveDown(0.4);
        } catch (e) {
          console.error("[pdf why-this-score]", e);
        }

        // Factor summary
        section(doc, "Factor summary");
        const factors: Array<[string, any, string]> = [
          ["Queue MW", fmtMw(county.queuedLoadMw), "→ heavier queues signal DC demand pressure"],
          ["Substation headroom (MVA)", county.substationHeadroomMva ?? "—", ""],
          ["Time to power (months)", county.timeToPowerMonths ?? "—", "lower is better"],
          ["Fiber density", county.fiberDensityScore ?? "—", "0-100"],
          ["Peering exchanges", county.peeringExchangeCount ?? 0, ""],
          ["Water stress score", county.waterStressScore ?? "—", "lower is safer"],
          ["Hazard score", county.hazardScore ?? "—", "FEMA NRI-derived"],
          ["Tax incentive score", county.taxIncentiveScore ?? "—", ""],
          ["Existing DC count", county.existingDcCount ?? 0, ""],
          ["Median land $/ac", county.medianLandPricePerAcre != null ? `$${Number(county.medianLandPricePerAcre).toLocaleString()}` : "—", ""],
        ];
        for (const [k, v, hint] of factors) {
          doc
            .font("Helvetica-Bold")
            .text(k, { continued: true })
            .font("Helvetica")
            .text(`  ${v}${hint ? "  — " + hint : ""}`);
        }
        doc.moveDown(0.4);

        // Transmission
        section(doc, "Transmission (HIFLD)");
        if (transmission) {
          doc.text(
            `Segments: ${transmission.segment_count ?? 0}    Total km: ${(transmission.total_km ?? 0).toFixed(1)}    Max kV: ${transmission.max_voltage_kv ?? "—"}`,
          );
          doc.text(
            `  ≤100kV: ${(transmission.km_lt_100 ?? 0).toFixed(0)} km  ·  100–161: ${(transmission.km_100_161 ?? 0).toFixed(0)}  ·  220–287: ${(transmission.km_220_287 ?? 0).toFixed(0)}  ·  345: ${(transmission.km_345 ?? 0).toFixed(0)}  ·  500: ${(transmission.km_500 ?? 0).toFixed(0)}  ·  735+: ${(transmission.km_735_up ?? 0).toFixed(0)}`,
          );
        } else muted(doc, "No transmission aggregate for this FIPS.");
        doc.moveDown(0.4);

        // Water
        section(doc, "Water stress");
        if (waterRow) {
          doc.text(
            `State stress: ${waterRow.stress_score}    Adjudicated: ${waterRow.adjudicated ? "Yes" : "No"}    Moratorium: ${waterRow.moratorium ? "Yes" : "No"}    Colorado River: ${waterRow.colorado_river_basin ? "Yes" : "No"}    Ogallala: ${waterRow.ogallala_dependent ? "Yes" : "No"}`,
          );
          if (waterRow.notes) doc.fillColor("#475569").text(waterRow.notes).fillColor("#0f172a");
        } else muted(doc, "No water record.");
        doc.moveDown(0.4);

        // Power price
        section(doc, "Power price (EIA state avg)");
        if (powerPrice) {
          doc.text(
            `Industrial: ${powerPrice.industrial_cents_per_kwh?.toFixed?.(2) ?? "—"} ¢/kWh    Commercial: ${powerPrice.commercial_cents_per_kwh?.toFixed?.(2) ?? "—"} ¢/kWh    YoY: ${powerPrice.industrial_yoy_pct != null ? powerPrice.industrial_yoy_pct.toFixed(1) + "%" : "—"}    Period: ${powerPrice.period ?? "—"}`,
          );
        } else muted(doc, "No EIA price for state.");
        doc.moveDown(0.4);

        // Queue history
        section(doc, "ISO queue activity (active vs withdrawn)");
        if (queueRows.length) {
          for (const q of queueRows) {
            doc.text(
              `${q.snapshot_date}  ${q.iso}  active ${Math.round(q.active_mw)} MW (${q.active_projects})  ·  withdrawn ${Math.round(q.withdrawn_mw)} MW (${q.withdrawn_projects})`,
            );
          }
        } else muted(doc, "No queue history for this FIPS.");
        doc.moveDown(0.4);

        // Shell activity
        section(doc, "Shell-LLC signals in county");
        if (shellRow) {
          try {
            const ops = JSON.parse(shellRow.operators_json || "[]");
            const llcs = JSON.parse(shellRow.llc_names_json || "[]");
            doc.text(`Operators: ${ops.join(", ") || "—"}`);
            doc.text(`LLCs (${shellRow.total_llc_count}): ${llcs.slice(0, 8).join(", ") || "—"}`);
          } catch {
            doc.text(`${shellRow.total_llc_count} LLC signals`);
          }
        } else muted(doc, "No shell-LLC activity detected.");
        doc.moveDown(0.4);

        // Comps
        section(doc, "Recent DC land comps (in-county)");
        if (inCountyComps.length) {
          for (const c of inCountyComps as any[]) {
            doc.text(
              `${c.deal_date}  ${c.county_name}  ${c.acres} ac  $${Math.round(c.price_per_acre).toLocaleString()}/ac  (${c.buyer})`,
            );
          }
        } else muted(doc, "No in-county comps yet.");

        if (stateComps.length) {
          doc.moveDown(0.2);
          doc.font("Helvetica-Bold").text("State comps (nearby):").font("Helvetica");
          for (const c of stateComps as any[]) {
            doc.text(
              `${c.deal_date}  ${c.county_name}  ${c.acres} ac  $${Math.round(c.price_per_acre).toLocaleString()}/ac  (${c.buyer})`,
            );
          }
        }
        doc.moveDown(0.4);

        // OSM parcels
        section(doc, "Parcel proxy (OpenStreetMap)");
        if (parcelsRow) {
          doc.text(
            `Industrial: ${parcelsRow.industrial_count ?? 0}    Brownfield: ${parcelsRow.brownfield_count ?? 0}    Substations: ${parcelsRow.substation_count ?? 0}    Large buildings: ${parcelsRow.large_building_count ?? 0}`,
          );
          if (parcelsRow.total_acres != null) doc.text(`Total acres (proxy): ${Math.round(parcelsRow.total_acres)}`);
        } else muted(doc, "Not fetched yet — open the county page online to trigger OSM fetch.");
        doc.moveDown(0.8);

        // Footer
        doc
          .fontSize(8)
          .fillColor("#94a3b8")
          .text(
            "Generated by GridSense v2.0 (free-data build). Pre-diligence only — verify Regrid parcel titles, water rights, and interconnection capacity before making offers.",
            { align: "center" },
          );

        doc.end();
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }
    },
  );
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(title);
  doc.font("Helvetica").fontSize(10);
}

function muted(doc: PDFKit.PDFDocument, msg: string) {
  doc.fillColor("#94a3b8").text(msg).fillColor("#0f172a");
}

function fmtMw(mw?: number | null): string {
  if (mw == null || mw === 0) return "—";
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw)} MW`;
}

function tableExists(name: string): boolean {
  try {
    const row = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      )
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}
