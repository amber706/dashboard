import { assertEquals } from "jsr:@std/assert@1";
import { LEAD_RULES, CONTACT_RULES, DEAL_RULES, DAILY_RULES, admittedLocation } from "./admissions.ts";
import type { RecordContext, ItemResult, Score } from "../types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [],
    attachments: [],
    relatedMeetings: [],
    // Mirrors reporting.stage_mapping exactly — these are the real
    // normalized values, verified live 2026-09-15.
    stageCategory: (raw) =>
      raw === "Closed Won" || raw === "Closed - Admitted" ? "closed_won_admitted"
        : raw === "Closed Lost" || raw === "Closed - Lost (Treatment)" ? "closed_lost"
        : raw === "Closed - Referred Out Unattached" ? "closed_won_referred_out_unattached"
        : raw === "Referred Out - Coming Back" ? "referred_out_coming_back"
        : null,
    sourceCategory: (raw) => (raw === "Business Development" ? "business_development" : null),
    window: { startISO: "2026-09-07", endISO: "2026-09-13" },
    notesJudgments: {},
    relatedDealCount: 0,
    futureActivityCount: 0,
    accountOwnerId: null,
    whatIdModule: null,
    ...over,
  };
}
const s = (r: Score | ItemResult): Score => (typeof r === "object" ? r.score : r);

Deno.test("L3 scores phone presence", () => {
  assertEquals(s(LEAD_RULES.L3(ctx({ Phone: "6025551234" }))), 1);
  assertEquals(s(LEAD_RULES.L3(ctx({ Phone: null }))), 0);
});

Deno.test("L2 fails an all-caps name", () => {
  assertEquals(s(LEAD_RULES.L2(ctx({ First_Name: "WAYNE", Last_Name: "JACKSON" }))), 0);
  assertEquals(s(LEAD_RULES.L2(ctx({ First_Name: "Wayne", Last_Name: "Jackson" }))), 1);
});

Deno.test("L5 requires BOTH emergency contact fields", () => {
  assertEquals(s(LEAD_RULES.L5(ctx({ Emergency_Contact_Name: "Jo", Emergency_Contact_Phone_Number: "602" }))), 1);
  assertEquals(s(LEAD_RULES.L5(ctx({ Emergency_Contact_Name: "Jo" }))), 0);
});

Deno.test("L7 reads Lead_Status, which is labelled Interaction Status", () => {
  assertEquals(s(LEAD_RULES.L7(ctx({ Lead_Status: "Pending Initial Contact" }))), 1);
  assertEquals(s(LEAD_RULES.L7(ctx({ Lead_Status: null }))), 0);
});

Deno.test("L13 reads Lead_Score_Rating, not Lead_Score", () => {
  assertEquals(s(LEAD_RULES.L13(ctx({ Lead_Score_Rating: 4 }))), 1);
});

Deno.test("L17 is N/A when the lead is not BD-sourced", () => {
  assertEquals(s(LEAD_RULES.L17(ctx({ Source_Category: "Google Ads" }))), "N/A");
});

Deno.test("L17 is scored when the lead is BD-sourced", () => {
  assertEquals(s(LEAD_RULES.L17(ctx({ Source_Category: "Business Development", BD_Rep: null }))), 0);
});

Deno.test("L18 Partner Program reads the referring company", () => {
  assertEquals(s(LEAD_RULES.L18(ctx({ Source_Category: "Business Development", Business_Contact_Name: { id: "9" } }))), 1);
  assertEquals(s(LEAD_RULES.L18(ctx({ Source_Category: "Business Development" }))), 0);
  assertEquals(s(LEAD_RULES.L18(ctx({ Source_Category: "Google Ads" }))), "N/A");
});

Deno.test("D7 is skipped on Deals and leaves the denominator", () => {
  // N/A, not DEFER — it must not sit waiting on a human forever.
  assertEquals(s(DEAL_RULES.D7(ctx({}))), "N/A");
});

