// CSV export utility. Takes an array of objects + optional column ordering
// and triggers a browser download. Handles quoting, embedded commas /
// newlines / quotes, and null/undefined → empty string.
//
// Usage:
//   downloadCsv("leads-2026-05-01.csv", rows, [
//     { key: "first_name", label: "First name" },
//     { key: "outcome_category", label: "Outcome" },
//   ]);
// If columns are omitted the keys of the first row are used in order.

export interface CsvColumn<T = any> {
  key: keyof T | string;
  label: string;
  // Optional formatter for cell value (e.g. Date → ISO string).
  format?: (value: any, row: T) => string | number | null | undefined;
}

function toCell(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  const s = String(v);
  // Quote if contains comma, quote, or newline; double up internal quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv<T extends Record<string, any>>(rows: T[], columns?: CsvColumn<T>[]): string {
  if (rows.length === 0) return "";
  const cols: CsvColumn<T>[] = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => toCell(c.label)).join(",");
  const body = rows.map((r) =>
    cols.map((c) => {
      const raw = (r as any)[c.key];
      const v = c.format ? c.format(raw, r) : raw;
      return toCell(v);
    }).join(",")
  ).join("\n");
  return header + "\n" + body;
}

export function downloadCsv<T extends Record<string, any>>(
  filename: string,
  rows: T[],
  columns?: CsvColumn<T>[],
): void {
  const csv = rowsToCsv(rows, columns);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so download completes in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
