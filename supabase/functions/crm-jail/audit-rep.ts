// One rep, one week, one scorecard.
//
// Order: fetch the window -> sample 5 per section -> enrich only the sampled
// records -> judge notes -> score -> copy the template -> write the cells.
//
// Enrichment happens AFTER sampling on purpose. A rep can touch hundreds of
// records in a week; fetching notes and attachments for all of them would be
// slow and pointless when only 5 per section are scored.

import { fetchByIds, fetchRelated, fetchWindow, whatIdModuleOf } from "./zoho.ts";
import { EOD_SHEETS, fetchEodValues, judgeEod, parseEodSheet, rowsForRep, type EodRow } from "./eod.ts";
import { expectedEodDays } from "./holidays.ts";
import { dailyBounds, missesFor, type DailyMiss } from "./daily.ts";
import { sampleRecords, sampleSeed } from "./sampler.ts";
import { judgeExcusedBlanks, judgeNotes, judgeDiagnostics } from "./notes-judge.ts";
import { itemsForModule } from "./notes-judge.ts";
import {
  BD_DAILY_RULES, DAILY_RULES, MODULE_FOR, applyExcusedBlanks, blankCandidates,
  buildWrites, scoreRecord, toSampledRecord, type SectionResult,
} from "./score.ts";
import adminMap from "./template-map.admissions.json" with { type: "json" };
import bdMap from "./template-map.bd.json" with { type: "json" };
import {
  copyTemplate, ensureFolderPath, scorecardFolderPath, scorecardTitle, writeCells, type Team,
} from "./sheets.ts";
import { noteText } from "./rules/helpers.ts";
import type { ItemResult, RecordContext, SampledRecord, ZohoNote } from "./types.ts";

const SAMPLE_SIZE = 5;

/** Per-section ceiling on the daily list. Observed real days are ~15 per rep. */
const DAILY_SECTION_CAP = 50;

const SECTIONS: Record<Team, string[]> = {
  admissions: ["Leads", "Contacts", "Deals"],
  bd: ["BusinessContacts", "Calls", "Companies", "Meetings"],
};

export interface RosterRep {
  zoho_user_id: string;
  full_name: string;
  email: string;
  team: Team;
  auditor_email: string;
}

export interface AuditWindowish {
  startISO: string;
  endISO: string;
  label: string;
}

/** Per-phase wall clock, so a slow run points at a cause instead of a guess. */
export interface PhaseTimings {
  fetchMs: number;
  enrichJudgeMs: number;
  writeMs: number;
  poolSizes: Record<string, number>;
}

export interface AuditRepResult {
  rep: string;
  team: Team;
  status: "ok" | "skipped_no_activity";
  timings?: PhaseTimings;
  sheetId?: string;
  sheetUrl?: string;
  deferredCells: number;
  auditorEmail: string;
  sampled: Record<string, number>;
}

/** Formats an ISO date the way the template header shows it. */
function mdy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

/**
 * Notes, attachments and related activity for ONE sampled record. Each call is
 * wrapped: a related-list failure degrades that record's dependent items to
 * DEFER rather than failing the whole audit.
 */
