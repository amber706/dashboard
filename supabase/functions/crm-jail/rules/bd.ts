// BD scorecard rules.
//
// Ids come from the BD template: A1-A7, BC1, BC2, BC4-BC11 (there is NO BC3),
// CA1-CA9, CO1-CO18, M1-M9. Do not renumber.
//
// Field API names are the VERIFIED ones from docs/CRM_JAIL_FIELD_MAP.md.
// Watch for: Commerical_or_AHCCCS (typo is in Zoho, not here), Payers not
// Payors, and Niche not Niche_Code.

import type { ItemResult, RecordContext, Score } from "../types.ts";
import { isPresent, isProperCase, loggedSameDay, lookupPresent } from "./helpers.ts";

type RuleFn = (c: RecordContext) => Score | ItemResult;

const field = (name: string): RuleFn => (c) => (isPresent(c.record[name]) ? 1 : 0);
const lookup = (name: string): RuleFn => (c) => (lookupPresent(c.record[name]) ? 1 : 0);

/**
 * Language items.
 *
 * Three distinct outcomes, and the difference matters:
 *   no note at all -> 0. The rep did not write one; that is a fail, not an
 *                     unknown, and deferring it would quietly excuse the most
 *                     common miss there is.
 *   a verdict      -> whatever the judge decided, with its reason.
 *   no verdict     -> DEFER. The judge was unavailable; a model outage must
 *                     never cost a rep points.
 */
const judged = (item: string): RuleFn => (c) => {
  // A broken fetch is not evidence the rep wrote nothing.
  if (c.notesUnavailable) {
    return { item, score: "DEFER", explanation: "Could not read the record's notes." };
  }
  const hasNote = c.notes.some((n) =>
    String(n.Note_Content ?? "").trim() !== "" || String(n.Note_Title ?? "").trim() !== ""
  );
  if (!hasNote) return { item, score: 0, explanation: "No note on the record." };
  const v = c.notesJudgments[item];
  if (!v) return { item, score: "DEFER", explanation: "Notes judging unavailable." };
  return { item, score: v.score, explanation: v.reason };
};

const fullName = (c: RecordContext) =>
  `${c.record.First_Name ?? ""} ${c.record.Last_Name ?? ""}`.trim();

/**
 * What_Id on Calls and Events is polymorphic ("Related To") — it can point at
 * an Account, a Deal, or others. "Associated Company" is only satisfied when
 * it actually points at an Account.
 */
const relatedToAccount: RuleFn = (c) => {
  if (!lookupPresent(c.record.What_Id)) return 0;
  if (c.whatIdModule === null) {
    return { item: "", score: "DEFER", explanation: "Could not resolve what Related To points at." };
  }
  return c.whatIdModule === "Accounts" ? 1 : {
    item: "",
    score: 0 as const,
    explanation: `Related To points at ${c.whatIdModule}, not a Company.`,
  };
};

/** "Next call or meeting is scheduled" — no field backs this; it is a forward-looking query. */
const hasFutureActivity: RuleFn = (c) => (c.futureActivityCount > 0 ? 1 : 0);

export const BC_RULES: Record<string, RuleFn> = {
  BC1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  BC2: (c) => (isProperCase(fullName(c)) ? 1 : 0),
  // There is deliberately no BC3 — the template skips it.
  BC4: field("Phone"),
  BC5: field("Email"),
  // Confirmed by Amber 2026-09-15: "Associated Company" is Associated_Facility.
  // Account_Name ("Company Name") is a different field and does not satisfy it.
  BC6: lookup("Associated_Facility"),
  BC7: lookup("Owner"),
  BC8: field("Business_Contact_Role"),
  BC9: (c) => {
    const now = new Date().toISOString();
    const past = c.relatedMeetings.filter((m) => (m.Start_DateTime ?? "") < now);
    return past.length === 0 ? "N/A" : past.every((m) => isPresent(m.Start_DateTime)) ? 1 : 0;
  },
  BC10: (c) => {
    const now = new Date().toISOString();
    const future = c.relatedMeetings.filter((m) => (m.Start_DateTime ?? "") >= now);
    return future.length === 0 ? "N/A" : 1;
  },
  BC11: judged("BC11"),
};

