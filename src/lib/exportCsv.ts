// exportCsv — tiny browser-side CSV download helper.
//
// Takes an array of plain objects, derives headers from the keys of the
// first row (or an explicit list when caller wants column ordering),
// emits a Blob, triggers an <a download> click.
//
// Quoting: RFC 4180 — any field containing comma, quote, CR, or LF is
// wrapped in double-quotes with internal quotes doubled. Numbers + booleans
// stringified as-is; null/undefined → empty.

export interface ExportCsvOptions<T> {
  /** Explicit column order. If omitted, derived from Object.keys(rows[0]). */
  columns?: ReadonlyArray<keyof T & string>;
  /** Header row override. Defaults to the column key as-is. */
  headerLabels?: Partial<Record<keyof T & string, string>>;
}

function escape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv<T>(
  filename: string,
  rows: ReadonlyArray<T>,
  opts: ExportCsvOptions<T> = {},
): void {
  if (rows.length === 0) {
    // Still emit a header-only file when caller passed `columns`, otherwise
    // no-op (downloading a literally empty file isn't useful).
    if (!opts.columns) return;
  }
  const firstRow = rows[0] as Record<string, unknown> | undefined;
  const columns = (opts.columns ?? (Object.keys(firstRow ?? {}) as Array<keyof T & string>));
  const headers = columns.map((c) => escape(opts.headerLabels?.[c] ?? c));
  const lines = [headers.join(",")];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(columns.map((c) => escape(r[c as string])).join(","));
  }
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Convenience: build a date-stamped filename like `op-funnel-2026-05-28.csv`. */
export function dateStampedName(prefix: string, isoDate: string = new Date().toISOString().slice(0, 10)): string {
  return `${prefix}-${isoDate}.csv`;
}
