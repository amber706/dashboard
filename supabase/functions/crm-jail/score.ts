// Turns fetched Zoho records into the cells that go on a scorecard.
//
// Pure: no network, no Drive. Everything here is decided from data the caller
// already fetched, so the whole scoring surface is testable offline.

import type { CellWrite, Team } from "./sheets.ts";
import {
  cellFor,
  dailyCellFor,
  explanationCellFor,
  headerCell,
  identityCellsFor,
  labelFor,
} from "./sheets.ts";
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

/** Language items are judged on their own; they are never "blank fields". */
const JUDGED_ITEMS = new Set([
  "L26", "L27", "C12", "D22", "D23", "D37", "BC11", "CA7", "CA8", "M7", "M8",
]);

/**
 * Items that scored 0 and are therefore candidates for the policy's
 * documented-blank exemption. Judged items are excluded — a thin note is a
 * thin note, not a blank field.
 */
export function blankCandidates(results: ItemResult[]): string[] {
  return results.filter((r) => r.score === 0 && !JUDGED_ITEMS.has(r.item)).map((r) => r.item);
}

/**
 * Applies the policy's documented-blank rule: a blank the note explains is
 * "not a miss", so it becomes N/A and leaves the denominator entirely rather
 * than counting as earned. N/A is what the template already uses for lines
 * that must not count against a rep.
 */
export function applyExcusedBlanks(
  results: ItemResult[],
  excused: Record<string, { excused: boolean; reason: string }>,
): { results: ItemResult[]; excusedCount: number } {
  let n = 0;
  const out = results.map((r) => {
    const e = excused[r.item];
    if (r.score === 0 && e?.excused) {
      n++;
      return {
        ...r,
        score: "N/A" as const,
        explanation: `Blank explained in the note: ${e.reason}`,
      };
    }
    return r;
  });
  return { results: out, excusedCount: n };
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
/**
 * The sentence written next to a 0.
 *
 * The template tells the auditor: "Every time you score a 0, write what was
 * missing in the Explanation column. That's what the rep gets coached on." A
 * 0 with an empty explanation is an unfinished line, so every 0 gets one —
 * the rule's own words when it has them, otherwise the template's wording for
 * that item.
 */
function reasonFor(team: Team, r: ItemResult): string {
  if (r.explanation) return r.explanation;
  const label = labelFor(team, r.item);
  if (r.reasonKind === "blank") return `${label} is blank on the record.`;
  if (r.reasonKind === "notLinked") return `${label} is not linked on the record.`;
  return `Not met: ${label}.`;
}

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
    if (d.score === 0 || d.explanation) {
      writes.push({ a1: explanationCellFor(team, d.item), value: reasonFor(team, d) });
    }
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
        if (r.score === 0) {
          const list = reasons.get(r.item) ?? [];
          list.push(`#${i + 1}: ${reasonFor(team, r)}`);
          reasons.set(r.item, list);
        }
      }
    });
    for (const [item, list] of reasons) {
      // When every sampled record failed for the same reason, say it once
      // rather than repeating it five times behind record numbers.
      const bare = list.map((t) => t.replace(/^#\d+: /, ""));
      const same = bare.every((t) => t === bare[0]);
      // Name WHICH records failed. "All N sampled" counted the failures, not
      // the sample, so two misses out of five read as every record failing.
      const which = list.map((t) => (t.match(/^(#\d+):/) ?? [])[1]).filter(Boolean);
      const value = same
        ? (list.length === 1 ? bare[0] : `${which.join(", ")}: ${bare[0]}`)
        : list.join(" · ");
      writes.push({ a1: explanationCellFor(team, item), value });
    }
  }

  return { writes, deferredCells: deferred };
}

export { DAILY_RULES, BD_DAILY_RULES };
