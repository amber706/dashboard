// Company pipeline-stage compliance (BD).
//
// Rules: "Zoho Company Staging Rules", Cornerstone BD, effective October 2026
// (Aaron, 2026-10-26). For an established account, the first true of:
//   1. admitted a client in the last 30 days   -> Admitting
//   2. sent a referral in the last 30 days     -> Referring
//   3. last referral 31-89 days ago            -> Not Referring
//   4. no referral in 90+ days                 -> Dormant
// New accounts sit in Lead until initial contact, then New / Onboarding for 30
// days, then follow the order above. A referral or admit at any point decides
// the stage outright, onboarding or not (Aaron, 2026-10-26).
//
// Where the facts come from — and why not the Account's own date fields:
// Date_of_Last_Refer_In and Date_of_Last_Admit stopped updating in July 2026
// (newest value on any BD account was 7/11 while referrals kept arriving), so
// scoring from them would call nearly every account Dormant. The facts are
// read from Deals instead: a deal whose Referring_Company is the account is a
// referral on its Created_Time, and an admit on its Admit_Date.
//
// "Initial contact" has no field. It is the account's earliest linked call or
// meeting (What_Id). Finding the earliest one for every account would cost two
// Zoho calls per account, so only accounts with a call or meeting in the last
// 31 days are checked — those are the only ones whose first contact can fall
// inside the 30-day onboarding window. For the rest, contact history is
// unknown, so Lead is accepted for an account with no referrals.

import { coql } from "./zoho.ts";

export const STAGES = {
  lead: "Leads - 10%",
  onboarding: "New/Onboarding - 25%",
  notReferring: "Not Referring - 50%",
  referring: "Referring - 75%",
  admitting: "Admitting - 100%",
  dormant: "Dormant - 5%",
} as const;

/** Out of the pipeline on purpose; never scored. */
const UNSCORED = ["archive", "delete"];

/** "Referring - 75%" -> "referring". Picklist labels carry the probability. */
export function stageKey(raw: unknown): string {
  return String(raw ?? "").replace(/\s*-\s*\d+\s*%\s*$/, "").trim().toLowerCase()
    .replace(/\s*\/\s*/g, "/");
}

const NAME: Record<string, string> = {
  "leads": "Lead",
  "new/onboarding": "New / Onboarding",
  "not referring": "Not Referring",
  "referring": "Referring",
  "admitting": "Admitting",
  "dormant": "Dormant",
};
export const stageName = (raw: unknown) => NAME[stageKey(raw)] ?? (String(raw ?? "").trim() || "(blank)");