async function enrich(
  token: string,
  section: string,
  record: Record<string, unknown>,
): Promise<Pick<RecordContext, "notes" | "notesUnavailable" | "notesIncludeDescription" | "attachments" | "relatedMeetings" | "relatedDealCount" | "futureActivityCount" | "accountOwnerId" | "whatIdModule" | "whoContactType">> {
  const mod = MODULE_FOR[section];
  const id = String(record.id);
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  let notesUnavailable = false;
  let notes: ZohoNote[] = [];
  try {
    notes = await fetchRelated(token, mod, id, "Notes") as ZohoNote[];
  } catch {
    // Distinguished from "no notes" on purpose — see judged() in the rules.
    notesUnavailable = true;
  }

  // Where the rep is expected to write the narrative. Meetings moved from the
  // Event Description to the Notes section and both still count; calls are
  // expected in the Call's Description outright (Amber, 2026-09-16), with Notes
  // kept for anyone who used it. Call_Result is deliberately NOT folded in —
  // it is a picklist outcome ("Made Contact"), and it must never pass CA7 on
  // its own when there is no narrative behind it.
  //
  // Leads, Contacts and Deals too. Admissions reps write the first-call
  // narrative in the lead's Description, not the Notes section. Reading Notes
  // alone, the first live daily list (2026-09-30) told Sabrina Johnson that
  // Logan Mintz had no note while the Description read "Caller refused to give
  // insurance ... UNABLE TO OBTAIN INSURANCE INFO" — and, seeing no note, never
  // asked whether that note excused the blank insurance fields.
  const notesIncludeDescription = section !== "Accounts";
  const description = notesIncludeDescription ? String(record.Description ?? "").trim() : "";
  if (description !== "") {
    notes = [...notes, { Note_Title: "Description", Note_Content: description }];
  }

  const attachments = section === "Deals"
    ? (await safe(() => fetchRelated(token, mod, id, "Attachments"), []))
      .map((a) => String((a as Record<string, unknown>).File_Name ?? ""))
    : [];

  const relatedMeetings = section === "BusinessContacts"
    ? (await safe(() => fetchRelated(token, mod, id, "Events"), []))
      .map((e) => ({ id: String((e as Record<string, unknown>).id), Start_DateTime: (e as Record<string, unknown>).Start_DateTime as string | undefined }))
    : [];

  const relatedDealCount = section === "Contacts"
    ? (await safe(() => fetchRelated(token, mod, id, "Deals"), [])).length
    : 0;

  // "Is a follow-up scheduled?" — a future Call or Task on the record.
  const now = new Date().toISOString();
  const futureActivityCount = ["Calls", "Meetings", "Deals"].includes(section)
    ? [
      ...(await safe(() => fetchRelated(token, mod, id, "Calls"), [])),
      ...(await safe(() => fetchRelated(token, mod, id, "Tasks"), [])),
    ].filter((a) => {
      const r = a as Record<string, unknown>;
      const when = String(r.Call_Start_Time ?? r.Due_Date ?? r.Start_DateTime ?? "");
      return when !== "" && when > now;
    }).length
    : 0;

  const accountOwnerId = null; // resolved by the caller when C11 is in scope

  // CA6 is conditional on who the call was with, so the linked contact's type
  // has to be resolved. Left null on a failed lookup rather than guessed — the
  // rule defers instead of inventing a verdict.
  let whoContactType: string | null = null;
  const whoId = record.Who_Id as { id?: string } | null;
  if (section === "Calls" && whoId && typeof whoId === "object" && whoId.id) {
    const [contact] = await safe(() => fetchByIds(token, "Contacts", [String(whoId.id)]), []);
    if (contact) whoContactType = String(contact.Contact_Type ?? "") || null;
  }

  return {
    notes,
    notesUnavailable,
    notesIncludeDescription,
    attachments,
    relatedMeetings,
    relatedDealCount,
    futureActivityCount,
    accountOwnerId,
    whatIdModule: whatIdModuleOf(record),
    whoContactType,
  };
}

export interface AuditDeps {
  /** Every active rep on the team, so a first-name-only EOD row can be resolved. */
  rosterNames?: string[];
  zohoToken: string;
  googleToken: string;
  driveId: string;
  /** Raw Stage -> normalized category, from reporting.stage_mapping. */
  stageCategory: (raw: unknown) => string | null;
  sourceCategory: (raw: unknown) => string | null;
  dryRun?: boolean;
}

/**
 * Enriches and scores a set of already-chosen records for one section.
 *
 * Shared by the weekly scorecard (5 sampled records) and the daily correction
 * list (every record the rep touched). They must not drift: a rep who fixes
 * what the daily list asked for and is then failed by the weekly on the same
 * field would rightly stop trusting both.
 *
 * Records are independent, so they enrich and judge together. Serially this was
 * ~3s of Claude per record on top of several related-list round trips each,
 * which timed the whole run out at the edge function's wall clock.
 *
 * `judgeNotesQuality` is false for the daily list. Whether a note reads as a
 * clear narrative with a next step is a model's opinion, and it goes to the rep
 * unreviewed there — that judgment belongs in the weekly, where an auditor sees
 * it first. A record with NO note still scores 0 either way: judged() returns
 * that without consulting the judge. The excused-blanks check below always
 * runs, because skipping it would have the daily nag reps about fields their
 * note already accounts for.
 */