Deno.test("D31 looks for a scheduled call or task, not a field", () => {
  const ref = { Stage: "Closed - Referred Out Unattached" };
  assertEquals(s(DEAL_RULES.D31(ctx(ref, { futureActivityCount: 1 }))), 1);
  assertEquals(s(DEAL_RULES.D31(ctx(ref, { futureActivityCount: 0 }))), 0);
  assertEquals(s(DEAL_RULES.D31(ctx({ Stage: "Closed Won" }))), "N/A");
});

Deno.test("admittedLocation parses the close-reason picklist", () => {
  // Verified against live admitted deals 2026-09-15.
  assertEquals(admittedLocation("Admitted - Scottsdale OTC"), "Scottsdale OTC");
  assertEquals(admittedLocation("Admitted - Maryvale OTC"), "Maryvale OTC");
  assertEquals(admittedLocation("Admitted - Grayhawk Manor BHRF"), "Grayhawk Manor BHRF");
  // A bare "Admitted" carries no location.
  assertEquals(admittedLocation("Admitted"), null);
  assertEquals(admittedLocation(null), null);
  assertEquals(admittedLocation("Referred Out - Unwilling"), null);
});

Deno.test("D35 scores the admitted location from the close reason", () => {
  assertEquals(s(DEAL_RULES.D35(ctx({ Stage: "Closed Won", Lost_Reasoning: "Admitted - Scottsdale OTC" }))), 1);
  assertEquals(s(DEAL_RULES.D35(ctx({ Stage: "Closed Won", Lost_Reasoning: "Admitted" }))), 0);
  assertEquals(s(DEAL_RULES.D35(ctx({ Stage: "Closed Lost" }))), "N/A");
});

Deno.test("L22 checks the AHCCCS provider field when the policy is AHCCCS", () => {
  assertEquals(s(LEAD_RULES.L22(ctx({ Insurance_Type: "AHCCCS", AHCCCS_Insurance_Provider: "Mercy" }))), 1);
  assertEquals(s(LEAD_RULES.L22(ctx({ Insurance_Type: "AHCCCS", Private_Insurance_Company: "Aetna" }))), 0);
});

Deno.test("D17 uses Insurance_Provider_New, never the DNU field", () => {
  assertEquals(s(DEAL_RULES.D17(ctx({ Insurance_Type: "Commercial", Insurance_Provider_New: "Aetna" }))), 1);
  // Private_Insurance_Company is labelled (DNU) on Deals — filling it must not pass.
  assertEquals(s(DEAL_RULES.D17(ctx({ Insurance_Type: "Commercial", Private_Insurance_Company: "Aetna" }))), 0);
});

Deno.test("D33 defers — KIPU is Phase 2", () => {
  assertEquals(s(DEAL_RULES.D33(ctx({}))), "DEFER");
});

Deno.test("D36 reads the pipeline-specific close reason field", () => {
  assertEquals(s(DEAL_RULES.D36(ctx({ Stage: "Closed Lost", Lost_Reasoning: "Went elsewhere" }))), 1);
  assertEquals(s(DEAL_RULES.D36(ctx({ Stage: "Closed Lost", Close_Reasoning_DUI: "Court dismissed" }))), 1);
  assertEquals(s(DEAL_RULES.D36(ctx({ Stage: "Closed Lost" }))), 0);
  assertEquals(s(DEAL_RULES.D36(ctx({ Stage: "Closed Won" }))), "N/A");
});

Deno.test("D26-D30 are N/A unless the deal was referred out", () => {
  assertEquals(s(DEAL_RULES.D27(ctx({ Stage: "Closed Won" }))), "N/A");
  assertEquals(
    s(DEAL_RULES.D27(ctx({ Stage: "Closed - Referred Out Unattached", Outbound_Referral_BD_Rep: "Joey" }))),
    1,
  );
});

Deno.test("D39 checks for a VOB attachment by filename", () => {
  assertEquals(s(DEAL_RULES.D39(ctx({}, { attachments: ["VOB_Jackson.pdf"] }))), 1);
  assertEquals(s(DEAL_RULES.D39(ctx({}, { attachments: ["insurance_card.jpg"] }))), 0);
});