const DAY_MS = 86_400_000;
/** Whole Phoenix days from `fromISO` (a date or datetime) to `todayISO`. */
export function daysSince(fromISO: string, todayISO: string): number {
  const day = fromISO.length > 10
    ? new Date(new Date(fromISO).getTime() - 7 * 3600_000).toISOString().slice(0, 10)
    : fromISO.slice(0, 10);
  return Math.round((Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
}

export interface StageFacts {
  /** Phoenix date of the latest deal referred by the account, if within 90 days. */
  lastReferral: string | null;
  /** Latest Admit_Date on a deal the account referred, if within 30 days. */
  lastAdmit: string | null;
  /**
   * Earliest linked call/meeting when it is within 30 days (onboarding);
   * `"older"` when the account has recent contact but was first contacted
   * earlier; undefined when contact history was not checked.
   */
  firstContact?: string | "older";
}

export interface StageVerdict {
  correct: boolean;
  current: string;
  expected: string;
  reason: string;
}

/** null when the account is not scored (Archive / Delete). */
export function stageVerdict(currentRaw: unknown, f: StageFacts, todayISO: string): StageVerdict | null {
  const key = stageKey(currentRaw);
  if (UNSCORED.some((u) => key.startsWith(u))) return null;
  const current = stageName(currentRaw);
  const verdict = (expected: string, reason: string, also: string[] = []): StageVerdict => ({
    correct: stageKey(expected) === key || also.some((a) => stageKey(a) === key),
    current,
    expected: stageName(expected),
    reason,
  });

  // An admit or a referral in the last 30 days decides the stage outright, for
  // a new account as much as an established one (Aaron, 2026-10-26: "if we
  // get a referral at any point, a company is considered referring"). Only
  // without one does a new account sit in New / Onboarding.
  if (f.lastAdmit && daysSince(f.lastAdmit, todayISO) <= 30) {
    return verdict(STAGES.admitting, `admitted a client ${f.lastAdmit}`);
  }
  const refDays = f.lastReferral ? daysSince(f.lastReferral, todayISO) : null;
  if (refDays !== null && refDays <= 30) {
    return verdict(STAGES.referring, `last referral ${f.lastReferral} (${refDays} days ago)`);
  }
  // Onboarding is only for an account that has not referred: one that has is
  // on the referral ladder however recently it was first contacted.
  if (refDays === null && f.firstContact && f.firstContact !== "older") {
    const d = daysSince(f.firstContact, todayISO);
    if (d <= 30) {
      return verdict(STAGES.onboarding, `first contact ${f.firstContact} (${d} days ago), no referral yet — onboarding runs 30 days`);
    }
  }
  if (refDays !== null && refDays <= 89) {
    return verdict(STAGES.notReferring, `last referral ${f.lastReferral} (${refDays} days ago)`);
  }
  // No referral in 90 days. An account never contacted is a Lead; one whose
  // contact history was not checked may be either, so both are accepted.
  if (f.firstContact === "older") {
    return verdict(STAGES.dormant, "no referral in 90+ days; first contact was over 30 days ago");
  }
  if (key === "new/onboarding") {
    // Onboarding with no call or meeting linked in 30 days has either ended
    // (Dormant) or never started (Lead): Mesa Family Therapy sat in
    // New/Onboarding with the note "Trying to make contact with this company".
    return {
      correct: false,
      current,
      expected: "Lead or Dormant",
      reason: "no call or meeting linked to the company in the last 30 days and no referral in 90+ days — " +
        "Lead if it was never contacted, Dormant if onboarding has ended",
    };
  }
  return verdict(STAGES.dormant, "no referral in 90+ days", [STAGES.lead]);
}

// ---------------------------------------------------------------------------
// Facts from Zoho

function phoenixDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 7 * 3600_000).toISOString().slice(0, 10);
}
function daysBefore(todayISO: string, n: number): string {
  return new Date(Date.parse(`${todayISO}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

const PAGE = 200;

/** Latest referral (90 days) and admit (30 days) per referring account id. */
export async function fetchReferralFacts(
  token: string,
  todayISO: string,
): Promise<Map<string, { lastReferral: string | null; lastAdmit: string | null }>> {
  const since90 = `${daysBefore(todayISO, 90)}T00:00:00-07:00`;
  const since30 = daysBefore(todayISO, 30);
  const out = new Map<string, { lastReferral: string | null; lastAdmit: string | null }>();
  for (let offset = 0; ; offset += PAGE) {
    const page = await coql(
      token,
      `select id, Referring_Company, Created_Time, Admit_Date from Deals ` +
        `where (Referring_Company is not null and ((Created_Time >= '${since90}') or (Admit_Date >= '${since30}'))) ` +
        `order by id limit ${PAGE} offset ${offset}`,
    );
    for (const d of page) {
      const acct = (d.Referring_Company as { id?: string } | null)?.id;
      if (!acct) continue;
      const cur = out.get(acct) ?? { lastReferral: null, lastAdmit: null };
      const ref = d.Created_Time ? phoenixDate(String(d.Created_Time)) : null;
      if (ref && ref >= daysBefore(todayISO, 90) && (!cur.lastReferral || ref > cur.lastReferral)) cur.lastReferral = ref;
      const adm = d.Admit_Date ? String(d.Admit_Date).slice(0, 10) : null;
      if (adm && adm >= since30 && adm <= todayISO && (!cur.lastAdmit || adm > cur.lastAdmit)) cur.lastAdmit = adm;
      out.set(acct, cur);
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/** Account ids with a call or meeting linked in the last 31 days, by these owners. */
export async function fetchRecentlyContacted(
  token: string,
  ownerIds: string[],
  todayISO: string,
): Promise<Set<string>> {
  const since = `${daysBefore(todayISO, 31)}T00:00:00-07:00`;
  const owners = ownerIds.map((o) => `'${o}'`).join(",");
  const out = new Set<string>();
  for (const [mod, field] of [["Events", "Start_DateTime"], ["Calls", "Call_Start_Time"]] as const) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await coql(
        token,
        `select id, What_Id, '$se_module' from ${mod} ` +
          `where (Owner in (${owners}) and (What_Id is not null and ${field} >= '${since}')) ` +
          `order by id limit ${PAGE} offset ${offset}`,
      );
      for (const r of page) {
        if (String(r["$se_module"] ?? "") !== "Accounts") continue;
        const id = (r.What_Id as { id?: string } | null)?.id;
        if (id) out.add(id);
      }
      if (page.length < PAGE) break;
    }
  }
  return out;
}

/**
 * For an account with recent contact: its first contact date if that falls in
 * the last 30 days, else "older".
 */
export async function firstContactFor(
  token: string,
  accountId: string,
  todayISO: string,
): Promise<string | "older"> {
  const cutoff = `${daysBefore(todayISO, 30)}T00:00:00-07:00`;
  let earliest: string | null = null;
  for (const [mod, field] of [["Events", "Start_DateTime"], ["Calls", "Call_Start_Time"]] as const) {
    const rows = await coql(
      token,
      `select id, ${field} from ${mod} where What_Id = '${accountId}' order by ${field} asc limit 1`,
    );
    const t = rows[0]?.[field] ? String(rows[0][field]) : null;
    if (t && (!earliest || t < earliest)) earliest = t;
  }
  if (!earliest || earliest < cutoff) return "older";
  return phoenixDate(earliest);
}

/**
 * Everything one evaluation needs, fetched once and reused across accounts
 * (the daily report evaluates every BD account; the weekly audit five per rep).
 */
export function stageFactsSource(token: string, ownerIds: string[], todayISO: string) {
  let referrals: ReturnType<typeof fetchReferralFacts> | null = null;
  let recent: ReturnType<typeof fetchRecentlyContacted> | null = null;
  return async (accountId: string): Promise<StageFacts> => {
    referrals ??= fetchReferralFacts(token, todayISO);
    recent ??= fetchRecentlyContacted(token, ownerIds, todayISO);
    const r = (await referrals).get(accountId) ?? { lastReferral: null, lastAdmit: null };
    const firstContact = (await recent).has(accountId)
      ? await firstContactFor(token, accountId, todayISO)
      : undefined;
    return { ...r, firstContact };
  };
}
