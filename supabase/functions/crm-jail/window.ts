// CRM Jail audit window.
//
// America/Phoenix never observes DST — it is UTC-7 year round. That is why
// this does plain offset arithmetic instead of depending on a tz database.

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuditWindow {
  /** Inclusive Monday, YYYY-MM-DD in Phoenix local terms. */
  startISO: string;
  /** Inclusive Sunday, YYYY-MM-DD in Phoenix local terms. */
  endISO: string;
  /** e.g. "9/7-9/13/2026" — matches existing scorecard file naming. */
  label: string;
}

function toPhoenix(instant: Date): Date {
  return new Date(instant.getTime() - PHOENIX_OFFSET_MS);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortMD(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * The Mon–Sun week immediately before the week containing `runAt`.
 * A Wednesday run therefore audits the week that ended the prior Sunday.
 */
export function auditWindowFor(runAt: Date): AuditWindow {
  const local = toPhoenix(runAt);
  // getUTCDay on the shifted date gives the Phoenix weekday. 0 = Sunday.
  const dow = local.getUTCDay();
  // Days back to this week's Monday. Sunday counts as the 7th day of the week
  // just gone, not the start of a new one.
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(local.getTime() - daysSinceMonday * DAY_MS);
  const start = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return {
    startISO: ymd(start),
    endISO: ymd(end),
    label: `${shortMD(start)}-${shortMD(end)}/${end.getUTCFullYear()}`,
  };
}

/** Zoho COQL bounds: inclusive start-of-Monday to exclusive start-of-next-Monday, Phoenix. */
export function coqlBounds(w: AuditWindow): { from: string; toExclusive: string } {
  const nextMonday = new Date(new Date(`${w.endISO}T00:00:00Z`).getTime() + DAY_MS);
  return {
    from: `${w.startISO}T00:00:00-07:00`,
    toExclusive: `${ymd(nextMonday)}T00:00:00-07:00`,
  };
}
