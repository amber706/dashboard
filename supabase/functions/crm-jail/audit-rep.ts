// One rep, one week, one scorecard.
//
// Order: fetch the window -> sample 5 per section -> enrich only the sampled
// records -> judge notes -> score -> copy the template -> write the cells.
//
// Enrichment happens AFTER sampling on purpose. A rep can touch hundreds of
// records in a week; fetching notes and attachments for all of them would be
// slow and pointless when only 5 per section are scored.

import { fetchRelated, fetchWindow, whatIdModuleOf } from "./zoho.ts";
import { sampleRecords, sampleSeed } from "./sampler.ts";
import { judgeNotes } from "./notes-judge.ts";
import { itemsForModule } from "./notes-judge.ts";
import {
  BD_DAILY_RULES, DAILY_RULES, MODULE_FOR, buildWrites, scoreRecord, toSampledRecord,
  type SectionResult,
} from "./score.ts";
import {
  copyTemplate, ensureFolderPath, scorecardFolderPath, scorecardTitle, writeCells, type Team,
} from "./sheets.ts";
import { noteText } from "./rules/helpers.ts";
import type { ItemResult, RecordContext, ZohoNote } from "./types.ts";

const SAMPLE_SIZE = 5;

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

export interface AuditRepResult {
  rep: string;
  team: Team;
  status: "ok" | "skipped_no_activity";
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
): Promise<Pick<RecordContext, "notes" | "attachments" | "relatedMeetings" | "relatedDealCount" | "futureActivityCount" | "accountOwnerId" | "whatIdModule">> {
  const mod = MODULE_FOR[section];
  const id = String(record.id);
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const notes = await safe(
    () => fetchRelated(token, mod, id, "Notes") as Promise<ZohoNote[]>,
    [] as ZohoNote[],
  );

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

  return {
    notes,
    attachments,
    relatedMeetings,
    relatedDealCount,
    futureActivityCount,
    accountOwnerId,
    whatIdModule: whatIdModuleOf(record),
  };
}

export interface AuditDeps {
  zohoToken: string;
  googleToken: string;
  driveId: string;
  /** Raw Stage -> normalized category, from reporting.stage_mapping. */
  stageCategory: (raw: unknown) => string | null;
  sourceCategory: (raw: unknown) => string | null;
  dryRun?: boolean;
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

  for (const section of SECTIONS[team]) {
    const mod = MODULE_FOR[section];
    let pool = await fetchWindow(deps.zohoToken, mod, rep.zoho_user_id, bounds);

    // The BD scorecard's "Business Contacts" section means contacts with a
    // business role — a client contact is not a business contact.
    if (section === "BusinessContacts") {
      pool = pool.filter((r) => String(r.Business_Contact_Role ?? "").trim() !== "");
    }
    allWindowRecords[section] = pool;

    const drawn = sampleRecords(
      pool,
      SAMPLE_SIZE,
      sampleSeed(window.startISO, rep.zoho_user_id, mod),
    );
    sampled[section] = drawn.length;

    const records = drawn.map((r) => toSampledRecord(section, r));
    const results: ItemResult[][] = [];

    for (const r of drawn) {
      const extra = await enrich(deps.zohoToken, section, r);
      const judgeItems = itemsForModule(section === "BusinessContacts" ? "BusinessContacts" : mod);
      const notesJudgments = await judgeNotes(noteText(extra.notes), judgeItems);
      results.push(scoreRecord(team, section, {
        record: r as RecordContext["record"],
        window: { startISO: window.startISO, endISO: window.endISO },
        stageCategory: deps.stageCategory,
        sourceCategory: deps.sourceCategory,
        notesJudgments,
        ...extra,
      }));
    }
    sections.push({ section, records, results });
  }

  // A rep with nothing in the window gets a flagged sheet, not a 0%. Someone
  // on PTO must not land in jail for it.
  const totalRecords = Object.values(sampled).reduce((a, b) => a + b, 0);
  if (totalRecords === 0) {
    return {
      rep: rep.full_name, team, status: "skipped_no_activity",
      deferredCells: 0, auditorEmail: rep.auditor_email, sampled,
    };
  }

  const daily = dailyResults(team, allWindowRecords);

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
      rep: rep.full_name, team, status: "ok",
      deferredCells, auditorEmail: rep.auditor_email, sampled,
    };
  }

  const folder = await ensureFolderPath(
    deps.googleToken, deps.driveId, scorecardFolderPath(rep.full_name, window),
  );
  const title = scorecardTitle(team, rep.full_name, window.label);
  const copy = await copyTemplate(deps.googleToken, team, title, folder);
  await writeCells(deps.googleToken, team, copy.id, writes);

  return {
    rep: rep.full_name, team, status: "ok",
    sheetId: copy.id, sheetUrl: copy.url,
    deferredCells, auditorEmail: rep.auditor_email, sampled,
  };
}

/** Section A is scored once per cycle over ALL window activity, not the sample. */
export function dailyResults(
  team: Team,
  all: Record<string, Record<string, unknown>[]>,
): ItemResult[] {
  if (team === "admissions") {
    const touched = [...(all.Leads ?? []), ...(all.Contacts ?? []), ...(all.Deals ?? [])];
    return [
      { item: "A1", score: DAILY_RULES.A1, explanation: "EOD report — Google Sheet, Phase 2." },
      { item: "A2", score: DAILY_RULES.A2, explanation: "EOD report — Google Sheet, Phase 2." },
      { item: "A3", score: DAILY_RULES.A3(touched) },
      { item: "A4", score: DAILY_RULES.A4, explanation: "Daily Census — Google Sheet, Phase 2." },
      { item: "A5", score: DAILY_RULES.A5, explanation: "Daily Census — Google Sheet, Phase 2." },
      { item: "A6", score: DAILY_RULES.A6, explanation: "Intake Tracker — Google Sheet, Phase 2." },
    ];
  }
  return [
    { item: "A1", score: BD_DAILY_RULES.A1, explanation: "Referral form — Zoho Forms, Phase 2." },
    { item: "A2", score: BD_DAILY_RULES.A2, explanation: "EOD report — PDFs in Drive, Phase 2." },
    { item: "A3", score: BD_DAILY_RULES.A3, explanation: "EOD report — PDFs in Drive, Phase 2." },
    { item: "A4", score: BD_DAILY_RULES.A4(all.Calls ?? []) },
    { item: "A5", score: BD_DAILY_RULES.A5(all.Meetings ?? []) },
    { item: "A6", score: BD_DAILY_RULES.A6, explanation: "Assigned spreadsheet — Phase 2." },
    { item: "A7", score: BD_DAILY_RULES.A7, explanation: "Assigned spreadsheet — Phase 2." },
  ];
}
