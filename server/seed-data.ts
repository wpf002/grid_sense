// Seed data grounded in the July 2026 research report.
// All figures traceable to research_signals.md / competitors.md citations.
// This is a curated PROTOTYPE dataset, not a nationwide database.

import type { InsertCounty, InsertSignal, InsertParcel, InsertOperator } from "@shared/schema";

export const SEED_OPERATORS: InsertOperator[] = [
  {
    name: "Meta",
    shellLlcs: JSON.stringify([
      "Raven Northbrook LLC", "J5 LLC", "Shaytura LLC", "Balloonist LLC",
      "Wildcat LLC", "Goldframe LLC", "Greater Kudu LLC", "Siculus Inc.",
      "DB Stu", "Goat Systems", "Laidley", "Liames", "Orla", "Pelican Leap",
      "Toreak Acquisition", "Wurldwide", "Borderplex Digital Assets",
    ]),
    codenames: JSON.stringify(["Hyperion", "Prometheus", "Klondike", "Anthem", "Jupiter"]),
    annualCapexBillions: 65,
    activeMarkets: JSON.stringify(["LA", "TX", "IN", "WI", "OH", "NM", "OK", "IA", "NE"]),
  },
  {
    name: "Google (Alphabet)",
    shellLlcs: JSON.stringify([
      "Fireball Group", "Westwood Solutions", "Agate", "Sharka",
      "Jet Stream LLC", "Questa LLC", "Gable Corp", "Jasmine Development LLC",
      "Design LLC",
    ]),
    codenames: JSON.stringify([]),
    annualCapexBillions: 85,
    activeMarkets: JSON.stringify(["NE", "IA", "OK", "NV", "OR", "IN", "VA", "GA", "SC"]),
  },
  {
    name: "Microsoft",
    shellLlcs: JSON.stringify(["Various NDA shells"]),
    codenames: JSON.stringify(["Fairwater"]),
    annualCapexBillions: 80,
    activeMarkets: JSON.stringify(["WI", "WA", "VA", "IA", "TX", "GA", "AZ", "OH"]),
  },
  {
    name: "Amazon (AWS)",
    shellLlcs: JSON.stringify(["Amazon Data Services", "Vadata"]),
    codenames: JSON.stringify([]),
    annualCapexBillions: 100,
    activeMarkets: JSON.stringify(["VA", "OR", "OH", "MS", "IN", "PA", "LA"]),
  },
  {
    name: "OpenAI / Stargate",
    shellLlcs: JSON.stringify(["Crusoe Cloud", "SB Investment Advisers"]),
    codenames: JSON.stringify(["Stargate"]),
    annualCapexBillions: 50,
    activeMarkets: JSON.stringify(["TX", "NM"]),
  },
  {
    name: "xAI",
    shellLlcs: JSON.stringify(["xAI Colossus"]),
    codenames: JSON.stringify(["Colossus"]),
    annualCapexBillions: 12,
    activeMarkets: JSON.stringify(["TN", "MS"]),
  },
];

