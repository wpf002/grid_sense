// Simple CSV export utility. No dependencies — creates a Blob and triggers download.
// Handles nulls, quotes, commas, newlines.

function escapeCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv<T extends Record<string, unknown>>(
  rows: T[],
  filename: string,
  columns?: Array<{ key: keyof T; label?: string }>,
): void {
  if (!rows.length) {
    // Still allow download of empty CSV with headers if columns given
    if (!columns?.length) return;
  }
  const cols: Array<{ key: keyof T; label?: string }> =
    columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k as keyof T }));
  const header = cols.map((c) => escapeCell(c.label ?? String(c.key))).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCell(row[c.key])).join(","))
    .join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
