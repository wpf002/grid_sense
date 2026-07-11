import { describe, it, expect } from "vitest";
import { splitCsv, STATE_NAME_TO_CODE } from "./epa_air_quality";

// The EPA AirData CSV quotes every field, and county names can contain commas
// inside quotes ("DoÃ±a Ana", "St. Mary's"). Mis-splitting shifts every column.
describe("splitCsv", () => {
  it("parses a real EPA AQI row (all fields quoted)", () => {
    const line = `"Alabama","Baldwin",2025,241,174,67,0,0,0,0,87,56,42,0,0,91,150,0`;
    const c = splitCsv(line).map((s) => s.replace(/^"|"$/g, ""));
    expect(c[0]).toBe("Alabama");
    expect(c[1]).toBe("Baldwin");
    expect(c[2]).toBe("2025");
    expect(c[11]).toBe("56"); // 90th percentile AQI
  });

  it("keeps a comma that is inside quotes as part of the field", () => {
    const c = splitCsv(`"Louisiana","St. Martin, Parish",2025,10`).map((s) => s.replace(/^"|"$/g, ""));
    expect(c[1]).toBe("St. Martin, Parish");
    expect(c[2]).toBe("2025");
  });

  it("handles unquoted numeric fields", () => {
    expect(splitCsv("a,b,c")).toEqual(["a", "b", "c"]);
  });
});

describe("STATE_NAME_TO_CODE", () => {
  it("maps full state names EPA uses to 2-letter codes", () => {
    expect(STATE_NAME_TO_CODE["Alabama"]).toBe("AL");
    expect(STATE_NAME_TO_CODE["New York"]).toBe("NY");
    expect(STATE_NAME_TO_CODE["District of Columbia"]).toBe("DC");
  });

  it("covers every US state plus DC", () => {
    // 50 states + DC (two "District ..." spellings collapse to DC).
    expect(new Set(Object.values(STATE_NAME_TO_CODE)).size).toBe(51);
  });
});
