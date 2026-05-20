// Standard timeframe presets used everywhere in the BD module that
// reports historical data. Five buttons, same semantics on every page,
// so a manager always knows what "Last 3 months" means.
//
// Semantics are CALENDAR-MONTH based (not rolling-day) so the buckets
// match how Amber + the BD team talk about results in standups:
//
//   This month     → 1st of current month  → end of today
//   Last month     → 1st of previous month → last day of previous month
//   Last 3 months  → 1st of (current − 2)  → end of today  (3 calendar mo)
//   Last 6 months  → 1st of (current − 5)  → end of today  (6 calendar mo)
//   Last year      → 1st of (current − 11) → end of today  (12 calendar mo)
//
// Custom is supported for edge cases. Pages that need different defaults
// (e.g. Meetings, which has past/future spread) keep their own picker.

export type StandardWindowPreset =
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "last_year"
  | "custom";

export interface StandardWindow {
  startIso: string;
  endIso: string;
  /** YYYY-MM-DD slice, for Zoho `date` fields like Refer_Out_Date. */
  startDate: string;
  endDate: string;
  /** Approximate day count, useful for edge fns that accept `days`. */
  days: number;
  /** Human label, e.g. "This month". */
  label: string;
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 19) + "+00:00";
}

function make(start: Date, end: Date, label: string): StandardWindow {
  const startIso = isoUtc(start);
  const endIso = isoUtc(end);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  return {
    startIso,
    endIso,
    startDate: startIso.slice(0, 10),
    endDate: endIso.slice(0, 10),
    days,
    label,
  };
}

export function computeStandardWindow(
  preset: StandardWindowPreset,
  customStart?: string,
  customEnd?: string,
): StandardWindow {
  const now = new Date();
  switch (preset) {
    case "this_month":
      return make(startOfMonth(), endOfToday(), "This month");
    case "last_month": {
      const start = startOfMonth(addMonths(now, -1));
      const end = new Date(startOfMonth().getTime() - 1);
      return make(start, end, "Last month");
    }
    case "last_3_months":
      return make(addMonths(startOfMonth(), -2), endOfToday(), "Last 3 months");
    case "last_6_months":
      return make(addMonths(startOfMonth(), -5), endOfToday(), "Last 6 months");
    case "last_year":
      return make(addMonths(startOfMonth(), -11), endOfToday(), "Last year");
    case "custom": {
      if (customStart && customEnd) {
        return make(new Date(customStart), new Date(customEnd), "Custom");
      }
      return make(startOfMonth(), endOfToday(), "This month");
    }
  }
}

/** UI render order. Last entry is the "Custom" escape hatch.
 *  Labels match Amber's exact spec ("last 12 months" not "last year"). */
export const STANDARD_PRESETS: Array<{ key: StandardWindowPreset; label: string }> = [
  { key: "this_month",    label: "This month" },
  { key: "last_month",    label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "last_6_months", label: "Last 6 months" },
  { key: "last_year",     label: "Last 12 months" },
];

/**
 * For pages that aggregate by calendar month (Account Trends, Strategy),
 * map a preset to the (months, skipLast) pair the edge fn expects.
 *   months    = how many month buckets to fetch
 *   skipLast  = how many trailing buckets to hide from the chart
 * "Last month" requests 2 buckets and hides the current one so a single
 * bar for the previous month renders.
 */
export function presetToMonths(preset: StandardWindowPreset): { months: number; skipLast: number } {
  switch (preset) {
    case "this_month":     return { months: 1, skipLast: 0 };
    case "last_month":     return { months: 2, skipLast: 1 };
    case "last_3_months":  return { months: 3, skipLast: 0 };
    case "last_6_months":  return { months: 6, skipLast: 0 };
    case "last_year":      return { months: 12, skipLast: 0 };
    case "custom":         return { months: 12, skipLast: 0 };
  }
}