Deno.test("L26 reads the notes judge verdict", () => {
  const c = ctx({}, {
    notes: [{ Note_Content: "Called the client." }],
    notesJudgments: { L26: { score: 0, reason: "No narrative." } },
  });
  const r = LEAD_RULES.L26(c) as ItemResult;
  assertEquals(r.score, 0);
  assertEquals(r.explanation, "No narrative.");
});

Deno.test("L26 defers rather than zeroing when the judge is unavailable", () => {
  // A model outage must never cost a rep points — but only when there IS a
  // note to judge. An absent note is a plain 0.
  assertEquals(s(LEAD_RULES.L26(ctx({}, { notes: [{ Note_Content: "Called." }] }))), "DEFER");
});

Deno.test("A3 passes only when every record in the window was logged same day", () => {
  assertEquals(DAILY_RULES.A3([]), "N/A");
  assertEquals(DAILY_RULES.A3([{ Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-08T18:00:00Z" }]), 1);
  assertEquals(DAILY_RULES.A3([{ Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-10T18:00:00Z" }]), 0);
});

Deno.test("C8 reads the related-deal count — Contacts has no Deal lookup field", () => {
  assertEquals(s(CONTACT_RULES.C8(ctx({ Contact_Type: "Family" }, { relatedDealCount: 1 }))), 1);
  assertEquals(s(CONTACT_RULES.C8(ctx({ Contact_Type: "Family" }, { relatedDealCount: 0 }))), 0);
  assertEquals(s(CONTACT_RULES.C8(ctx({ Contact_Type: "Client" }))), "N/A");
});

Deno.test("referred-out items fire for BOTH referred-out stages", () => {
  // A startsWith() guess matched neither real value and would have scored
  // D26-D31 N/A for every referred-out deal, silently excusing them.
  for (const stage of ["Closed - Referred Out Unattached", "Referred Out - Coming Back"]) {
    assertEquals(s(DEAL_RULES.D26(ctx({ Stage: stage, Referred_Out: "Other Facility" }))), 1, stage);
    assertEquals(s(DEAL_RULES.D28(ctx({ Stage: stage }))), 0, stage);
    assertEquals(s(DEAL_RULES.D31(ctx({ Stage: stage }, { futureActivityCount: 1 }))), 1, stage);
  }
  // And stay N/A when the deal was not referred out.
  assertEquals(s(DEAL_RULES.D26(ctx({ Stage: "Closed - Admitted" }))), "N/A");
});

Deno.test("admitted items fire on the real admitted stage name", () => {
  assertEquals(s(DEAL_RULES.D35(ctx({ Stage: "Closed - Admitted", Lost_Reasoning: "Admitted - Maryvale OTC" }))), 1);
});

Deno.test("a record with no note scores 0, not DEFER", () => {
  // The most common miss there is. Deferring it would quietly excuse it.
  const r = LEAD_RULES.L26(ctx({}, { notes: [] })) as ItemResult;
  assertEquals(r.score, 0);
  assertEquals(r.explanation, "No note on the record.");
});

Deno.test("a record WITH a note defers only when the judge is unavailable", () => {
  const withNote = ctx({}, { notes: [{ Note_Content: "Spoke with the client about intake." }] });
  assertEquals(s(LEAD_RULES.L26(withNote)), "DEFER");
  const judged = ctx({}, {
    notes: [{ Note_Content: "Spoke with the client about intake." }],
    notesJudgments: { L26: { score: 1, reason: "Clear narrative." } },
  });
  assertEquals(s(LEAD_RULES.L26(judged)), 1);
});

Deno.test("a whitespace-only note counts as no note", () => {
  assertEquals(s(LEAD_RULES.L26(ctx({}, { notes: [{ Note_Content: "   " }] }))), 0);
});

Deno.test("a FAILED notes fetch defers — it is not evidence the rep wrote nothing", () => {
  const r = LEAD_RULES.L26(ctx({}, { notes: [], notesUnavailable: true })) as ItemResult;
  assertEquals(r.score, "DEFER");
  assertEquals(r.explanation, "Could not read the record's notes.");
});
