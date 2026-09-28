// EOD report submissions, for the Section A items.
//
// Four sheets feed this: a live tracker per team that Zoho writes to, and a
// backfill sheet per team holding the 90 days that existed only inside Zoho
// Forms while both pipes were silently broken. They have three different
// shapes — the BD live sheet has a TWO-row header, the admissions live sheet
// one, and the backfill sheets a different column set again — so columns are
// resolved BY NAME, never by position. A layout change should fail loudly,
// not quietly read a rep as having filed nothing.

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "16-Sep-2026" or "16-Sep-2026 17:39:40" or an ISO date -> YYYY-MM-DD. */
export function eodDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (dmy) {
    const m = MONTHS[dmy[2].toLowerCase()];
    if (!m) return null;
    return `${dmy[3]}-${m}-${dmy[1].padStart(2, "0")}`;
  }
  const isoish = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return isoish ? `${isoish[1]}-${isoish[2]}-${isoish[3]}` : null;
}

export interface EodRow {
  rep: string;
  /** The day the EOD is FOR. */
  date: string;
  /** The day it was actually submitted. Null when the sheet has no timestamp. */
  submittedOn: string | null;
}

const NEEDED = ["date", "rep", "added time"];
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * Rows from a raw values grid.
 *
 * Header detection scans the first few rows for one carrying Date, Rep and
 * Added Time, and takes the LAST such row as the header — the BD live sheet
 * repeats them across two merged header rows, and treating the first as the
 * header would read the second as a submission.
 */
export function parseEodSheet(values: string[][]): EodRow[] {
  const headerIdxs: number[] = [];
  for (let i = 0; i < Math.min(values.length, 5); i++) {
    const cells = (values[i] ?? []).map(norm);
    if (NEEDED.every((n) => cells.includes(n))) headerIdxs.push(i);
  }
  if (headerIdxs.length === 0) {
    throw new Error("EOD sheet has no header row carrying Date, Rep and Added Time");
  }
  const h = headerIdxs[headerIdxs.length - 1];
  const header = (values[h] ?? []).map(norm);
  const col = (name: string) => header.indexOf(name);
  const [cDate, cRep, cAdded] = [col("date"), col("rep"), col("added time")];

  const out: EodRow[] = [];
  for (const row of values.slice(h + 1)) {
    const rep = String(row?.[cRep] ?? "").trim();
    const date = eodDate(row?.[cDate]);
    if (!rep || !date) continue;
    out.push({ rep, date, submittedOn: eodDate(row?.[cAdded]) });
  }
  return out;
}

/**
 * Which sheet rows belong to a roster rep.
 *
 * The BD sheets record first names only ("Mike"), the admissions sheets full
 * names. An ambiguous first name returns null rather than guessing — picking
 * the wrong rep would credit one person's EOD to another.
 */
export function rowsForRep(rows: EodRow[], fullName: string, roster: string[]): EodRow[] | null {
  const target = norm(fullName);
  const first = target.split(/\s+/)[0];
  const sameFirst = roster.filter((r) => norm(r).split(/\s+/)[0] === first);
  const matches = (rep: string) => {
    const r = norm(rep);
    if (r === target) return true;
    return r === first && sameFirst.length === 1;
  };
  if (sameFirst.length > 1 && rows.some((r) => norm(r.rep) === first)) return null;
  return rows.filter((r) => matches(r.rep));
}

export interface EodVerdict {
  /** Days expected but with no submission at all. */
  missing: string[];
  /** Days submitted, but not on the day itself. */
  late: string[];
  /** At least one submission landed in the window. */
  any: boolean;
}

export function judgeEod(expectedDays: string[], rows: EodRow[]): EodVerdict {
  const byDate = new Map<string, EodRow>();
  for (const r of rows) if (!byDate.has(r.date)) byDate.set(r.date, r);
  const missing: string[] = [];
  const late: string[] = [];
  for (const d of expectedDays) {
    const hit = byDate.get(d);
    if (!hit) missing.push(d);
    else if (hit.submittedOn && hit.submittedOn !== d) late.push(d);
  }
  return { missing, late, any: rows.length > 0 };
}

/** Reads a sheet's whole grid. Throws so the caller can DEFER rather than fail a rep. */
export async function fetchEodValues(token: string, sheetId: string): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:ZZ?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`EOD sheet ${sheetId}: ${res.status} ${await res.text()}`);
  return ((await res.json()).values ?? []) as string[][];
}

/** Live tracker + backfill, per team. */
export const EOD_SHEETS: Record<string, string[]> = {
  bd: [
    "1apADovWwSyolG5gtb3VDDHAsaCRMaKT4KxwpbwFUqh8", // EOD BD Report Tracker (live)
    "1E144gyxt74jwPJwnkhrfECDX-lzqHsWoeXQI_Vp4pzM", // BD EOD Submissions (backfill)
  ],
  admissions: [
    "12xw7X6L-hRO1MJ9qgJ6guupCS83f0P8KnRj5Tw44xCI", // EOD Admissions Report Tracker (live)
    "1mvoYZB0yLU7HrObsDmemIlPr8looxYQ_lbxnApp7jE4", // Admissions EOD Submissions (backfill)
  ],
};