export async function scoreDrawn(
  team: Team,
  section: string,
  mod: string,
  drawn: Record<string, unknown>[],
  window: AuditWindowish,
  deps: AuditDeps,
  judgeNotesQuality: boolean,
): Promise<{ records: SampledRecord[]; results: ItemResult[][] }> {
  const records = drawn.map((r) => toSampledRecord(section, r));
  const judgeItems = itemsForModule(section === "BusinessContacts" ? "BusinessContacts" : mod);

  const results: ItemResult[][] = await Promise.all(
    drawn.map(async (r) => {
      const extra = await enrich(deps.zohoToken, section, r);
      const notesJudgments = extra.notesUnavailable || !judgeNotesQuality
        ? {}
        : await judgeNotes(noteText(extra.notes), judgeItems);
      const scored = scoreRecord(team, section, {
        record: r as RecordContext["record"],
        window: { startISO: window.startISO, endISO: window.endISO },
        stageCategory: deps.stageCategory,
        sourceCategory: deps.sourceCategory,
        notesJudgments,
        ...extra,
      });

      // Policy OPS-CRM-001 §2: a blank the note explains is not a miss.
      // Without this the bot ran 13-25 points below the human auditors.
      if (extra.notesUnavailable) return scored;
      const blanks = blankCandidates(scored);
      if (blanks.length === 0) return scored;
      const labels = (team === "admissions" ? adminMap : bdMap).items as Record<string, { label?: string }>;
      const excused = await judgeExcusedBlanks(
        noteText(extra.notes),
        blanks.map((item) => ({ item, label: labels[item]?.label ?? item })),
      );
      const applied = applyExcusedBlanks(scored, excused);
      judgeDiagnostics.excused += applied.excusedCount;
      return applied.results;
    }),
  );
  return { records, results };
}

export async function auditRep(
  rep: RosterRep,
  window: AuditWindowish,
  bounds: { from: string; toExclusive: string },
  deps: AuditDeps,
): Promise<AuditRepResult> {
  const team = rep.team;
  const sections: SectionResult[] = [];
  const sampled: Record<string, number> = {};
  const allWindowRecords: Record<string, Record<string, unknown>[]> = {};
  const timings: PhaseTimings = { fetchMs: 0, enrichJudgeMs: 0, writeMs: 0, poolSizes: {} };

  for (const section of SECTIONS[team]) {
    const mod = MODULE_FOR[section];
    const t0 = Date.now();
    let pool = await fetchWindow(deps.zohoToken, mod, rep.zoho_user_id, bounds);
    timings.fetchMs += Date.now() - t0;

    // The BD scorecard's "Business Contacts" section means contacts with a
    // business role — a client contact is not a business contact.
    if (section === "BusinessContacts") {
      pool = pool.filter((r) => String(r.Business_Contact_Role ?? "").trim() !== "");
    }
    allWindowRecords[section] = pool;
    timings.poolSizes[section] = pool.length;

    const drawn = sampleRecords(
      pool,
      SAMPLE_SIZE,
      sampleSeed(window.startISO, rep.zoho_user_id, mod),
    );
    sampled[section] = drawn.length;

    const t1 = Date.now();
    const { records, results } = await scoreDrawn(team, section, mod, drawn, window, deps, true);
    timings.enrichJudgeMs += Date.now() - t1;
    sections.push({ section, records, results });
  }

  // A rep with nothing in the window gets a flagged sheet, not a 0%. Someone
  // on PTO must not land in jail for it.
  const totalRecords = Object.values(sampled).reduce((a, b) => a + b, 0);
  if (totalRecords === 0) {
    return {
      rep: rep.full_name, team, status: "skipped_no_activity", timings,
      deferredCells: 0, auditorEmail: rep.auditor_email, sampled,
    };
  }

  // EOD sheets are Google, not Zoho, so this costs no CRM quota.
  const eod = await eodContextFor(
    deps.googleToken, team, rep.full_name, deps.rosterNames ?? [rep.full_name], window,
  );
  const daily = dailyResults(team, allWindowRecords, eod);

  const { writes, deferredCells } = buildWrites(
    {
      rep: rep.full_name, team, auditor: rep.auditor_email,
      windowFrom: mdy(window.startISO), windowTo: mdy(window.endISO),
    },
    sections,
    daily,
  );

  if (deps.dryRun) {
    return {
      rep: rep.full_name, team, status: "ok", timings,
      deferredCells, auditorEmail: rep.auditor_email, sampled,
    };
  }

  const t2 = Date.now();
  const folder = await ensureFolderPath(
    deps.googleToken, deps.driveId, scorecardFolderPath(rep.full_name, window),
  );
  const title = scorecardTitle(team, rep.full_name, window.label);
  const copy = await copyTemplate(deps.googleToken, team, title, folder);
  await writeCells(deps.googleToken, team, copy.id, writes);
  timings.writeMs = Date.now() - t2;

  return {
    rep: rep.full_name, team, status: "ok", timings,
    sheetId: copy.id, sheetUrl: copy.url,
    deferredCells, auditorEmail: rep.auditor_email, sampled,
  };
}