// ------------------------------------------------------------
// COUNTIES: mix of primary, emerging, watch, and cold markets
// ------------------------------------------------------------
// Fields left un-scored (landingProbability/scoreTier) are computed by scorer.
export const SEED_COUNTIES: InsertCounty[] = [
  // ═══════ TIER 1: HOT — Emerging frontier with active hyperscaler moves ═══════
  {
    fips: "22083", name: "Richland Parish", state: "LA", lat: 32.408, lng: -91.762,
    iso: "MISO", utility: "Entergy Louisiana",
    queuedLoadMw: 5200, substationHeadroomMva: 800, timeToPowerMonths: 30, onsiteGenerationFriendly: true,
    fiberDensityScore: 45, peeringExchangeCount: 1,
    largeParcelCount: 8, medianLandPricePerAcre: 4200, floodplainPctBlock: 12, hazardScore: 25,
    waterStressScore: 15,
    taxIncentiveScore: 92, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "48441", name: "Taylor", state: "TX", lat: 32.301, lng: -99.898,
    iso: "ERCOT", utility: "AEP Texas",
    queuedLoadMw: 4800, substationHeadroomMva: 600, timeToPowerMonths: 24, onsiteGenerationFriendly: true,
    fiberDensityScore: 38, peeringExchangeCount: 1,
    largeParcelCount: 22, medianLandPricePerAcre: 2800, floodplainPctBlock: 5, hazardScore: 30,
    waterStressScore: 55,
    taxIncentiveScore: 88, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 2, existingDcCapacityMw: 1200,
  },
  {
    fips: "48141", name: "El Paso", state: "TX", lat: 31.762, lng: -106.485,
    iso: "ERCOT", utility: "El Paso Electric",
    queuedLoadMw: 3200, substationHeadroomMva: 450, timeToPowerMonths: 28, onsiteGenerationFriendly: true,
    fiberDensityScore: 52, peeringExchangeCount: 2,
    largeParcelCount: 14, medianLandPricePerAcre: 3400, floodplainPctBlock: 3, hazardScore: 20,
    waterStressScore: 78,
    taxIncentiveScore: 82, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 180,
  },
  {
    fips: "18107", name: "Montgomery", state: "IN", lat: 40.041, lng: -86.902,
    iso: "MISO", utility: "Duke Energy Indiana",
    queuedLoadMw: 2100, substationHeadroomMva: 350, timeToPowerMonths: 32, onsiteGenerationFriendly: false,
    fiberDensityScore: 42, peeringExchangeCount: 0,
    largeParcelCount: 6, medianLandPricePerAcre: 7500, floodplainPctBlock: 8, hazardScore: 15,
    waterStressScore: 20,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "18011", name: "Boone", state: "IN", lat: 40.052, lng: -86.468,
    iso: "MISO", utility: "Duke Energy Indiana / AES",
    queuedLoadMw: 3400, substationHeadroomMva: 500, timeToPowerMonths: 30, onsiteGenerationFriendly: false,
    fiberDensityScore: 58, peeringExchangeCount: 1,
    largeParcelCount: 5, medianLandPricePerAcre: 12000, floodplainPctBlock: 6, hazardScore: 12,
    waterStressScore: 18,
    taxIncentiveScore: 85, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 200,
  },
  {
    fips: "55101", name: "Racine", state: "WI", lat: 42.727, lng: -87.834,
    iso: "MISO", utility: "We Energies",
    queuedLoadMw: 2800, substationHeadroomMva: 620, timeToPowerMonths: 26, onsiteGenerationFriendly: false,
    fiberDensityScore: 62, peeringExchangeCount: 2,
    largeParcelCount: 3, medianLandPricePerAcre: 18000, floodplainPctBlock: 4, hazardScore: 10,
    waterStressScore: 8,
    taxIncentiveScore: 80, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 4, existingDcCapacityMw: 1800,
  },
  {
    fips: "40143", name: "Tulsa", state: "OK", lat: 36.121, lng: -95.943,
    iso: "SPP", utility: "PSO / GRDA",
    queuedLoadMw: 3100, substationHeadroomMva: 480, timeToPowerMonths: 22, onsiteGenerationFriendly: true,
    fiberDensityScore: 60, peeringExchangeCount: 2,
    largeParcelCount: 11, medianLandPricePerAcre: 6800, floodplainPctBlock: 7, hazardScore: 32,
    waterStressScore: 40,
    taxIncentiveScore: 84, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 3, existingDcCapacityMw: 420,
  },
  {
    fips: "28089", name: "Madison", state: "MS", lat: 32.630, lng: -90.030,
    iso: "SERC (Entergy)", utility: "Entergy Mississippi",
    queuedLoadMw: 2400, substationHeadroomMva: 380, timeToPowerMonths: 28, onsiteGenerationFriendly: true,
    fiberDensityScore: 40, peeringExchangeCount: 0,
    largeParcelCount: 9, medianLandPricePerAcre: 5400, floodplainPctBlock: 10, hazardScore: 22,
    waterStressScore: 25,
    taxIncentiveScore: 89, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 250,
  },
  {
    fips: "40027", name: "Cleveland", state: "OK", lat: 35.222, lng: -97.316,
    iso: "SPP", utility: "OG&E",
    queuedLoadMw: 1800, substationHeadroomMva: 320, timeToPowerMonths: 20, onsiteGenerationFriendly: true,
    fiberDensityScore: 55, peeringExchangeCount: 1,
    largeParcelCount: 7, medianLandPricePerAcre: 5900, floodplainPctBlock: 9, hazardScore: 30,
    waterStressScore: 45,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 90,
  },

  // ═══════ TIER 2: PRIMARY — Established but constrained ═══════
  {
    fips: "51107", name: "Loudoun", state: "VA", lat: 39.087, lng: -77.649,
    iso: "PJM", utility: "Dominion Energy",
    queuedLoadMw: 18000, substationHeadroomMva: 120, timeToPowerMonths: 60, onsiteGenerationFriendly: false,
    fiberDensityScore: 98, peeringExchangeCount: 12,
    largeParcelCount: 4, medianLandPricePerAcre: 850000, floodplainPctBlock: 3, hazardScore: 8,
    waterStressScore: 20,
    taxIncentiveScore: 65, moratoriumStatus: "proposed", rightToBuildZoning: false,
    existingDcCount: 200, existingDcCapacityMw: 4039,
  },
  {
    fips: "51153", name: "Prince William", state: "VA", lat: 38.702, lng: -77.475,
    iso: "PJM", utility: "Dominion Energy",
    queuedLoadMw: 11500, substationHeadroomMva: 180, timeToPowerMonths: 54, onsiteGenerationFriendly: false,
    fiberDensityScore: 92, peeringExchangeCount: 6,
    largeParcelCount: 5, medianLandPricePerAcre: 420000, floodplainPctBlock: 5, hazardScore: 10,
    waterStressScore: 22,
    taxIncentiveScore: 68, moratoriumStatus: "proposed", rightToBuildZoning: false,
    existingDcCount: 45, existingDcCapacityMw: 1120,
  },
  {
    fips: "48113", name: "Dallas", state: "TX", lat: 32.776, lng: -96.797,
    iso: "ERCOT", utility: "Oncor",
    queuedLoadMw: 8500, substationHeadroomMva: 240, timeToPowerMonths: 42, onsiteGenerationFriendly: true,
    fiberDensityScore: 95, peeringExchangeCount: 8,
    largeParcelCount: 3, medianLandPricePerAcre: 320000, floodplainPctBlock: 12, hazardScore: 25,
    waterStressScore: 55,
    taxIncentiveScore: 80, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 80, existingDcCapacityMw: 1067,
  },
  {
    fips: "13089", name: "DeKalb", state: "GA", lat: 33.771, lng: -84.226,
    iso: "SERC (Southern)", utility: "Georgia Power",
    queuedLoadMw: 5600, substationHeadroomMva: 200, timeToPowerMonths: 44, onsiteGenerationFriendly: false,
    fiberDensityScore: 90, peeringExchangeCount: 5,
    largeParcelCount: 4, medianLandPricePerAcre: 180000, floodplainPctBlock: 8, hazardScore: 15,
    waterStressScore: 35,
    taxIncentiveScore: 75, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 42, existingDcCapacityMw: 620,
  },
  {
    fips: "04013", name: "Maricopa", state: "AZ", lat: 33.448, lng: -112.074,
    iso: "WECC", utility: "APS / SRP",
    queuedLoadMw: 6800, substationHeadroomMva: 320, timeToPowerMonths: 38, onsiteGenerationFriendly: true,
    fiberDensityScore: 85, peeringExchangeCount: 4,
    largeParcelCount: 12, medianLandPricePerAcre: 42000, floodplainPctBlock: 4, hazardScore: 15,
    waterStressScore: 88,
    taxIncentiveScore: 76, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 55, existingDcCapacityMw: 807,
  },
  {
    fips: "39049", name: "Franklin", state: "OH", lat: 39.969, lng: -83.007,
    iso: "PJM", utility: "AEP Ohio",
    queuedLoadMw: 7200, substationHeadroomMva: 280, timeToPowerMonths: 40, onsiteGenerationFriendly: false,
    fiberDensityScore: 82, peeringExchangeCount: 3,
    largeParcelCount: 9, medianLandPricePerAcre: 65000, floodplainPctBlock: 6, hazardScore: 12,
    waterStressScore: 15,
    taxIncentiveScore: 82, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 25, existingDcCapacityMw: 480,
  },

  // ═══════ TIER 3: EMERGING — Data-rich but earlier-stage ═══════
  {
    fips: "31153", name: "Sarpy", state: "NE", lat: 41.169, lng: -96.111,
    iso: "SPP", utility: "OPPD",
    queuedLoadMw: 2100, substationHeadroomMva: 420, timeToPowerMonths: 24, onsiteGenerationFriendly: true,
    fiberDensityScore: 65, peeringExchangeCount: 2,
    largeParcelCount: 15, medianLandPricePerAcre: 9500, floodplainPctBlock: 8, hazardScore: 18,
    waterStressScore: 22,
    taxIncentiveScore: 84, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 6, existingDcCapacityMw: 750,
  },
  {
    fips: "19169", name: "Story", state: "IA", lat: 42.033, lng: -93.463,
    iso: "MISO", utility: "MidAmerican",
    queuedLoadMw: 1600, substationHeadroomMva: 380, timeToPowerMonths: 26, onsiteGenerationFriendly: true,
    fiberDensityScore: 58, peeringExchangeCount: 1,
    largeParcelCount: 18, medianLandPricePerAcre: 11500, floodplainPctBlock: 6, hazardScore: 12,
    waterStressScore: 15,
    taxIncentiveScore: 88, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 2, existingDcCapacityMw: 340,
  },
  {
    fips: "56025", name: "Natrona", state: "WY", lat: 42.917, lng: -106.667,
    iso: "WECC", utility: "Rocky Mountain Power",
    queuedLoadMw: 1400, substationHeadroomMva: 260, timeToPowerMonths: 22, onsiteGenerationFriendly: true,
    fiberDensityScore: 32, peeringExchangeCount: 0,
    largeParcelCount: 45, medianLandPricePerAcre: 1200, floodplainPctBlock: 2, hazardScore: 8,
    waterStressScore: 55,
    taxIncentiveScore: 72, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 45,
  },
  {
    fips: "47157", name: "Shelby", state: "TN", lat: 35.184, lng: -89.892,
    iso: "TVA", utility: "MLGW / TVA",
    queuedLoadMw: 3800, substationHeadroomMva: 340, timeToPowerMonths: 28, onsiteGenerationFriendly: true,
    fiberDensityScore: 68, peeringExchangeCount: 2,
    largeParcelCount: 8, medianLandPricePerAcre: 24000, floodplainPctBlock: 14, hazardScore: 22,
    waterStressScore: 20,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 3, existingDcCapacityMw: 380,
  },
  {
    fips: "45045", name: "Greenville", state: "SC", lat: 34.852, lng: -82.394,
    iso: "SERC (Duke)", utility: "Duke Energy Carolinas",
    queuedLoadMw: 1900, substationHeadroomMva: 220, timeToPowerMonths: 30, onsiteGenerationFriendly: false,
    fiberDensityScore: 60, peeringExchangeCount: 1,
    largeParcelCount: 6, medianLandPricePerAcre: 38000, floodplainPctBlock: 7, hazardScore: 14,
    waterStressScore: 18,
    taxIncentiveScore: 74, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 3, existingDcCapacityMw: 220,
  },
  {
    fips: "37183", name: "Wake", state: "NC", lat: 35.780, lng: -78.639,
    iso: "SERC (Duke)", utility: "Duke Energy Progress",
    queuedLoadMw: 2600, substationHeadroomMva: 280, timeToPowerMonths: 32, onsiteGenerationFriendly: false,
    fiberDensityScore: 75, peeringExchangeCount: 2,
    largeParcelCount: 5, medianLandPricePerAcre: 95000, floodplainPctBlock: 9, hazardScore: 18,
    waterStressScore: 22,
    taxIncentiveScore: 76, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 8, existingDcCapacityMw: 320,
  },
  {
    fips: "05119", name: "Pulaski", state: "AR", lat: 34.767, lng: -92.291,
    iso: "MISO/SPP", utility: "Entergy Arkansas",
    queuedLoadMw: 2200, substationHeadroomMva: 320, timeToPowerMonths: 26, onsiteGenerationFriendly: true,
    fiberDensityScore: 45, peeringExchangeCount: 1,
    largeParcelCount: 10, medianLandPricePerAcre: 8500, floodplainPctBlock: 11, hazardScore: 20,
    waterStressScore: 20,
    taxIncentiveScore: 82, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 1, existingDcCapacityMw: 60,
  },
  {
    fips: "48029", name: "Bexar", state: "TX", lat: 29.442, lng: -98.494,
    iso: "ERCOT", utility: "CPS Energy",
    queuedLoadMw: 4200, substationHeadroomMva: 380, timeToPowerMonths: 32, onsiteGenerationFriendly: true,
    fiberDensityScore: 78, peeringExchangeCount: 3,
    largeParcelCount: 9, medianLandPricePerAcre: 48000, floodplainPctBlock: 10, hazardScore: 20,
    waterStressScore: 62,
    taxIncentiveScore: 80, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 12, existingDcCapacityMw: 320,
  },

  // ═══════ TIER 4: WATCH — Undervalued, contrarian ═══════
  {
    fips: "35013", name: "Doña Ana", state: "NM", lat: 32.353, lng: -106.809,
    iso: "WECC", utility: "El Paso Electric / PNM",
    queuedLoadMw: 1200, substationHeadroomMva: 240, timeToPowerMonths: 22, onsiteGenerationFriendly: true,
    fiberDensityScore: 42, peeringExchangeCount: 0,
    largeParcelCount: 24, medianLandPricePerAcre: 3600, floodplainPctBlock: 4, hazardScore: 15,
    waterStressScore: 75,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "48375", name: "Potter", state: "TX", lat: 35.401, lng: -101.891,
    iso: "SPP", utility: "Xcel Energy",
    queuedLoadMw: 900, substationHeadroomMva: 320, timeToPowerMonths: 18, onsiteGenerationFriendly: true,
    fiberDensityScore: 35, peeringExchangeCount: 0,
    largeParcelCount: 32, medianLandPricePerAcre: 1900, floodplainPctBlock: 3, hazardScore: 22,
    waterStressScore: 68,
    taxIncentiveScore: 82, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "20015", name: "Butler", state: "KS", lat: 37.822, lng: -96.836,
    iso: "SPP", utility: "Evergy",
    queuedLoadMw: 1100, substationHeadroomMva: 280, timeToPowerMonths: 20, onsiteGenerationFriendly: true,
    fiberDensityScore: 30, peeringExchangeCount: 0,
    largeParcelCount: 38, medianLandPricePerAcre: 2100, floodplainPctBlock: 5, hazardScore: 25,
    waterStressScore: 35,
    taxIncentiveScore: 68, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "13297", name: "Walton", state: "GA", lat: 33.783, lng: -83.741,
    iso: "SERC (Southern)", utility: "Georgia Power",
    queuedLoadMw: 2400, substationHeadroomMva: 300, timeToPowerMonths: 28, onsiteGenerationFriendly: false,
    fiberDensityScore: 55, peeringExchangeCount: 1,
    largeParcelCount: 12, medianLandPricePerAcre: 24000, floodplainPctBlock: 6, hazardScore: 12,
    waterStressScore: 32,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 2, existingDcCapacityMw: 140,
  },
  {
    fips: "17197", name: "Will", state: "IL", lat: 41.406, lng: -87.996,
    iso: "PJM/MISO", utility: "ComEd",
    queuedLoadMw: 4600, substationHeadroomMva: 260, timeToPowerMonths: 36, onsiteGenerationFriendly: false,
    fiberDensityScore: 78, peeringExchangeCount: 3,
    largeParcelCount: 8, medianLandPricePerAcre: 42000, floodplainPctBlock: 8, hazardScore: 14,
    waterStressScore: 18,
    taxIncentiveScore: 78, moratoriumStatus: "none", rightToBuildZoning: true,
    existingDcCount: 6, existingDcCapacityMw: 380,
  },
  {
    fips: "27053", name: "Hennepin", state: "MN", lat: 45.070, lng: -93.446,
    iso: "MISO", utility: "Xcel Energy",
    queuedLoadMw: 1900, substationHeadroomMva: 240, timeToPowerMonths: 30, onsiteGenerationFriendly: false,
    fiberDensityScore: 82, peeringExchangeCount: 3,
    largeParcelCount: 5, medianLandPricePerAcre: 68000, floodplainPctBlock: 7, hazardScore: 10,
    waterStressScore: 12,
    taxIncentiveScore: 65, moratoriumStatus: "proposed", rightToBuildZoning: false,
    existingDcCount: 4, existingDcCapacityMw: 260,
  },

  // ═══════ TIER 5: COLD — Constrained or restricted ═══════
  {
    fips: "23005", name: "Cumberland", state: "ME", lat: 43.786, lng: -70.201,
    iso: "ISO-NE", utility: "Central Maine Power",
    queuedLoadMw: 200, substationHeadroomMva: 80, timeToPowerMonths: 48, onsiteGenerationFriendly: false,
    fiberDensityScore: 55, peeringExchangeCount: 1,
    largeParcelCount: 6, medianLandPricePerAcre: 32000, floodplainPctBlock: 8, hazardScore: 12,
    waterStressScore: 10,
    taxIncentiveScore: 30, moratoriumStatus: "active", rightToBuildZoning: false,
    existingDcCount: 0, existingDcCapacityMw: 0,
  },
  {
    fips: "06085", name: "Santa Clara", state: "CA", lat: 37.354, lng: -121.955,
    iso: "CAISO", utility: "PG&E / SVP",
    queuedLoadMw: 3200, substationHeadroomMva: 80, timeToPowerMonths: 60, onsiteGenerationFriendly: false,
    fiberDensityScore: 96, peeringExchangeCount: 15,
    largeParcelCount: 1, medianLandPricePerAcre: 4200000, floodplainPctBlock: 4, hazardScore: 40,
    waterStressScore: 78,
    taxIncentiveScore: 25, moratoriumStatus: "proposed", rightToBuildZoning: false,
    existingDcCount: 60, existingDcCapacityMw: 489,
  },
  {
    fips: "24005", name: "Baltimore", state: "MD", lat: 39.402, lng: -76.610,
    iso: "PJM", utility: "BGE",
    queuedLoadMw: 1400, substationHeadroomMva: 140, timeToPowerMonths: 44, onsiteGenerationFriendly: false,
    fiberDensityScore: 78, peeringExchangeCount: 3,
    largeParcelCount: 3, medianLandPricePerAcre: 155000, floodplainPctBlock: 9, hazardScore: 15,
    waterStressScore: 15,
    taxIncentiveScore: 55, moratoriumStatus: "proposed", rightToBuildZoning: false,
    existingDcCount: 3, existingDcCapacityMw: 90,
  },
];

