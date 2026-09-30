// The daily correction list: one rep, one day, only what they can act on.
//
// This is NOT a scorecard and deliberately shares almost nothing with one.
// The weekly audit samples 5 records per section, scores all 28-41 items on
// each, and hands the result to an auditor who decides jail. This runs over
// EVERY record the rep touched yesterday, keeps only the lines that failed,
// and goes straight to the rep so they can fix them the same morning.
//
// Three rules follow from "the rep acts on this unreviewed":
//
//   1. Only score 0 appears. DEFER means the bot could not judge the line —
//      KIPU, the census, a referral packet it cannot identify from a filename.
//      Telling a rep to fix something no one has judged is noise, and roughly
//      50 cells per weekly scorecard are exactly that.
//   2. No notes judging. "Your note lacks a next step" is a model's opinion and
//      belongs in the weekly, where Megan or Aaron sees it before the rep does.
//      A rep who wrote NO note still gets told, because that is a fact — see
//      judged() in rules/admissions.ts, which returns 0 without consulting the
//      judge when the record has no note at all.
//   3. Excused blanks still run. Policy OPS-CRM-001 §2 says a blank the note
//      explains is not a miss; skipping that check would have the bot nag reps
//      daily about fields they already accounted for. That was worth 13-25
//      points against the human auditors on the weekly and would be worse here,
//      because it lands in the rep's inbox instead of an auditor's queue.
//
// There is no calendar logic. A rep who did not work yesterday owns no records
// from yesterday, so they are skipped for the same reason a rep on PTO is —
// weekends and holidays need no special case.

import { labelFor, type Team } from "./sheets.ts";
import { reasonFor } from "./score.ts";
import type { ItemResult, SampledRecord } from "./types.ts";

const DAY_MS = 86_400_000;
/** Arizona does not observe DST, so a fixed offset is correct year round. */
const PHOENIX_OFFSET = "-07:00";

export interface DailyMiss {
  /** "Leads", "Calls", … — the section the record was scored under. */
  section: string;
  recordName: string;
  url: string;
  /** Template item id, e.g. "L4". Reps cite it when they disagree. */
  item: string;
  label: string;
  reason: string;
}

export interface RepDay {
  rep: string;
  team: Team;
  /** Records the rep created or touched on the day. */
  recordsChecked: number;
  misses: DailyMiss[];
  sheetUrl?: string;
  status: "sent" | "dry_run" | "clean" | "no_activity" | "failed";
  error?: string;
}

/**
 * What the dispatcher makes of one child's reply. An unrecognised status is a
 * failure, never "sent": the weekly run's `9 ok / 0 failed` that delivered
 * nothing is what a hopeful default looks like from the outside.
 */
export function repDayFromChild(
  rep: { full_name: string; team: Team },
  httpOk: boolean,
  httpStatus: number,
  b: Record<string, unknown>,
): RepDay {
  const base = { rep: (b.rep as string) ?? rep.full_name, team: rep.team };
  if (!httpOk) {
    return {
      ...base, recordsChecked: 0, misses: [], status: "failed",
      error: String(b.detail ?? b.error ?? `HTTP ${httpStatus}`),
    };
  }
  const known = ["sent", "dry_run", "clean", "no_activity"] as const;
  const status = known.find((k) => k === b.status);
  if (!status) {
    return {
      ...base, recordsChecked: 0, misses: [], status: "failed",
      error: `unexpected child status: ${String(b.status)}`,
    };
  }
  return {
    ...base,
    recordsChecked: Number(b.recordsChecked ?? 0),
    misses: Array.isArray(b.misses) ? (b.misses as DailyMiss[]) : [],
    sheetUrl: b.sheetUrl as string | undefined,
    status,
  };
}

/** The audited day, as COQL bounds. Midnight to midnight, Phoenix. */
export function dailyBounds(dateISO: string): { from: string; toExclusive: string } {
  const next = new Date(new Date(`${dateISO}T00:00:00Z`).getTime() + DAY_MS);
  return {
    from: `${dateISO}T00:00:00${PHOENIX_OFFSET}`,
    toExclusive: `${next.toISOString().slice(0, 10)}T00:00:00${PHOENIX_OFFSET}`,
  };
}

/** The day before `today`, which is the day an 8am run audits. */
export function previousDay(todayISO: string): string {
  return new Date(new Date(`${todayISO}T00:00:00Z`).getTime() - DAY_MS)
    .toISOString().slice(0, 10);
}

