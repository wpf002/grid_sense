// EDGAR shell-LLC attribution — the "hero" signal.
//
// SEC EDGAR full-text search surfaces filings whose company name may be a
// hyperscaler's known shell LLC, a project codename, or the parent itself.
// This module resolves a raw filing's `company` string to a known operator so
// the product can say: "a filing by <shell> — a known <Operator> vehicle —
// was just detected." No competitor productizes this attribution.

export interface OperatorDict {
  name: string;
  shellLlcs: string[];
  codenames: string[];
}

export type AttributionType = "shell" | "codename" | "parent";

export interface Attribution {
  operator: string;
  matchType: AttributionType;
  matchedTerm: string;
  // 0..1 — shell/codename matches are high-confidence; parent-name matches are
  // weaker (the parent files for many reasons unrelated to a new site).
  confidence: number;
}

// Normalize for loose, punctuation-insensitive matching.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|company|co|holdings|group|lp|ltd)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A term must be distinctive enough to attribute on. One-word generic tokens
// (e.g. "design", "various") would over-match, so require the normalized term
// to be multi-word OR reasonably long.
function isDistinctive(term: string): boolean {
  const n = norm(term);
  if (!n) return false;
  if (n.includes("various")) return false; // e.g. "Various NDA shells"
  const words = n.split(" ");
  if (words.length >= 2) return true;
  return n.length >= 5;
}

function containsTerm(haystack: string, term: string): boolean {
  const h = ` ${norm(haystack)} `;
  const t = norm(term);
  if (!t) return false;
  return h.includes(` ${t} `) || h.includes(` ${t}`) || h.includes(`${t} `);
}

/**
 * Attribute a filing's company string to a known operator. Returns the
 * strongest match (shell > codename > parent), or null if none is distinctive.
 */
export function attributeFiling(
  company: string,
  operators: OperatorDict[],
): Attribution | null {
  if (!company) return null;
  const candidates: Attribution[] = [];

  for (const op of operators) {
    for (const shell of op.shellLlcs ?? []) {
      if (isDistinctive(shell) && containsTerm(company, shell)) {
        candidates.push({ operator: op.name, matchType: "shell", matchedTerm: shell, confidence: 0.9 });
      }
    }
    for (const code of op.codenames ?? []) {
      if (isDistinctive(code) && containsTerm(company, code)) {
        candidates.push({ operator: op.name, matchType: "codename", matchedTerm: code, confidence: 0.75 });
      }
    }
    // Parent-name match: use the FULL operator name (minus parentheticals),
    // not a short generic token. Matching "core" against "CoreSite" or
    // "digital" against "Blue Owl Digital Infrastructure" would be a false
    // positive; requiring the whole distinctive name ("core scientific",
    // "digital realty") avoids that. Single short generic names are skipped.
    const brand = op.name.replace(/\s*\(.*\)\s*/g, "").trim();
    if (isDistinctive(brand) && containsTerm(company, brand)) {
      candidates.push({ operator: op.name, matchType: "parent", matchedTerm: brand, confidence: 0.5 });
    }
  }

  if (!candidates.length) return null;
  const rank: Record<AttributionType, number> = { shell: 3, codename: 2, parent: 1 };
  candidates.sort((a, b) => rank[b.matchType] - rank[a.matchType] || b.confidence - a.confidence);
  return candidates[0];
}
