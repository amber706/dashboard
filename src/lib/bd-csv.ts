// Shared CSV download helper for the BD module.
//
// Every BD table — referrals, top accounts, per-rep, drilldown sheet,
// meetings, account detail tabs — funnels through this so we get
// consistent escaping, line endings, and filename stamping.

export interface CsvColumn<Row> {
  header: string;
  /**
   * Cell value resolver. Return raw value (will be coerced to string).
   * Index is the 0-based position of the row in the export — useful
   * for "Rank" / "#" columns.
   */
  value: (row: Row, index: number) => string | number | null | undefined;
}

/**
 * Build a CSV string from a column spec + rows. Excel-safe escaping:
 * any cell containing comma, quote, or newline is wrapped in quotes
 * and inner quotes are doubled. Values are coerced to strings; null /
 * undefined become empty cells.
 */
export function buildCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((r, i) => columns.map((c) => escape(c.value(r, i))).join(",")).join("\r\n");
  // Excel handles CRLF + UTF-8 BOM cleanly. The BOM keeps non-ASCII
  // characters (specialist names with accents, partner addresses) from
  // mojibake-ing on Windows Excel.
  return "﻿" + head + "\r\n" + body + "\r\n";
}

/**
 * Trigger a download in the browser. Filename auto-stamps with the
 * window range so exports are easy to organize after the fact.
 */
export function downloadCsv(filename: string, csv: string): void {
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

/**
 * Convenience: build + download in one call. Most callers will use this.
 */
export function exportCsv<Row>(filename: string, columns: CsvColumn<Row>[], rows: Row[]): void {
  downloadCsv(filename, buildCsv(columns, rows));
}

/** Today's YYYY-MM-DD for filename suffixes. */
export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Convert an ISO timestamp to a YYYY-MM-DD chunk for filename ranges. */
export function isoToDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}