// ------------------------------------------------------------
// SIGNALS: real leading-indicator events (curated, illustrative)
// ------------------------------------------------------------
export const SEED_SIGNALS: InsertSignal[] = [
  // Richland Parish (Meta Hyperion — confirmed but signals precede it)
  {
    countyFips: "22083", signalType: "llc_land_purchase", weight: 0.9, leadTimeMonths: 14,
    headline: "Balloonist LLC assembles 3,650 contiguous acres",
    detail: "State-owned failed auto plant site quietly re-optioned. Cross-reference to Meta via CSC agent + Menlo Park HQ.",
    suspectedOperator: "Meta", shellLlc: "Balloonist LLC", parcelAcres: 3650,
    detectedAt: "2024-08-12", confidence: 0.95,
    sourceUrl: "https://datacenterexposed.com/entities/meta-platforms", sourceName: "DataCentersExposed",
  },
  {
    countyFips: "22083", signalType: "substation_filing", weight: 0.85, leadTimeMonths: 12,
    headline: "Entergy files 500 kV / 240-mile line at LPSC",
    detail: "Meta funds >5,200 MW gas + 240 mi transmission — public utility filing preceded announcement.",
    suspectedOperator: "Meta", parcelAcres: null,
    detectedAt: "2024-11-03", confidence: 0.9,
    sourceUrl: "https://www.morningstar.com/news/dow-jones/202603275997/", sourceName: "Morningstar",
  },
  {
    countyFips: "22083", signalType: "incentive_deal", weight: 0.8, leadTimeMonths: 8,
    headline: "$3.3B state incentive package on Opportunity LA agenda",
    detail: "PILOT + sales tax + ITEP filed under code name 'Hyperion'.",
    suspectedOperator: "Meta", parcelAcres: null,
    detectedAt: "2025-03-15", confidence: 0.85,
    sourceUrl: "https://www.opportunitylouisiana.gov/", sourceName: "Opportunity Louisiana",
  },

  // Taylor County TX (Abilene / Stargate)
  {
    countyFips: "48441", signalType: "interconnection_request", weight: 0.85, leadTimeMonths: 18,
    headline: "1,200 MW large-load ERCOT interconnection request",
    detail: "Filed by Crusoe / SB Investment Advisers proxy. Behind-the-meter gas paired.",
    suspectedOperator: "OpenAI / Stargate", parcelAcres: null,
    detectedAt: "2024-10-22", confidence: 0.9,
    sourceUrl: "https://www.ercot.com/gridinfo/resource", sourceName: "ERCOT LLIS",
  },
  {
    countyFips: "48441", signalType: "rezoning", weight: 0.75, leadTimeMonths: 10,
    headline: "1,050-acre rezoning to heavy industrial approved",
    detail: "Setbacks (200 ft), noise limits, water study attached — standard hyperscaler ordinance signature.",
    suspectedOperator: "OpenAI / Stargate", parcelAcres: 1050,
    detectedAt: "2025-02-18", confidence: 0.8,
    sourceUrl: null, sourceName: "Taylor County Planning",
  },

  // Montgomery IN — early-stage
  {
    countyFips: "18107", signalType: "llc_land_purchase", weight: 0.85, leadTimeMonths: 14,
    headline: "Jasmine Development LLC acquires 1,120 acres",
    detail: "Delaware LLC registered to CSC agent; manager cross-references to Google real estate counsel.",
    suspectedOperator: "Google (Alphabet)", shellLlc: "Jasmine Development LLC", parcelAcres: 1120,
    detectedAt: "2026-03-08", confidence: 0.75,
    sourceUrl: "https://venturebeat.com/ai/documents-show-how-google-used-shell-companies-to-keep-datacenter-negotiations-quiet", sourceName: "VentureBeat",
  },
  {
    countyFips: "18107", signalType: "water_permit", weight: 0.65, leadTimeMonths: 12,
    headline: "Water study filed for 2M gpd industrial withdrawal",
    detail: "Applicant listed as 'Jasmine Development LLC'; standard trigger for large closed-loop DC.",
    suspectedOperator: "Google (Alphabet)", parcelAcres: null,
    detectedAt: "2026-04-22", confidence: 0.7,
    sourceUrl: null, sourceName: "Indiana DNR",
  },

  // Boone IN (Meta Lebanon — under construction)
  {
    countyFips: "18011", signalType: "codename_resolved", weight: 1.0, leadTimeMonths: 6,
    headline: "'Project Anthem' unmasked as Meta",
    detail: "1,500-acre Meta Lebanon campus; $10B+ commitment; construction start Feb 2026.",
    suspectedOperator: "Meta", parcelAcres: 1500,
    detectedAt: "2026-01-30", confidence: 1.0,
    sourceUrl: "https://www.irecruit.co/insights/hyperscale-data-center-news-tracking-mega-builds", sourceName: "iRecruit",
  },

  // Racine WI — Microsoft Fairwater
  {
    countyFips: "55101", signalType: "building_permit", weight: 0.9, leadTimeMonths: 3,
    headline: "Microsoft awarded 15 additional DC building permits",
    detail: "Foxconn site conversion; Jan 2026 approval brings total to 16 buildings.",
    suspectedOperator: "Microsoft", parcelAcres: 1200,
    detectedAt: "2026-01-26", confidence: 1.0,
    sourceUrl: "https://www.cnbc.com/2026/01/26/microsoft-wins-approval-for-15-data-centers-at-wisconsin-foxconn-site.html", sourceName: "CNBC",
  },

  // Tulsa OK — Meta "Project Anthem" Tulsa
  {
    countyFips: "40143", signalType: "llc_land_purchase", weight: 0.85, leadTimeMonths: 12,
    headline: "Toreak Acquisition LLC options 1,800 acres near Tulsa",
    detail: "Clean-energy paired campus; 1,500+ MW target. LLC pattern matches Meta portfolio.",
    suspectedOperator: "Meta", shellLlc: "Toreak Acquisition", parcelAcres: 1800,
    detectedAt: "2025-11-14", confidence: 0.8,
    sourceUrl: "https://datacenterexposed.com/entities/meta-platforms", sourceName: "DataCentersExposed",
  },
  {
    countyFips: "40143", signalType: "interconnection_request", weight: 0.85, leadTimeMonths: 15,
    headline: "1,500 MW SPP interconnection study request",
    detail: "SPP's expedited large-load review lane accepted the study — 22-month energization estimate.",
    suspectedOperator: "Meta", parcelAcres: null,
    detectedAt: "2025-09-04", confidence: 0.75,
    sourceUrl: "https://spp.org/", sourceName: "SPP",
  },

  // El Paso TX — Meta "Project Jupiter"
  {
    countyFips: "48141", signalType: "codename_resolved", weight: 0.95, leadTimeMonths: 4,
    headline: "'Project Jupiter' El Paso resolved to Meta",
    detail: "Borderplex Digital Assets LLC (fka El Paso Digital Assets LLC); ~1,039 acres.",
    suspectedOperator: "Meta", shellLlc: "Borderplex Digital Assets", parcelAcres: 1039,
    detectedAt: "2025-09-18", confidence: 0.95,
    sourceUrl: "https://elpasonews.org/2025/09/18/project-jupiter-the-el-paso-connection-to-the-santa-teresa-data-center/", sourceName: "El Paso News",
  },

  // Doña Ana NM — Meta Santa Teresa (paired with El Paso)
  {
    countyFips: "35013", signalType: "rezoning", weight: 0.7, leadTimeMonths: 10,
    headline: "Santa Teresa industrial-park expansion approved",
    detail: "Paired with El Paso Project Jupiter; 400+ acre expansion for utility/tech use.",
    suspectedOperator: "Meta", parcelAcres: 420,
    detectedAt: "2025-11-02", confidence: 0.7,
    sourceUrl: null, sourceName: "Doña Ana County Planning",
  },

  // Sarpy NE — existing Google + Meta cluster
  {
    countyFips: "31153", signalType: "llc_land_purchase", weight: 0.8, leadTimeMonths: 10,
    headline: "Fireball Group closes on 640 additional acres",
    detail: "Google shell across NE counties (Fireball / Westwood Solutions / Agate).",
    suspectedOperator: "Google (Alphabet)", shellLlc: "Fireball Group", parcelAcres: 640,
    detectedAt: "2026-02-12", confidence: 0.85,
    sourceUrl: "https://nebraskapublicmedia.org/en/news/news-articles/facebook-google-data-centers-among-latest-developments-transforming-nebraska-farmland/", sourceName: "Nebraska Public Media",
  },

  // Story IA — undisclosed
  {
    countyFips: "19169", signalType: "interconnection_request", weight: 0.7, leadTimeMonths: 16,
    headline: "MidAmerican files 800 MW large-load study",
    detail: "Anonymous applicant; matches historic pre-announcement pattern for Microsoft/Google.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-05-01", confidence: 0.6,
    sourceUrl: null, sourceName: "MidAmerican Energy",
  },

  // Loudoun VA — cluster confirmatory
  {
    countyFips: "51107", signalType: "interconnection_request", weight: 0.4, leadTimeMonths: 60,
    headline: "Dominion pauses new DC connections; batching study",
    detail: "60-month time-to-power now baseline; queue depth is a demand signal, not supply. Loudoun deprioritized.",
    suspectedOperator: "multiple", parcelAcres: null,
    detectedAt: "2026-03-20", confidence: 0.9,
    sourceUrl: "https://www.cbre.com/insights/local-response/north-america-data-center-trends-h1-2025-market-profiles-northern-virginia", sourceName: "CBRE NoVA H1 2025",
  },

  // Cumberland ME — cold signal (moratorium)
  {
    countyFips: "23005", signalType: "rezoning", weight: 0.1, leadTimeMonths: 0,
    headline: "LD 307 moratorium — no DCs >20 MW until Nov 2027",
    detail: "Statewide restriction. County functionally cold for large-load prospects.",
    suspectedOperator: null, parcelAcres: null,
    detectedAt: "2026-04-15", confidence: 1.0,
    sourceUrl: "https://www.theaiconsultingnetwork.com/blog/data-center-moratorium-bills-states-cre-investors-2026", sourceName: "AI Consulting Network",
  },

  // Bexar TX — San Antonio quiet buildup
  {
    countyFips: "48029", signalType: "interconnection_request", weight: 0.7, leadTimeMonths: 20,
    headline: "CPS Energy filed six >100 MW large-load applications",
    detail: "Total ~1,400 MW across multiple parcels; classic pre-hyperscaler footprint.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-04-08", confidence: 0.65,
    sourceUrl: null, sourceName: "CPS Energy filings",
  },

  // Shelby TN — xAI Colossus adjacency
  {
    countyFips: "47157", signalType: "substation_filing", weight: 0.75, leadTimeMonths: 10,
    headline: "MLGW / TVA joint 500 kV substation upgrade",
    detail: "Direct-fund model; aligns with xAI Colossus expansion + secondary hyperscaler pull.",
    suspectedOperator: "xAI", parcelAcres: null,
    detectedAt: "2026-05-30", confidence: 0.7,
    sourceUrl: null, sourceName: "TVA IRP filing",
  },

  // -----------------------------------------------------------------
  // Recent-window clusters (last 90 days from 2026-07-04) — fires trigger alerts
  // -----------------------------------------------------------------

  // Richland Parish 22083 (Meta Hyperion — expansion phase)
  {
    countyFips: "22083", signalType: "building_permit", weight: 0.7, leadTimeMonths: 4,
    headline: "Phase-2 shell permit issued for two additional buildings",
    detail: "Contractor Rogers-O'Brien pulled foundation permits for buildings 3 & 4 on the Balloonist parcel.",
    suspectedOperator: "Meta", shellLlc: "Balloonist LLC", parcelAcres: null,
    detectedAt: "2026-05-14", confidence: 0.85,
    sourceUrl: null, sourceName: "Richland Parish Building Dept",
  },
  {
    countyFips: "22083", signalType: "water_permit", weight: 0.65, leadTimeMonths: 5,
    headline: "LDEQ groundwater withdrawal permit expanded 42%",
    detail: "Cooling-loop expansion filed under Hyperion project; new draw allowance 8.4 MGD.",
    suspectedOperator: "Meta", parcelAcres: null,
    detectedAt: "2026-06-02", confidence: 0.8,
    sourceUrl: null, sourceName: "LDEQ water register",
  },
  {
    countyFips: "22083", signalType: "interconnection_request", weight: 0.85, leadTimeMonths: 10,
    headline: "Entergy queues additional 750 MW at Hyperion substation",
    detail: "Behind-the-meter gas + grid tie-in filed. Suspected phase-3 capacity.",
    suspectedOperator: "Meta", parcelAcres: null,
    detectedAt: "2026-06-18", confidence: 0.75,
    sourceUrl: null, sourceName: "MISO queue",
  },

  // Taylor County TX 48441 (Stargate / Abilene)
  {
    countyFips: "48441", signalType: "rezoning", weight: 0.75, leadTimeMonths: 6,
    headline: "County commissioners approve 640-acre rezoning north of site",
    detail: "Adjacent parcels flipped to industrial. Fits Stargate campus expansion pattern.",
    suspectedOperator: "OpenAI (Oracle/Crusoe)", parcelAcres: 640,
    detectedAt: "2026-05-08", confidence: 0.7,
    sourceUrl: null, sourceName: "Taylor County Commissioners",
  },
  {
    countyFips: "48441", signalType: "building_permit", weight: 0.65, leadTimeMonths: 3,
    headline: "Crusoe files 400 MW mechanical shell permits",
    detail: "Third and fourth building shells on the Abilene campus.",
    suspectedOperator: "Crusoe", parcelAcres: null,
    detectedAt: "2026-05-27", confidence: 0.85,
    sourceUrl: null, sourceName: "Abilene Reporter-News",
  },
  {
    countyFips: "48441", signalType: "llc_land_purchase", weight: 0.85, leadTimeMonths: 12,
    headline: "Lancium-linked LLC acquires 220 acres of adjacent ranch land",
    detail: "Filing agent overlaps with prior Stargate assemblies. Suspected co-location tenant.",
    suspectedOperator: "unknown", shellLlc: "Ridgeline Basin LLC", parcelAcres: 220,
    detectedAt: "2026-06-11", confidence: 0.65,
    sourceUrl: null, sourceName: "Taylor County Recorder",
  },

  // Loudoun VA 51107 (Data Center Alley)
  {
    countyFips: "51107", signalType: "interconnection_request", weight: 0.7, leadTimeMonths: 24,
    headline: "Dominion queues 900 MW across three new Loudoun points",
    detail: "PJM queue additions tied to Ashburn / Sterling substation upgrades.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-05-19", confidence: 0.75,
    sourceUrl: null, sourceName: "PJM queue",
  },
  {
    countyFips: "51107", signalType: "rezoning", weight: 0.6, leadTimeMonths: 8,
    headline: "Board of Supervisors approves DCO expansion, 385 acres",
    detail: "Data Center Overlay expansion northwest of Route 606 corridor.",
    suspectedOperator: "unknown", parcelAcres: 385,
    detectedAt: "2026-06-05", confidence: 0.8,
    sourceUrl: null, sourceName: "Loudoun Now",
  },
  {
    countyFips: "51107", signalType: "substation_filing", weight: 0.7, leadTimeMonths: 14,
    headline: "Dominion files new 500-230 kV Poland Hill delivery station",
    detail: "Serves cluster of announced but unnamed data center campuses.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-06-22", confidence: 0.7,
    sourceUrl: null, sourceName: "Dominion filings",
  },

  // Maricopa AZ 04013 (Phoenix metro)
  {
    countyFips: "04013", signalType: "llc_land_purchase", weight: 0.8, leadTimeMonths: 10,
    headline: "Design LLC picks up 340 acres in Buckeye",
    detail: "Filing agent matches Google shell pattern. Fiber conduit adjacent to APS Palo Verde tie-in.",
    suspectedOperator: "Google (Alphabet)", shellLlc: "Design LLC", parcelAcres: 340,
    detectedAt: "2026-05-11", confidence: 0.8,
    sourceUrl: null, sourceName: "Maricopa County Recorder",
  },
  {
    countyFips: "04013", signalType: "water_permit", weight: 0.7, leadTimeMonths: 6,
    headline: "ADWR designation review flagged for Buckeye parcels",
    detail: "Water-availability determination pending; adjacent moratoria in effect.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-06-04", confidence: 0.6,
    sourceUrl: null, sourceName: "Arizona Republic",
  },
  {
    countyFips: "04013", signalType: "incentive_deal", weight: 0.6, leadTimeMonths: 4,
    headline: "Buckeye council approves DFCE tax abatement for 'Project Sun'",
    detail: "Data-center foreign trade zone incentive. Code name suggests hyperscaler campus.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-06-16", confidence: 0.65,
    sourceUrl: null, sourceName: "Buckeye AZ council minutes",
  },

  // Douglas GA 13089 (Atlanta corridor)
  {
    countyFips: "13089", signalType: "rezoning", weight: 0.65, leadTimeMonths: 6,
    headline: "DeKalb rezones 210 acres along Chapel Hill Rd",
    detail: "M-1 industrial with data-center use permitted by right. Third parcel this quarter.",
    suspectedOperator: "unknown", parcelAcres: 210,
    detectedAt: "2026-05-05", confidence: 0.7,
    sourceUrl: null, sourceName: "Local zoning bulletin",
  },
  {
    countyFips: "13089", signalType: "llc_land_purchase", weight: 0.75, leadTimeMonths: 9,
    headline: "QTS-linked LLC acquires 180 acres near Lithonia",
    detail: "QTS parent Blackstone continues Atlanta buildout. Substation adjacency.",
    suspectedOperator: "QTS (Blackstone)", shellLlc: "LSN Holdings LLC", parcelAcres: 180,
    detectedAt: "2026-06-01", confidence: 0.75,
    sourceUrl: null, sourceName: "DeKalb County Recorder",
  },
  {
    countyFips: "13089", signalType: "substation_filing", weight: 0.7, leadTimeMonths: 12,
    headline: "Georgia Power files 230 kV substation off I-20",
    detail: "Load addition tied to unnamed 'large industrial customer' per PSC filing.",
    suspectedOperator: "unknown", parcelAcres: null,
    detectedAt: "2026-06-24", confidence: 0.7,
    sourceUrl: null, sourceName: "GA PSC filing",
  },
];

