// Admissions scorecard rules.
//
// Item ids are the template's own — A1-A6, L1-L28, C1-C13, D1-D41 — and must
// never be renumbered: a rep's notice cites the item number so they can find
// the failing line on their sheet.
//
// Field API names are the VERIFIED ones from docs/CRM_JAIL_FIELD_MAP.md, not
// the obvious guesses. Roughly a third of the guesses were wrong. Read that
// doc before changing any field reference here.

import type { ItemResult, RecordContext, Score } from "../types.ts";
import { isPresent, isProperCase, loggedSameDay, lookupPresent } from "./helpers.ts";

type RuleFn = (c: RecordContext) => Score | ItemResult;

const field = (name: string): RuleFn => (c) => (isPresent(c.record[name]) ? 1 : 0);
const lookup = (name: string): RuleFn => (c) => (lookupPresent(c.record[name]) ? 1 : 0);
const allOf = (...names: string[]): RuleFn => (c) =>
  names.every((n) => isPresent(c.record[n])) ? 1 : 0;

const KIPU_DEFER = "Deferred to Phase 2 — no KIPU access.";
const NO_FIELD = (what: string) =>
  `No Zoho field backs "${what}" — see docs/CRM_JAIL_FIELD_MAP.md. Score by hand.`;

const defer = (item: string, why: string): RuleFn => () => ({ item, score: "DEFER", explanation: why });

/** Gate a rule behind a condition; returns N/A when the gate is closed. */
const when = (gate: (c: RecordContext) => boolean, rule: RuleFn): RuleFn => (c) =>
  gate(c) ? rule(c) : "N/A";

const isBdSourced = (c: RecordContext) =>
  c.sourceCategory(c.record.Source_Category) === "business_development";
const stageIs = (cat: string) => (c: RecordContext) => c.stageCategory(c.record.Stage) === cat;
/**
 * Referred out covers BOTH normalized stages, verified against
 * reporting.stage_mapping 2026-09-15:
 *   closed_won_referred_out_unattached  ("Closed - Referred Out Unattached")
 *   referred_out_coming_back            ("Referred Out - Coming Back")
 * An earlier startsWith("closed_referred_out") matched neither and would have
 * scored D26-D31 N/A for every referred-out deal — silently excusing them.
 */
export const REFERRED_OUT_STAGES = [
  "closed_won_referred_out_unattached",
  "referred_out_coming_back",
] as const;

const isReferredOut = (c: RecordContext) =>
  (REFERRED_OUT_STAGES as readonly string[]).includes(c.stageCategory(c.record.Stage) ?? "");
const isAhcccs = (c: RecordContext) =>
  String(c.record.Insurance_Type ?? "").toLowerCase().includes("ahcccs");

/** Language items come from the notes judge. Absent a verdict they defer, never zero. */
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

const hasAttachment = (re: RegExp): RuleFn => (c) =>
  c.attachments.some((a) => re.test(a)) ? 1 : 0;

/**
 * "Created or updated the same day" cannot be tested from Created_Time vs
 * Modified_Time: that asks whether the record was never touched again, which
 * is a different — and for any live record, false — question. A deal opened in
 * June and worked in September is normal, and the rule failed all 15 sampled
 * deals while the auditors passed nearly all of them.
 *
 * Zoho does not record when the underlying work happened, only when the row
 * changed, so there is nothing honest to compare. Deferred to the auditor
 * rather than guessed.
 *
 * Note this does NOT apply to CA1 and M1: a Call and a Meeting each carry the
 * time the event occurred, so "logged the same day it happened" is a real
 * comparison there — and the bot agreed with Kenny's audit on it.
 */
const sameDayTouched: RuleFn = (item) => ({
  item: "",
  score: "DEFER",
  explanation: "Same-day logging is not derivable from Zoho timestamps — score by hand.",
});

const fullName = (c: RecordContext) =>
  `${c.record.First_Name ?? ""} ${c.record.Last_Name ?? ""}`.trim();

export const LEAD_RULES: Record<string, RuleFn> = {
  L1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  L2: (c) => (isProperCase(fullName(c)) ? 1 : 0),
  L3: field("Phone"),
  L4: field("Email"),
  L5: allOf("Emergency_Contact_Name", "Emergency_Contact_Phone_Number"),
  L6: field("Contact_Type"),
  L7: field("Lead_Status"), // labelled "Interaction Status"
  L8: lookup("Owner"), // labelled "Interaction Owner"
  L9: field("How_Did_You_Hear_About_Us"),
  L10: field("DUI_or_Treatment"), // labelled "Treatment or Court Services"
  L11: field("Level_of_Care_Requested"),
  L12: field("Age_Group"),
  L13: field("Lead_Score_Rating"),
  L14: field("Generated_By"),
  L15: field("Digital_Source"), // labelled "Tracking Source"
  L16: field("Source_Category"),
  L17: when(isBdSourced, field("BD_Rep")),
  // "Partner Program" is the referring company (Amber, 2026-09-15). On Leads
  // that lookup is Business_Contact_Name, labelled "Referring Company Name".
  // Note this is the same field L19 checks, so a BD-sourced lead earns both
  // points from one link — flagged rather than silently double-weighted.
  L18: when(isBdSourced, lookup("Business_Contact_Name")),
  L19: when(isBdSourced, lookup("Business_Contact_Name")), // "Referring Company Name"
  L20: when(isBdSourced, lookup("Referring_Contact_Business_Contact")),
  L21: field("Insurance_Type"),
  L22: (c) => (isPresent(c.record[isAhcccs(c) ? "AHCCCS_Insurance_Provider" : "Private_Insurance_Company"]) ? 1 : 0),
  L23: field("DOB"),
  L24: field("Member_ID"),
  L25: field("Insurance_Policy_Type"),
  L26: judged("L26"),
  L27: judged("L27"),
  L28: sameDayTouched,
};