/** "Wed, Sep 24, 2026" — how the date reads in the sheet and the email. */
export function dayLabel(dateISO: string): string {
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Turns one section's scoring output into the misses worth sending.
 *
 * `results[i]` are the item results for `records[i]`, which is the shape
 * scoreRecord already produces per section.
 */
export function missesFor(
  team: Team,
  section: string,
  records: SampledRecord[],
  results: ItemResult[][],
): DailyMiss[] {
  const out: DailyMiss[] = [];
  records.forEach((rec, i) => {
    const forRecord: DailyMiss[] = [];
    for (const r of results[i] ?? []) {
      // 0 only. "N/A" does not apply, 1 passed, and "DEFER" means nobody has
      // judged it yet — none of the three is something a rep can act on.
      if (r.score !== 0) continue;
      forRecord.push({
        section,
        recordName: rec.name,
        url: rec.url,
        item: r.item,
        label: labelFor(team, r.item),
        reason: reasonFor(team, r),
      });
    }
    out.push(...relevantMisses(section, rec.record, forRecord));
  });
  return out;
}

/** Misses grouped by record, in the order the records were scored. */
export function byRecord(misses: DailyMiss[]): Array<{
  section: string;
  recordName: string;
  url: string;
  misses: DailyMiss[];
}> {
  const order: string[] = [];
  const groups = new Map<string, { section: string; recordName: string; url: string; misses: DailyMiss[] }>();
  for (const m of misses) {
    if (!groups.has(m.url)) {
      order.push(m.url);
      groups.set(m.url, { section: m.section, recordName: m.recordName, url: m.url, misses: [] });
    }
    groups.get(m.url)!.misses.push(m);
  }
  return order.map((u) => groups.get(u)!);
}

/**
 * The rep's sheet. One row per missing field rather than per record: a rep
 * works down a list, and a cell holding six bullet points is harder to work
 * through than six rows.
 */
export function buildDailyRows(
  rep: string,
  dateISO: string,
  recordsChecked: number,
  misses: DailyMiss[],
): string[][] {
  const groups = byRecord(misses);
  const head = [
    [`CRM corrections for ${rep} — ${dayLabel(dateISO)}`],
    [
      `${recordsChecked} record${recordsChecked === 1 ? "" : "s"} checked · ` +
      `${groups.length} need${groups.length === 1 ? "s" : ""} a fix · ` +
      `${misses.length} field${misses.length === 1 ? "" : "s"} to complete`,
    ],
    [
      "Fix these in Zoho today. This is a correction list, not a score — it does " +
      "not affect your weekly audit or CRM Jail.",
    ],
    [],
    ["Record", "Type", "Item", "What's missing", "Open in Zoho"],
  ];
  const body = groups.flatMap((g) =>
    g.misses.map((m, i) => [
      // The record name repeats only on its first row so the list reads as
      // blocks of work rather than a wall of the same name.
      i === 0 ? g.recordName : "",
      i === 0 ? singular(g.section) : "",
      m.item,
      m.reason,
      i === 0 ? g.url : "",
    ])
  );
  return [...head, ...body];
}

/** "Leads" -> "Lead". The sheet names one record per row, not a section. */
export function singular(section: string): string {
  if (section === "BusinessContacts") return "Business Contact";
  if (section === "Companies") return "Company";
  return section.endsWith("s") ? section.slice(0, -1) : section;
}

/**
 * The body of Google's share email — for most reps this is the whole
 * interaction, so it has to stand alone without the sheet.
 *
 * Drive truncates a long emailMessage, so the list is capped and the remainder
 * is counted rather than silently dropped.
 */
export function buildDailyMessage(
  rep: string,
  dateISO: string,
  recordsChecked: number,
  misses: DailyMiss[],
  maxRecords = 8,
): string {
  const groups = byRecord(misses);
  const first = rep.split(" ")[0];
  const lines = groups.slice(0, maxRecords).map((g) =>
    `• ${g.recordName} (${singular(g.section)}) — ${g.misses.map((m) => m.label).join(", ")}`
  );
  const more = groups.length - lines.length;
  return [
    `${first}, here are your CRM corrections for ${dayLabel(dateISO)}.`,
    "",
    `Of the ${recordsChecked} record${recordsChecked === 1 ? "" : "s"} you worked, ` +
    `${groups.length} need${groups.length === 1 ? "s" : ""} something filled in:`,
    "",
    ...lines,
    ...(more > 0 ? [`• …and ${more} more — see the sheet.`] : []),
    "",
    "The attached sheet lists every field with a link straight to the record.",
    "",
    "This is a correction list, not a score. It does not affect your weekly " +
    "audit or CRM Jail — fixing these today is what keeps them off it.",
  ].join("\n");
}

/** The manager's one-per-day view. Employee-level counts only, no client data. */
export function buildDigestRows(dateISO: string, days: RepDay[]): string[][] {
  const ranked = [...days].sort((a, b) => b.misses.length - a.misses.length);
  const totalMisses = days.reduce((n, d) => n + d.misses.length, 0);
  const worked = days.filter((d) => d.status !== "no_activity").length;
  return [
    [`CRM daily corrections — ${dayLabel(dateISO)}`],
    [
      `${worked} rep${worked === 1 ? "" : "s"} worked records · ` +
      `${totalMisses} field${totalMisses === 1 ? "" : "s"} to fix across the team`,
    ],
    ["Counts only. Each rep has their own list; nothing here has been reviewed."],
    [],
    ["Rep", "Team", "Records worked", "Records needing a fix", "Fields to fix", "Their list"],
    ...ranked.map((d) => [
      d.rep,
      d.team,
      String(d.recordsChecked),
      String(byRecord(d.misses).length),
      String(d.misses.length),
      d.sheetUrl ?? labelForStatus(d),
    ]),
  ];
}

function labelForStatus(d: RepDay): string {
  if (d.status === "no_activity") return "no records worked";
  if (d.status === "clean") return "nothing to fix";
  if (d.status === "dry_run") return "dry run, not sent";
  return d.error ?? "";
}

/** Daily lists live under the rep, by month, so the Drive stays navigable. */
export function dailyFolderPath(rep: string, dateISO: string): string[] {
  return ["Daily Corrections", rep, dateISO.slice(0, 7)];
}

export function dailyTitle(rep: string, dateISO: string): string {
  const initials = rep.split(/\s+/).map((p) => p[0] ?? "").join("").toUpperCase();
  return `${initials}: CRM corrections ${dateISO}`;
}

/** Today in Phoenix. The 8am job runs at 15:00 UTC, which is the same date. */
export function phoenixToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 7 * 3600_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Relevance: what a rep could actually have captured.
//
// The first live dry run produced 220 corrections across 32 of Taylor
// Bertchie's 34 records for one Thursday. Among them: "WIRELESS CALLER",
// "TUCSON AZ" and "PHOENIX AZ" — caller-ID rows CTM creates for every inbound
// call, each carrying a demand for Date of Birth, Member ID and Insurance
// Policy Type. A list like that gets ignored on day one, and then the whole
// channel is dead.
//
// A blank is only a correction if the rep could have filled it. Three cases
// where they could not, keyed off Lead_Status:
//
//   disqualified — wrong number, spam, a staff call. There is nothing to
//                  collect; dispositioning it WAS the work.
//   never reached — the rep called and nobody answered. You cannot take a date
//                  of birth from someone who did not pick up. The note is still
//                  expected, so note misses survive; field blanks do not.
//   not yet worked — still sitting at Pending Initial Contact. The one true
//                  correction is that it has no disposition, so only that line
//                  survives.
//
// Leads only. Contacts and Deals reach those modules by being worked already,
// and neither carries a status that means "this was never a real prospect".

/** Not a prospect, or not reachable. Dispositioning it was the whole job. */
export const DISQUALIFIED_LEAD_STATUSES = [
  "junk/spam/sales",
  "wrong number",
  "hang up",
  "client care call/hr/admin",
  "requested no further contact",
  "dui - service not offered",
  "dv - service not offered",
];

/** The rep tried and got nobody. Field blanks are not their doing. */
export const UNREACHED_LEAD_STATUSES = [
  "unable to contact: follow up needed",
  ">10 outreach attempts made, no contact",
];

/** Items that survive "never reached" — logging the attempt is still the job. */
const NOTE_ITEMS = new Set(["L26", "L27", "C12", "D22", "D23", "D37"]);
/** Interaction Status. The only correction a never-worked lead can carry. */
const STATUS_ITEM = "L7";

function statusOf(record: Record<string, unknown>): string {
  return String(record.Lead_Status ?? "").trim().toLowerCase();
}

/**
 * Drops the misses a rep could not have prevented. Returns the misses worth
 * sending for one record, given the record itself.
 */
export function relevantMisses(
  section: string,
  record: Record<string, unknown>,
  misses: DailyMiss[],
): DailyMiss[] {
  if (section !== "Leads") return misses;
  const status = statusOf(record);

  if (DISQUALIFIED_LEAD_STATUSES.includes(status)) return [];
  if (UNREACHED_LEAD_STATUSES.includes(status)) {
    return misses.filter((m) => NOTE_ITEMS.has(m.item));
  }
  if (status.startsWith("pending initial contact")) {
    return misses.filter((m) => m.item === STATUS_ITEM);
  }
  return misses;
}
