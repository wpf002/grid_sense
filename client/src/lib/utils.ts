import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Turn a machine-cased enum value (CONSTANT_CASE / snake_case / camelCase) into
// readable sentence-case text for display: "SCORE_CHANGE" -> "Score change",
// "under_contract" -> "Under contract", "llcLandPurchase" -> "Llc land purchase".
export function humanize(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