export const CONTACT_RULES: Record<string, RuleFn> = {
  C1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  C2: (c) => (isProperCase(fullName(c)) ? 1 : 0),
  C3: field("Phone"),
  C4: field("Email"),
  C5: allOf("Emergency_Contact_Name", "Emergency_Contact_Phone_Number"),
  C6: field("Contact_Type"),
  C7: lookup("Owner"),
  // Contacts has NO Deal lookup field — the link is a related list, so this
  // reads the related-deal count rather than a field.
  C8: when(
    (c) => String(c.record.Contact_Type ?? "").toLowerCase().includes("family"),
    (c) => (c.relatedDealCount > 0 ? 1 : 0),
  ),
  C9: when((c) => isPresent(c.record.Business_Contact_Role), field("Business_Contact_Role")),
  // Confirmed by Amber 2026-09-15: "Associated Company" is Associated_Facility.
  // Account_Name ("Company Name") is a different field and does not satisfy it.
  C10: when((c) => isPresent(c.record.Business_Contact_Role), lookup("Associated_Facility")),
  // Cross-record: the contact's owner must match the owner of the company it
  // links to. Requires the Account to have been fetched.
  C11: when((c) => isPresent(c.record.Business_Contact_Role), (c) => {
    const owner = (c.record.Owner as { id?: string } | null)?.id ?? null;
    if (!owner || !c.accountOwnerId) {
      return { item: "C11", score: "DEFER" as const, explanation: "Company owner not resolved." };
    }
    return owner === c.accountOwnerId ? 1 : 0;
  }),
  C12: judged("C12"),
  C13: sameDayTouched,
};

