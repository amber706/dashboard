// Company holidays, for the EOD items (A2).
//
// Amber, 2026-09-16: Labor Day is an excused absence, and the observed set is
// "standard major US holidays". A missing EOD on one of these is NOT a miss.
//
// Computed per year rather than hardcoded, so the audit does not quietly start
// failing people the first January nobody remembered to extend a list.
//
// Dates are Phoenix calendar days, matching the rest of the bot.

/** Nth weekday of a month, e.g. nth(2026, 9, 1, 1) = first Monday of September. */
function nth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + shift + (n - 1) * 7));
}

/** Last given weekday of a month, e.g. last Monday in May. */
function last(year: number, month: number, weekday: number): Date {
  const eom = new Date(Date.UTC(year, month, 0));
  const back = (eom.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, eom.getUTCDate() - back));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A fixed-date holiday is observed on the nearest weekday: Saturday moves to
 * the Friday before, Sunday to the Monday after. Without this, July 4 2026 —
 * a Saturday, observed Friday July 3 — would mark everyone absent on the 3rd.
 */
function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - 86_400_000);
  if (dow === 0) return new Date(d.getTime() + 86_400_000);
  return d;
}

export interface Holiday {
  date: string;
  name: string;
}

/** The observed holidays for one year, as Phoenix calendar dates. */
export function holidaysFor(year: number): Holiday[] {
  return [
    { date: iso(observed(new Date(Date.UTC(year, 0, 1)))), name: "New Year's Day" },
    { date: iso(last(year, 5, 1)), name: "Memorial Day" },
    { date: iso(observed(new Date(Date.UTC(year, 6, 4)))), name: "Independence Day" },
    { date: iso(nth(year, 9, 1, 1)), name: "Labor Day" },
    { date: iso(nth(year, 11, 4, 4)), name: "Thanksgiving" },
    { date: iso(observed(new Date(Date.UTC(year, 11, 25)))), name: "Christmas Day" },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** The holiday on a given YYYY-MM-DD, or null. Spans year boundaries safely. */
export function holidayOn(dateISO: string): Holiday | null {
  const year = Number(dateISO.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    const hit = holidaysFor(y).find((h) => h.date === dateISO);
    if (hit) return hit;
  }
  return null;
}

/**
 * The days a rep is expected to have filed an EOD, inclusive.
 *
 * BD is weekdays only (Amber, 2026-09-16); admissions covers weekends, so it
 * is NOT assumed to follow the same rule and passes weekdaysOnly=false.
 * Holidays drop out either way.
 */
export function expectedEodDays(
  startISO: string,
  endISO: string,
  weekdaysOnly: boolean,
): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${startISO}T00:00:00Z`);
    iso(d) <= endISO;
    d = new Date(d.getTime() + 86_400_000)
  ) {
    const dow = d.getUTCDay();
    if (weekdaysOnly && (dow === 0 || dow === 6)) continue;
    if (holidayOn(iso(d))) continue;
    out.push(iso(d));
  }
  return out;
}
