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
  // Seeded with the company's own name/ticker as if they were shells — the
  // exact data-quality trap the "direct" reclassification guards against.
  { name: "Applied Digital", shellLlcs: ["Applied Digital Corp", "APLD"], codenames: [] },
  { name: "Digital Realty", shellLlcs: ["Digital Realty Trust LP"], codenames: [] },
  { name: "Amazon (AWS)", shellLlcs: ["Vadata Inc"], codenames: [] },
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
    // Contains the brand "Digital Realty" → the company's own filing, not a
    // hidden shell. It matched a shellLlcs entry but must be labeled direct.
    expect(a?.matchType).toBe("direct");
  });

  it("REGRESSION: a company filing under its own name is 'direct', never 'shell'", () => {
    // These are public companies filing as themselves. Tagging them SHELL
    // overstated the product's ability to unmask hidden buyers.
    for (const name of ["Applied Digital Corp.", "Digital Realty Trust LP", "TeraWulf Inc."]) {
      const a = attributeFiling(name, OPERATORS);
      if (a) expect(a.matchType, `${name} → ${a.matchType}`).not.toBe("shell");
    }
    expect(attributeFiling("Applied Digital Corp.", OPERATORS)?.matchType).toBe("direct");
  });

  it("still tags a genuine anonymous shell as 'shell'", () => {
    // Vadata reveals nothing about Amazon — this is the real, high-value case.
    const a = attributeFiling("VADATA, INC.", OPERATORS);
    expect(a?.operator).toBe("Amazon (AWS)");
    expect(a?.matchType).toBe("shell");
    expect(a?.confidence).toBeGreaterThanOrEqual(0.9);
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

  it("does not match a word-prefix (design vs designery)", () => {
    const ops: OperatorDict[] = [
      { name: "Google (Alphabet)", shellLlcs: ["Design LLC", "Gable Corp"], codenames: [] },
    ];
    // "designery" and "north gable contractors" must NOT attribute to Google.
    expect(attributeFiling("The Designery illuminated channel letters", ops)).toBeNull();
    // "Gable" is a whole word here, so single-token still matches by default...
    expect(attributeFiling("North Gable Contractors", ops)?.operator).toBe("Google (Alphabet)");
    // ...but multiWordOnly (used for noisy permit text) rejects the single word.
    expect(
      attributeFiling("North Gable Contractors", ops, { multiWordOnly: true }),
    ).toBeNull();
  });

  it("multiWordOnly still matches distinctive multi-word shells", () => {
    const ops: OperatorDict[] = [
      { name: "Meta", shellLlcs: ["Raven Northbrook LLC"], codenames: [] },
    ];
    const a = attributeFiling(
      "Raven Northbrook LLC data center site work",
      ops,
      { multiWordOnly: true },
    );
    expect(a?.operator).toBe("Meta");
  });

  it("prefers a shell match over a parent match", () => {
    const ops: OperatorDict[] = [
      { name: "Meta", shellLlcs: ["Meta Special LLC"], codenames: [] },
    ];
    const a = attributeFiling("Meta Special LLC", ops);
    expect(a?.matchType).toBe("shell");
  });
});
