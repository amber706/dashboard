import { assertEquals } from "jsr:@std/assert@1";
import { LEAD_RULES, CONTACT_RULES, DEAL_RULES, DAILY_RULES } from "./admissions.ts";
import type { RecordContext, ItemResult, Score } from "../types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [],
    attachments: [],
    relatedMeetings: [],
    stageCategory: (raw) =>
      raw === "Closed Won" ? "closed_won_admitted"
        : raw === "Closed Lost" ? "closed_lost"
        : raw === "Closed - Referred Out Unattached" ? "closed_referred_out_unattached"
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

Deno.test("L18 defers — Partner Program does not exist in Zoho", () => {
  assertEquals(s(LEAD_RULES.L18(ctx({ Source_Category: "Business Development" }))), "DEFER");
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
  const c = ctx({}, { notesJudgments: { L26: { score: 0, reason: "No narrative." } } });
  const r = LEAD_RULES.L26(c) as ItemResult;
  assertEquals(r.score, 0);
  assertEquals(r.explanation, "No narrative.");
});

Deno.test("L26 defers rather than zeroing when the judge is unavailable", () => {
  // A model outage must never cost a rep points.
  assertEquals(s(LEAD_RULES.L26(ctx({}))), "DEFER");
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