export const DEAL_RULES: Record<string, RuleFn> = {
  // D1-D4 require a match against BOTH the Contact record and KIPU. The
  // Contact half is in contactMatch() below and unit-tested, but the item is
  // not scored until KIPU lands — a half-check would pass records that fail
  // the item as written.
  D1: defer("D1", KIPU_DEFER),
  D2: defer("D2", KIPU_DEFER),
  D3: defer("D3", KIPU_DEFER),
  D4: defer("D4", KIPU_DEFER),
  D5: allOf("Emergency_Contact_Name", "Emergency_Contact_Phone_Number"),
  D6: lookup("Owner"),
  // Dropped on Deals (Amber, 2026-09-15). The field exists only on Leads, and
  // D11 already covers attribution via Source_Category. N/A rather than DEFER
  // so it leaves the denominator instead of waiting on a human forever.
  D7: () => "N/A",
  D8: field("DUI_or_Treatment"),
  D9: field("Level_of_Care_Requested"),
  D10: field("Age_Group"),
  D11: field("Source_Category"),
  D12: when(isBdSourced, field("BD_Rep")),
  // "Partner Program" is the referring company (Amber, 2026-09-15). Same
  // field as D14, so one link earns both points — see L18.
  D13: when(isBdSourced, lookup("Referring_Company")),
  D14: when(isBdSourced, lookup("Referring_Company")),
  D15: when(isBdSourced, lookup("Referring_Business_Contact")),
  D16: field("Insurance_Type"),
  // Insurance_Provider_New holds the provider for BOTH payer types —
  // "Medicaid: Health Choice" and "Aetna" alike. Verified 2026-09-16:
  // AHCCCS_Insurance_Provider is null on every live deal, so branching on
  // payer type read a dead field and failed every AHCCCS record. That was 10
  // one-sided disagreements against the human auditors.
  D17: field("Insurance_Provider_New"),
  D18: field("DOB"),
  D19: field("Member_ID"),
  // Policy type is a commercial-plan concept. Verified 2026-09-16: Policy_Type
  // is populated ("PPO", "POS") on commercial deals and null on every AHCCCS
  // one, so scoring it there failed records that were correctly filled in.
  D20: when((c) => !isAhcccs(c), field("Policy_Type")),
  D21: field("VOB_Submitted_By"),
  D22: judged("D22"),
  D23: judged("D23"),
  // Consistency check only: does the stage carry the fields that stage implies?
  // Not a judgment of whether the rep chose the right stage.
  D24: (c) => {
    const cat = c.stageCategory(c.record.Stage);
    if (!cat) return 0;
    if (cat === "closed_won_admitted") return isPresent(c.record.Admit_Date) ? 1 : 0;
    if (cat === "closed_lost") {
      return isPresent(c.record.Lost_Reasoning) || isPresent(c.record.Close_Reasoning_DUI) ? 1 : 0;
    }
    return 1;
  },
  D25: sameDayTouched,
  D26: when(isReferredOut, field("Referred_Out")),
  D27: when(isReferredOut, field("Outbound_Referral_BD_Rep")),
  D28: when(isReferredOut, field("Refer_Out_Type")),
  D29: when(isReferredOut, field("Admitted_at_Referred_Facility")),
  D30: when(isReferredOut, field("Refer_Out_Date")),
  // "Follow-up scheduled" is a scheduled Call or Task on the deal (Amber,
  // 2026-09-15) — there is no follow-up date field. Same forward-looking
  // check CA9 and M9 use.
  D31: when(isReferredOut, (c) => (c.futureActivityCount > 0 ? 1 : 0)),
  D32: when(stageIs("closed_won_admitted"), (c) => {
    const closing = String(c.record.Closing_Date ?? "").slice(0, 10);
    const admit = String(c.record.Admit_Date ?? "").slice(0, 10);
    return closing && admit && closing === admit ? 1 : 0;
  }),
  D33: defer("D33", KIPU_DEFER),
  D34: defer("D34", KIPU_DEFER),
  // Admitted location has no field of its own: it is encoded in the close
  // reason picked when the deal moves to Admitted, e.g.
  // "Admitted - Scottsdale OTC" (verified against live admitted deals
  // 2026-09-15). The Zoho half is checkable now; matching it to KIPU is
  // still Phase 2.
  D35: when(stageIs("closed_won_admitted"), (c) => (admittedLocation(c.record.Lost_Reasoning) ? 1 : 0)),
  D36: when(stageIs("closed_lost"), (c) =>
    isPresent(c.record.Lost_Reasoning) || isPresent(c.record.Close_Reasoning_DUI) ? 1 : 0),
  D37: when(stageIs("closed_lost"), judged("D37")),
  // A referral packet is not identifiable from a filename. Checked against
  // live BD-sourced deals 2026-09-16: real attachments are named
  // "PreAssessment.pdf" and "VOB Severns.pdf" — nothing carries "referral", and
  // the auditors passed all 6 records the filename match failed. A human knows
  // a referral packet by opening it; the bot sees only a name.
  //
  // D39 and D40 are deliberately kept: "VOB Severns.pdf" and
  // "PreAssessment.pdf" do match their patterns on real records.
  D38: when(isBdSourced, () => ({
    item: "D38",
    score: "DEFER" as const,
    explanation: "A referral packet cannot be identified from a filename — score by hand.",
  })),
  D39: hasAttachment(/vob/i),
  D40: hasAttachment(/pre[-_ ]?(screen|assess)/i),
  D41: when(
    (c) => String(c.record.Insurance_Type ?? "").toLowerCase().includes("commercial"),
    hasAttachment(/insurance[-_ ]?card|ins[-_ ]?card/i),
  ),
};

/**
 * Pulls the admitted location out of the close-reason picklist, which is where
 * it lives: "Admitted - Scottsdale OTC" -> "Scottsdale OTC". Returns null when
 * the value is absent or is a plain "Admitted" with no location.
 */
export function admittedLocation(lostReasoning: unknown): string | null {
  const m = String(lostReasoning ?? "").match(/^Admitted\s*-\s*(.+)$/);
  return m ? m[1].trim() : null;
}

/** The Contact-record half of D1-D4. Built and tested now, wired up in Phase 2. */
export function contactMatch(
  deal: Record<string, unknown>,
  contact: Record<string, unknown>,
  fieldName: string,
): boolean {
  const a = String(deal[fieldName] ?? "").trim().toLowerCase();
  const b = String(contact[fieldName] ?? "").trim().toLowerCase();
  return a !== "" && a === b;
}

/** Section A is scored once per cycle over ALL the rep's window activity, not a sample. */
export const DAILY_RULES = {
  A1: "DEFER" as const, // EOD report same-day — Google Sheet, Phase 2
  A2: "DEFER" as const, // EOD report complete — Google Sheet, Phase 2
  A3: (all: Array<{ Created_Time?: string; Modified_Time?: string }>): Score =>
    all.length === 0 ? "N/A"
      : all.every((r) =>
          loggedSameDay(String(r.Created_Time ?? ""), String(r.Modified_Time ?? r.Created_Time ?? ""))
        )
      ? 1
      : 0,
  A4: "DEFER" as const, // Daily Census — Google Sheet, Phase 2
  A5: "DEFER" as const, // Daily Census spelling — Google Sheet + KIPU, Phase 2
  A6: "DEFER" as const, // Intake Tracker — Google Sheet, Phase 2
};
