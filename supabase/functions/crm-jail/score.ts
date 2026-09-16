// Turns fetched Zoho records into the cells that go on a scorecard.
//
// Pure: no network, no Drive. Everything here is decided from data the caller
// already fetched, so the whole scoring surface is testable offline.

import type { CellWrite, Team } from "./sheets.ts";
import { cellFor, dailyCellFor, explanationCellFor, headerCell, identityCellsFor } from "./sheets.ts";
import type { ItemResult, RecordContext, SampledRecord, Score } from "./types.ts";
import { CONTACT_RULES, DAILY_RULES, DEAL_RULES, LEAD_RULES } from "./rules/admissions.ts";
import { BC_RULES, BD_DAILY_RULES, CALL_RULES, COMPANY_RULES, MEETING_RULES } from "./rules/bd.ts";
import { createdDisplay, zohoUrl } from "./rules/helpers.ts";

type RuleTable = Record<string, (c: RecordContext) => Score | ItemResult>;

/** Scorecard section -> its rule table. */
export const RULES_FOR: Record<Team, Record<string, RuleTable>> = {
  admissions: { Leads: LEAD_RULES, Contacts: CONTACT_RULES, Deals: DEAL_RULES },
  bd: {
    BusinessContacts: BC_RULES,
    Calls: CALL_RULES,
    Companies: COMPANY_RULES,
    Meetings: MEETING_RULES,
  },
};

/** Scorecard section -> the Zoho module it reads, for COQL and record links. */
export const MODULE_FOR: Record<string, string> = {
  Leads: "Leads",
  Contacts: "Contacts",
  Deals: "Deals",
  BusinessContacts: "Contacts",
  Calls: "Calls",
  Companies: "Accounts",
  Meetings: "Events",
};

/** How each module names a record on the identity row. */
export function displayName(section: string, r: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? "").trim();
  switch (section) {
    case "Deals":
      return s(r.Deal_Name);
    case "Companies":
      return s(r.Account_Name);
    case "Calls":
      return s(r.Subject);
    case "Meetings":
      return s(r.Event_Title);
    default:
      return `${s(r.First_Name)} ${s(r.Last_Name)}`.trim();
  }
}

export function toSampledRecord(section: string, r: Record<string, unknown>): SampledRecord {
  const mod = MODULE_FOR[section];
  return {
    record: r as SampledRecord["record"],
    name: displayName(section, r),
    url: zohoUrl(mod, String(r.id)),
    createdDisplay: createdDisplay(String(r.Created_Time ?? "")),
  };
}

/** Runs one section's rule table over one record. */
export function scoreRecord(team: Team, section: string, ctx: RecordContext): ItemResult[] {
  const table = RULES_FOR[team][section];
  if (!table) throw new Error(`No rules for section ${section} on ${team}`);
  return Object.entries(table).map(([item, rule]) => {
    const out = rule(ctx);
    return typeof out === "object" ? { ...out, item } : { item, score: out };
  });
}

export interface SectionResult {
  section: string;
  records: SampledRecord[];
  /** results[recordIndex] = that record's item results */
  results: ItemResult[][];
}

export interface AuditHeader {
  rep: string;
  team: Team;
  auditor: string;
  windowFrom: string;
  windowTo: string;
}

const TEAM_LABEL: Record<Team, string> = {
  admissions: "Admissions",
  bd: "Business Development",
};

/** A scoring cell carries 1, 0, or the literal text N/A. DEFER writes nothing. */
function cellValue(score: Score): string | number | null {
  if (score === 1 || score === 0) return score;
  if (score === "N/A") return "N/A";
  return null; // DEFER — left blank and flagged for the auditor
}

/**
 * Every cell the bot writes. Nothing computed is ever included — writeCells
 * asserts that again before sending, but building it correctly here means the
 * assertion should never fire.
 */
export function buildWrites(
  header: AuditHeader,
  sections: SectionResult[],
  daily: ItemResult[],
): { writes: CellWrite[]; deferredCells: number } {
  const team = header.team;
  const writes: CellWrite[] = [];
  let deferred = 0;

  writes.push(
    { a1: headerCell(team, "rep"), value: header.rep },
    { a1: headerCell(team, "team"), value: TEAM_LABEL[team] },
    { a1: headerCell(team, "auditor"), value: header.auditor },
    { a1: headerCell(team, "dateReviewed"), value: new Date().toISOString().slice(0, 10) },
    { a1: headerCell(team, "windowFrom"), value: header.windowFrom },
    { a1: headerCell(team, "windowTo"), value: header.windowTo },
  );

  for (const d of daily) {
    const v = cellValue(d.score);
    if (v === null) { deferred++; continue; }
    writes.push({ a1: dailyCellFor(team, d.item), value: v });
    if (d.explanation) writes.push({ a1: explanationCellFor(team, d.item), value: d.explanation });
  }

  for (const sec of sections) {
    sec.records.forEach((rec, i) => {
      const id = identityCellsFor(team, sec.section, i);
      writes.push(
        { a1: id.name, value: rec.name },
        { a1: id.link, value: rec.url },
        { a1: id.date, value: rec.createdDisplay },
      );
    });

    // Explanations are per item, not per record, so collect the reasons for
    // every record that failed and write them once.
    const reasons = new Map<string, string[]>();
    sec.results.forEach((itemResults, i) => {
      for (const r of itemResults) {
        const v = cellValue(r.score);
        if (v === null) { deferred++; continue; }
        writes.push({ a1: cellFor(team, r.item, i), value: v });
        if (r.score === 0 && r.explanation) {
          const list = reasons.get(r.item) ?? [];
          list.push(`#${i + 1}: ${r.explanation}`);
          reasons.set(r.item, list);
        }
      }
    });
    for (const [item, list] of reasons) {
      writes.push({ a1: explanationCellFor(team, item), value: list.join(" · ") });
    }
  }

  return { writes, deferredCells: deferred };
}

export { DAILY_RULES, BD_DAILY_RULES };
