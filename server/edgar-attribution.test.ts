import { describe, it, expect } from "vitest";
import { attributeFiling, type OperatorDict } from "./edgar-attribution";

const OPERATORS: OperatorDict[] = [
  {
    name: "Meta",
    shellLlcs: ["Raven Northbrook LLC", "Siculus Inc.", "Greater Kudu LLC"],
    codenames: ["Hyperion", "Prometheus"],
  },
  {
    name: "Google (Alphabet)",
    shellLlcs: ["Sharka LLC", "Jet Stream LLC"],
    codenames: [],
  },
  { name: "Core Scientific", shellLlcs: [], codenames: [] },
  { name: "Digital Realty", shellLlcs: [], codenames: [] },
  { name: "Microsoft", shellLlcs: ["Various NDA shells", "Project Pine LLC"], codenames: [] },
];

describe("attributeFiling", () => {
  it("attributes a distinctive shell LLC to its operator", () => {
    const a = attributeFiling("SICULUS, INC. (CIK 0001234567)", OPERATORS);
    expect(a?.operator).toBe("Meta");
    expect(a?.matchType).toBe("shell");
    expect(a?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("attributes a project codename", () => {
    const a = attributeFiling("Prometheus Data Center Holdings LLC", OPERATORS);
    expect(a?.operator).toBe("Meta");
    expect(a?.matchType).toBe("codename");
  });

  it("attributes a parent by full distinctive name", () => {
    const a = attributeFiling("Digital Realty Trust, Inc.", OPERATORS);
    expect(a?.operator).toBe("Digital Realty");
    expect(a?.matchType).toBe("parent");
  });

  it("does NOT match a generic token against an unrelated company", () => {
    // "CoreSite" must not attribute to "Core Scientific" (was a false positive).
    expect(attributeFiling("CoreSite Realty Corporation", OPERATORS)).toBeNull();
    // "Blue Owl Digital Infrastructure" must not attribute to "Digital Realty".
    expect(
      attributeFiling("Blue Owl Digital Infrastructure Trust", OPERATORS),
    ).toBeNull();
  });

  it("ignores non-distinctive placeholder shells", () => {
    // "Various NDA shells" is not a real entity name and must not match.
    expect(attributeFiling("Various Holdings LLC", OPERATORS)).toBeNull();
  });

  it("returns null for an unknown company", () => {
    expect(attributeFiling("Acme Widgets Inc.", OPERATORS)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(attributeFiling("", OPERATORS)).toBeNull();
  });

  it("prefers a shell match over a parent match", () => {
    const ops: OperatorDict[] = [
      { name: "Meta", shellLlcs: ["Meta Special LLC"], codenames: [] },
    ];
    const a = attributeFiling("Meta Special LLC", ops);
    expect(a?.matchType).toBe("shell");
  });
});