/**
 * The EOD picture for one rep, or null when the sheets could not be read.
 *
 * Null means DEFER, never 0: a sheet the bot cannot open is not evidence that
 * a rep filed nothing. Both EOD pipes were silently dead for seven months and
 * nobody noticed — scoring that as a rep failure would have been the same
 * mistake with a person's name on it.
 */
export interface EodContext {
  expectedDays: string[];
  missing: string[];
  late: string[];
  any: boolean;
}

/** Reads both of a team's EOD sheets and judges one rep against the window. */
export async function eodContextFor(
  googleToken: string,
  team: Team,
  repFullName: string,
  rosterNames: string[],
  window: { startISO: string; endISO: string },
): Promise<EodContext | null> {
  try {
    const grids = await Promise.all(
      (EOD_SHEETS[team] ?? []).map((id) => fetchEodValues(googleToken, id)),
    );
    const rows: EodRow[] = grids.flatMap((g) => parseEodSheet(g));
    const mine = rowsForRep(rows, repFullName, rosterNames);
    if (mine === null) return null; // ambiguous rep name — do not guess
    // BD is weekdays only (Amber). Admissions covers weekends, so every
    // non-holiday day counts until told otherwise.
    const expectedDays = expectedEodDays(window.startISO, window.endISO, team === "bd");
    return { expectedDays, ...judgeEod(expectedDays, mine) };
  } catch {
    return null;
  }
}

const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** A2 on BD, A1 on admissions: filed on every expected day, on the day. */
function eodSubmitted(eod: EodContext | null): ItemResult {
  const item = "";
  if (!eod) return { item, score: "DEFER", explanation: "Could not read the EOD sheets." };
  if (eod.expectedDays.length === 0) {
    return { item, score: "N/A", explanation: "No working days in the window." };
  }
  if (eod.missing.length === 0 && eod.late.length === 0) return { item, score: 1 };
  const bits: string[] = [];
  if (eod.missing.length) bits.push(`no EOD on ${eod.missing.map(dayLabel).join(", ")}`);
  if (eod.late.length) bits.push(`filed late on ${eod.late.map(dayLabel).join(", ")}`);
  return {
    item,
    score: 0,
    explanation: `${bits.join("; ")}. Holidays and weekends are already excluded.`,
  };
}

/**
 * A3 on BD, A2 on admissions: the EOD was complete.
 *
 * Zoho now enforces the mandatory fields at submission (Amber, 2026-09-17), so
 * a submission that exists cannot be missing them. The control moved from
 * detection to prevention and this line simply confirms something was filed.
 */
function eodComplete(eod: EodContext | null): ItemResult {
  const item = "";
  if (!eod) return { item, score: "DEFER", explanation: "Could not read the EOD sheets." };
  if (eod.any) return { item, score: 1 };
  return { item, score: 0, explanation: "No EOD report was submitted in the window." };
}

/** Section A is scored once per cycle over ALL window activity, not the sample. */
export function dailyResults(
  team: Team,
  all: Record<string, Record<string, unknown>[]>,
  eod: EodContext | null = null,
): ItemResult[] {
  if (team === "admissions") {
    const touched = [...(all.Leads ?? []), ...(all.Contacts ?? []), ...(all.Deals ?? [])];
    return [
      { ...eodSubmitted(eod), item: "A1" },
      { ...eodComplete(eod), item: "A2" },
      { item: "A3", score: DAILY_RULES.A3(touched) },
      { item: "A4", score: DAILY_RULES.A4, explanation: "Daily Census — Google Sheet, Phase 2." },
      { item: "A5", score: DAILY_RULES.A5, explanation: "Daily Census — Google Sheet, Phase 2." },
      { item: "A6", score: DAILY_RULES.A6, explanation: "Intake Tracker — Google Sheet, Phase 2." },
    ];
  }
  return [
    { item: "A1", score: BD_DAILY_RULES.A1, explanation: "Referral form — Zoho Forms, Phase 2." },
    { ...eodSubmitted(eod), item: "A2" },
    { ...eodComplete(eod), item: "A3" },
    { item: "A4", score: BD_DAILY_RULES.A4(all.Calls ?? []) },
    { item: "A5", score: BD_DAILY_RULES.A5(all.Meetings ?? []) },
    { item: "A6", score: BD_DAILY_RULES.A6, explanation: "Assigned spreadsheet — Phase 2." },
    { item: "A7", score: BD_DAILY_RULES.A7, explanation: "Assigned spreadsheet — Phase 2." },
  ];
}