// ------------------------------------------------------------
// PARCELS: parcel-level candidates in hot counties
// ------------------------------------------------------------
export const SEED_PARCELS: InsertParcel[] = [
  {
    countyFips: "48441", apn: "R00185421", acres: 1050,
    ownerName: "Sagebrush Land Holdings LLC", ownerIsShellLlc: true, resolvedOperator: "OpenAI / Stargate",
    substationDistanceMi: 0.8, fiberDistanceMi: 2.4, zoning: "Heavy Industrial",
    landPrice: 3200000, lastTransferDate: "2024-09-01", parcelScore: 92, status: "rezoning",
  },
  {
    countyFips: "48441", apn: "R00191203", acres: 620,
    ownerName: "Private (undisclosed)", ownerIsShellLlc: false, resolvedOperator: null,
    substationDistanceMi: 1.4, fiberDistanceMi: 4.1, zoning: "Agricultural",
    landPrice: 1850000, lastTransferDate: "2022-03-15", parcelScore: 78, status: "watch",
  },
  {
    countyFips: "22083", apn: "042-00081", acres: 2200,
    ownerName: "Balloonist LLC", ownerIsShellLlc: true, resolvedOperator: "Meta",
    substationDistanceMi: 0.4, fiberDistanceMi: 3.2, zoning: "Utility Overlay",
    landPrice: 9500000, lastTransferDate: "2024-06-11", parcelScore: 97, status: "announced",
  },
  {
    countyFips: "22083", apn: "042-00082", acres: 1450,
    ownerName: "Balloonist LLC", ownerIsShellLlc: true, resolvedOperator: "Meta",
    substationDistanceMi: 0.6, fiberDistanceMi: 3.4, zoning: "Utility Overlay",
    landPrice: 6100000, lastTransferDate: "2024-06-11", parcelScore: 96, status: "announced",
  },
  {
    countyFips: "40143", apn: "OS-14210", acres: 1800,
    ownerName: "Toreak Acquisition LLC", ownerIsShellLlc: true, resolvedOperator: "Meta",
    substationDistanceMi: 0.9, fiberDistanceMi: 1.8, zoning: "Light Industrial",
    landPrice: 12240000, lastTransferDate: "2025-10-30", parcelScore: 89, status: "assembling",
  },
  {
    countyFips: "18107", apn: "IN-107-4421", acres: 1120,
    ownerName: "Jasmine Development LLC", ownerIsShellLlc: true, resolvedOperator: "Google (Alphabet)",
    substationDistanceMi: 1.2, fiberDistanceMi: 2.8, zoning: "Agricultural (rezoning pending)",
    landPrice: 8400000, lastTransferDate: "2026-02-28", parcelScore: 86, status: "rezoning",
  },
  {
    countyFips: "18011", apn: "BC-011-3120", acres: 1500,
    ownerName: "Meta Platforms Inc.", ownerIsShellLlc: false, resolvedOperator: "Meta",
    substationDistanceMi: 0.3, fiberDistanceMi: 1.1, zoning: "Industrial",
    landPrice: 18000000, lastTransferDate: "2025-06-14", parcelScore: 98, status: "announced",
  },
  {
    countyFips: "48141", apn: "EP-141-9040", acres: 1039,
    ownerName: "Borderplex Digital Assets LLC", ownerIsShellLlc: true, resolvedOperator: "Meta",
    substationDistanceMi: 0.5, fiberDistanceMi: 3.0, zoning: "Industrial",
    landPrice: 3530000, lastTransferDate: "2025-08-04", parcelScore: 93, status: "announced",
  },
  {
    countyFips: "31153", apn: "SP-153-7011", acres: 640,
    ownerName: "Fireball Group LLC", ownerIsShellLlc: true, resolvedOperator: "Google (Alphabet)",
    substationDistanceMi: 0.7, fiberDistanceMi: 1.4, zoning: "Industrial",
    landPrice: 6080000, lastTransferDate: "2026-02-12", parcelScore: 90, status: "assembling",
  },
  {
    countyFips: "48029", apn: "BX-029-1120", acres: 880,
    ownerName: "Private trust", ownerIsShellLlc: false, resolvedOperator: null,
    substationDistanceMi: 1.1, fiberDistanceMi: 1.9, zoning: "Mixed Industrial",
    landPrice: 42240000, lastTransferDate: "2018-07-20", parcelScore: 74, status: "watch",
  },
  {
    countyFips: "56025", apn: "NA-025-40011", acres: 4200,
    ownerName: "Old Ranch Holdings LLC", ownerIsShellLlc: false, resolvedOperator: null,
    substationDistanceMi: 2.6, fiberDistanceMi: 8.4, zoning: "Rangeland",
    landPrice: 5040000, lastTransferDate: "2015-04-01", parcelScore: 68, status: "watch",
  },
  {
    countyFips: "48375", apn: "PO-375-2201", acres: 3600,
    ownerName: "Panhandle Land Co.", ownerIsShellLlc: false, resolvedOperator: null,
    substationDistanceMi: 1.4, fiberDistanceMi: 6.2, zoning: "Agricultural",
    landPrice: 6840000, lastTransferDate: "2019-11-11", parcelScore: 72, status: "watch",
  },
];
