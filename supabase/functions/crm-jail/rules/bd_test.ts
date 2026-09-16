import { assertEquals } from "jsr:@std/assert@1";
import { BC_RULES, CALL_RULES, COMPANY_RULES, MEETING_RULES, BD_DAILY_RULES } from "./bd.ts";
import type { ItemResult, RecordContext, Score } from "../types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [], attachments: [], relatedMeetings: [],
    stageCategory: () => null, sourceCategory: () => null,
    window: { startISO: "2026-08-31", endISO: "2026-09-06" },
    notesJudgments: {},
    relatedDealCount: 0, futureActivityCount: 0, accountOwnerId: null, whatIdModule: null,
    ...over,
  };
}
const s = (r: Score | ItemResult): Score => (typeof r === "object" ? r.score : r);

Deno.test("there is no BC3 — the template skips it", () => {
  assertEquals("BC3" in BC_RULES, false);
  assertEquals("BC4" in BC_RULES, true);
});

Deno.test("CA1 fails a call logged days after it occurred", () => {
  // Kenny's sheet: occurred Fri 4 Sep, logged Mon 7 Sep. Failed 5/5.
  assertEquals(s(CALL_RULES.CA1(ctx({ Call_Start_Time: "2026-09-04T17:20:00Z", Created_Time: "2026-09-07T15:45:00Z" }))), 0);
  assertEquals(s(CALL_RULES.CA1(ctx({ Call_Start_Time: "2026-09-04T17:20:00Z", Created_Time: "2026-09-04T17:47:00Z" }))), 1);
});

Deno.test("CA6 requires Related To to point at a Company, not just be set", () => {
  // Kenny failed this 5/5.
  assertEquals(s(CALL_RULES.CA6(ctx({ What_Id: null }))), 0);
  assertEquals(s(CALL_RULES.CA6(ctx({ What_Id: { id: "9" } }, { whatIdModule: "Accounts" }))), 1);
  // Pointing at a Deal is not "Associated Company".
  assertEquals(s(CALL_RULES.CA6(ctx({ What_Id: { id: "9" } }, { whatIdModule: "Deals" }))), 0);
});

Deno.test("CA9 uses a forward-looking activity query — no field backs it", () => {
  assertEquals(s(CALL_RULES.CA9(ctx({}, { futureActivityCount: 0 }))), 0);
  assertEquals(s(CALL_RULES.CA9(ctx({}, { futureActivityCount: 2 }))), 1);
});

Deno.test("CO12 reads Zoho's misspelled API name", () => {
  assertEquals(s(COMPANY_RULES.CO12(ctx({ Commerical_or_AHCCCS: "Commercial" }))), 1);
  // The correctly-spelled name does not exist in Zoho and must not pass.
  assertEquals(s(COMPANY_RULES.CO12(ctx({ Commercial_or_AHCCCS: "Commercial" }))), 0);
});

Deno.test("CO13 reads Payers, not Payors", () => {
  assertEquals(s(COMPANY_RULES.CO13(ctx({ In_Network_Payers_Accepted: "Aetna" }))), 1);
});

Deno.test("CO18 checks the next scheduled contact date", () => {
  // Kenny failed this 5/5.
  assertEquals(s(COMPANY_RULES.CO18(ctx({ Date_of_Next_Scheduled_Contact: null }))), 0);
  assertEquals(s(COMPANY_RULES.CO18(ctx({ Date_of_Next_Scheduled_Contact: "2026-09-20" }))), 1);
});

Deno.test("CO7 accepts either the single Address field or the billing parts", () => {
  assertEquals(s(COMPANY_RULES.CO7(ctx({ Address: "123 Main St, Phoenix AZ" }))), 1);
  assertEquals(s(COMPANY_RULES.CO7(ctx({ Billing_Street: "123 Main", Billing_City: "Phoenix", Billing_State: "AZ" }))), 1);
  assertEquals(s(COMPANY_RULES.CO7(ctx({ Billing_City: "Phoenix" }))), 0);
});

Deno.test("BC10 is N/A when there are no future meetings to verify", () => {
  assertEquals(s(BC_RULES.BC10(ctx({}, { relatedMeetings: [] }))), "N/A");
});

Deno.test("M5 requires an associated contact on the meeting", () => {
  assertEquals(s(MEETING_RULES.M5(ctx({ Who_Id: null }))), 0);
  assertEquals(s(MEETING_RULES.M5(ctx({ Who_Id: { id: "7" } }))), 1);
});

Deno.test("M2 reads Event_Title, which Zoho labels 'Title'", () => {
  assertEquals(s(MEETING_RULES.M2(ctx({ Event_Title: "Cornerstone x Vivant Lunch" }))), 1);
});

Deno.test("BD daily items A4/A5 aggregate over the whole window", () => {
  assertEquals(BD_DAILY_RULES.A4([]), "N/A");
  assertEquals(BD_DAILY_RULES.A4([{ Call_Start_Time: "2026-09-04T17:20:00Z", Created_Time: "2026-09-07T15:45:00Z" }]), 0);
  assertEquals(BD_DAILY_RULES.A5([{ Start_DateTime: "2026-09-01T16:00:00Z", Created_Time: "2026-09-01T17:00:00Z" }]), 1);
});