/**
 * Scores an explicit set of records — the replay path.
 *
 * Deliberately shares every step with the live audit except sampling: same
 * enrichment, same rules, same excused-blank pass. If replay used a different
 * code path it would be testing the wrong thing.
 */
export async function replayRecords(
  team: Team,
  window: AuditWindowish,
  recordsBySection: Record<string, string[]>,
  deps: AuditDeps,
): Promise<Record<string, Array<{ id: string; items: ItemResult[] }>>> {
  const out: Record<string, Array<{ id: string; items: ItemResult[] }>> = {};

  for (const [section, ids] of Object.entries(recordsBySection)) {
    if (!SECTIONS[team].includes(section) || ids.length === 0) continue;
    const mod = MODULE_FOR[section];
    const fetched = await fetchByIds(deps.zohoToken, mod, ids);
    const byId = new Map(fetched.map((r) => [String(r.id), r]));

    out[section] = [];
    for (const id of ids) {
      const rec = byId.get(id);
      // A record the auditor sampled but that no longer resolves is reported,
      // not silently dropped — a missing row would quietly shrink the diff.
      if (!rec) { out[section].push({ id, items: [] }); continue; }

      const extra = await enrich(deps.zohoToken, section, rec);
      const judgeItems = itemsForModule(section === "BusinessContacts" ? "BusinessContacts" : mod);
      const notesJudgments = extra.notesUnavailable
        ? {}
        : await judgeNotes(noteText(extra.notes), judgeItems);
      const scored = scoreRecord(team, section, {
        record: rec as RecordContext["record"],
        window: { startISO: window.startISO, endISO: window.endISO },
        stageCategory: deps.stageCategory,
        sourceCategory: deps.sourceCategory,
        notesJudgments,
        ...extra,
      });

      let items = scored;
      if (!extra.notesUnavailable) {
        const blanks = blankCandidates(scored);
        if (blanks.length > 0) {
          const labels = (team === "admissions" ? adminMap : bdMap).items as Record<string, { label?: string }>;
          const excused = await judgeExcusedBlanks(
            noteText(extra.notes),
            blanks.map((item) => ({ item, label: labels[item]?.label ?? item })),
          );
          items = applyExcusedBlanks(scored, excused).results;
        }
      }
      out[section].push({ id, items });
    }
  }
  return out;
}

/**
 * One rep, one day, the list of things they can fix this morning.
 *
 * Differs from auditRep in three ways, all of them because a rep reads this
 * unreviewed: every record they touched is scored rather than five sampled
 * ones, note *quality* is not judged, and only outright misses survive. See
 * the header of daily.ts for why each of those follows from the audience.
 *
 * No calendar logic. A rep who did not work yesterday owns no records from
 * yesterday and comes back "no_activity", which is the same path a rep on PTO
 * takes — weekends and holidays need no special case.
 */
export async function auditRepDaily(
  rep: RosterRep,
  dateISO: string,
  deps: AuditDeps,
): Promise<{
  rep: string;
  team: Team;
  recordsChecked: number;
  misses: DailyMiss[];
  truncated: boolean;
}> {
  const team = rep.team;
  const bounds = dailyBounds(dateISO);
  // A single day's window, for the rules that read one — L7 defers on windows
  // that closed before the CTM Interaction Status fix.
  const window = { startISO: dateISO, endISO: dateISO, label: dayLabel(dateISO) };

  const misses: DailyMiss[] = [];
  let recordsChecked = 0;
  let truncated = false;

  for (const section of SECTIONS[team]) {
    const mod = MODULE_FOR[section];
    let pool = await fetchWindow(deps.zohoToken, mod, rep.zoho_user_id, bounds, true);
    if (section === "BusinessContacts") {
      pool = pool.filter((r) => String(r.Business_Contact_Role ?? "").trim() !== "");
    }
    // Every record costs a related-list round trip and possibly a Claude call.
    // A day that somehow produces hundreds must not take the whole run down;
    // the overflow is reported rather than silently dropped.
    if (pool.length > DAILY_SECTION_CAP) {
      truncated = true;
      pool = pool.slice(0, DAILY_SECTION_CAP);
    }
    if (pool.length === 0) continue;
    recordsChecked += pool.length;

    const { records, results } = await scoreDrawn(team, section, mod, pool, window, deps, false);
    misses.push(...missesFor(team, section, records, results, deps.stageCategory, dateISO));
  }

  return { rep: rep.full_name, team, recordsChecked, misses, truncated };
}
