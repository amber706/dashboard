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
    relatedDealCount: 0, futureActivityCount: 0, accountOwnerId: null, whatIdModule: null, whoContactType: null,
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

// Amber, 2026-09-16: a call always needs an associated contact, and only if
// that contact is a Business Contact does it also need an associated company.
// A Lead or a Family/Friend has no company to associate. Scored as a flat
// requirement, CA6 failed every call to a client or a family member — 0 on all
// five of Mike Mcluty's sampled calls, for records never expected to have one.
Deno.test("CA6 only applies when the call is with a Business Contact", () => {
  const withContact = { Who_Id: { id: "7" }, What_Id: { id: "9" } };

  assertEquals(
    s(CALL_RULES.CA6(ctx(withContact, { whoContactType: "Business Contact", whatIdModule: "Accounts" }))),
    1,
  );
  // A business contact whose Related To points at a Deal is still a miss.
  assertEquals(
    s(CALL_RULES.CA6(ctx(withContact, { whoContactType: "Business Contact", whatIdModule: "Deals" }))),
    0,
  );
  // ...and one with no company at all.
  assertEquals(
    s(CALL_RULES.CA6(ctx({ Who_Id: { id: "7" }, What_Id: null }, { whoContactType: "Business Contact" }))),
    0,
  );

  // Anyone else: the line does not apply.
  for (const type of ["Lead", "Family/Friend", "Alumni", "Employee", "Vendor"]) {
    assertEquals(s(CALL_RULES.CA6(ctx(withContact, { whoContactType: type }))), "N/A", type);
  }
});

Deno.test("a call with no contact fails CA6 — it is not exempt", () => {
  // Amber, 2026-09-16: "no contact is a fail". An empty call must not escape
  // into N/A just because CA5 already caught it.
  assertEquals(s(CALL_RULES.CA6(ctx({ Who_Id: null, What_Id: null }))), 0);
  assertEquals(s(CALL_RULES.CA6(ctx({ Who_Id: null, What_Id: { id: "9" } }))), 0);
});

Deno.test("CA6 defers rather than guessing when the contact type is unreadable", () => {
  const out = CALL_RULES.CA6(ctx({ Who_Id: { id: "7" }, What_Id: null }, { whoContactType: null }));
  assertEquals(s(out), "DEFER");
});

Deno.test("CA5 requires an associated contact on every call, unconditionally", () => {
  assertEquals(s(CALL_RULES.CA5(ctx({ Who_Id: null }))), 0);
  assertEquals(s(CALL_RULES.CA5(ctx({ Who_Id: { id: "7" } }))), 1);
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

Deno.test("BC6 accepts only Associated_Facility, not Company Name", () => {
  // Confirmed by Amber 2026-09-15.
  assertEquals(s(BC_RULES.BC6(ctx({ Associated_Facility: { id: "9" } }))), 1);
  assertEquals(s(BC_RULES.BC6(ctx({ Account_Name: { id: "9" } }))), 0);
  assertEquals(s(BC_RULES.BC6(ctx({}))), 0);
});

// Amber, 2026-09-16: "they were filling out the description field but now its
// notes. you can use both if theres nothing in either than its a 0." The
// Event's Description is folded into the notes the judge reads, so a meeting
// documented in either place counts and only an empty one fails.
Deno.test("M7 passes on a meeting documented in the Description alone", () => {
  const c = ctx({}, {
    notes: [{ Note_Title: "Description", Note_Content: "Account review. Next meeting: 9/23." }],
    notesIncludeDescription: true,
    notesJudgments: { M7: { score: 1, reason: "Agenda present." } },
  });
  assertEquals(s(MEETING_RULES.M7(c)), 1);
});

Deno.test("M7 fails only when Notes and Description are both empty, and says so", () => {
  const out = MEETING_RULES.M7(ctx({}, { notes: [], notesIncludeDescription: true }));
  assertEquals(s(out), 0);
  assertEquals(
    (out as { explanation?: string }).explanation,
    "Nothing in the Notes section and nothing in the Description.",
  );
});

Deno.test("sections without a Description keep the plain no-note wording", () => {
  const out = CALL_RULES.CA7(ctx({}, { notes: [], notesIncludeDescription: false }));
  assertEquals((out as { explanation?: string }).explanation, "No note on the record.");
});