export const CALL_RULES: Record<string, RuleFn> = {
  CA1: (c) =>
    loggedSameDay(String(c.record.Call_Start_Time ?? ""), String(c.record.Created_Time ?? "")) ? 1 : 0,
  CA2: field("Subject"),
  CA3: field("Call_Start_Time"),
  CA4: lookup("Owner"),
  CA5: lookup("Who_Id"), // labelled "Contact Name"
  CA6: relatedToAccount,
  CA7: judged("CA7"),
  CA8: judged("CA8"),
  CA9: hasFutureActivity,
};

export const COMPANY_RULES: Record<string, RuleFn> = {
  CO1: lookup("Owner"), // labelled "Company Owner"
  CO2: field("Account_Name"), // labelled "Company Name"
  CO3: (c) => (isProperCase(c.record.Account_Name) ? 1 : 0),
  CO4: field("Website"),
  CO5: field("Main_Business_Phone"),
  CO6: field("Phone"),
  CO7: (c) =>
    isPresent(c.record.Address) ||
      ["Billing_Street", "Billing_City", "Billing_State"].every((p) => isPresent(c.record[p]))
      ? 1
      : 0,
  CO8: field("Business_Contact_Pipeline_Stage"), // the only real picklist; the others are text shadows
  CO9: field("Niche"), // labelled "Niche Code"
  CO10: field("Reciprocity"),
  CO11: field("Unattached_or_Attached"),
  CO12: field("Commerical_or_AHCCCS"), // sic — the typo is in Zoho's API name
  CO13: field("In_Network_Payers_Accepted"), // Payers, not Payors
  CO14: field("OON_Preferred_Policies"), // Zoho says "Preferred"; the scorecard says "Referred"
  CO15: field("Level_of_Care"),
  CO16: field("States_Services_Are_Provided_In"),
  CO17: field("What_do_they_treat"),
  CO18: field("Date_of_Next_Scheduled_Contact"),
};

export const MEETING_RULES: Record<string, RuleFn> = {
  M1: (c) =>
    loggedSameDay(String(c.record.Start_DateTime ?? ""), String(c.record.Created_Time ?? "")) ? 1 : 0,
  M2: field("Event_Title"), // labelled "Title"
  M3: field("Start_DateTime"), // labelled "From"
  M4: lookup("Owner"), // labelled "Host"
  M5: lookup("Who_Id"),
  M6: relatedToAccount,
  M7: judged("M7"),
  M8: judged("M8"),
  M9: hasFutureActivity,
};

/** Section A, scored once per cycle over all window activity, not a sample. */
export const BD_DAILY_RULES = {
  A1: "DEFER" as const, // Referral form complete — Zoho Forms, Phase 2
  A2: "DEFER" as const, // EOD report same-day — PDFs in Drive, Phase 2
  A3: "DEFER" as const, // EOD report complete — PDFs in Drive, Phase 2
  A4: (calls: Array<{ Call_Start_Time?: string; Created_Time?: string }>): Score =>
    calls.length === 0
      ? "N/A"
      : calls.every((r) =>
          loggedSameDay(String(r.Call_Start_Time ?? ""), String(r.Created_Time ?? ""))
        )
      ? 1
      : 0,
  A5: (meetings: Array<{ Start_DateTime?: string; Created_Time?: string }>): Score =>
    meetings.length === 0
      ? "N/A"
      : meetings.every((r) =>
          loggedSameDay(String(r.Start_DateTime ?? ""), String(r.Created_Time ?? ""))
        )
      ? 1
      : 0,
  A6: "DEFER" as const, // Assigned spreadsheet updated — Google Sheet, Phase 2
  A7: "DEFER" as const, // Assigned spreadsheet reconciles to Zoho — Phase 2
};
