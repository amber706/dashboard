import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  ACTIVITY_DATE_FIELD,
  buildWindowQuery,
  MODULE_SELECT,
  moduleForTeam,
  whatIdModuleOf,
} from "./zoho.ts";

const bounds = { from: "2026-09-07T00:00:00-07:00", toExclusive: "2026-09-14T00:00:00-07:00" };

Deno.test("query filters by owner and by created-or-modified inside the window", () => {
  const q = buildWindowQuery("Leads", "id,Last_Name,Phone", "4402", bounds, 0);
  assertStringIncludes(q, "from Leads");
  assertStringIncludes(q, "Owner = '4402'");
  assertStringIncludes(q, "Created_Time >= '2026-09-07T00:00:00-07:00'");
  assertStringIncludes(q, "Modified_Time < '2026-09-14T00:00:00-07:00'");
  assertStringIncludes(q, "limit 200 offset 0");
});

Deno.test("offset advances by page", () => {
  const q = buildWindowQuery("Calls", "id", "1", bounds, 200);
  assertStringIncludes(q, "offset 200");
});

Deno.test("each team queries the modules its scorecard covers", () => {
  assertEquals(moduleForTeam("admissions"), ["Leads", "Contacts", "Deals"]);
  assertEquals(moduleForTeam("bd"), ["Contacts", "Calls", "Accounts", "Events"]);
});

Deno.test("select lists carry every field the rules actually read", () => {
  // A field missing from the select is null at scoring time, which silently
  // fails the rep on that line. These are the ones the traps depend on.
  assertStringIncludes(MODULE_SELECT.Leads, "Lead_Status");
  assertStringIncludes(MODULE_SELECT.Leads, "Lead_Score_Rating");
  assertStringIncludes(MODULE_SELECT.Leads, "DUI_or_Treatment");
  assertStringIncludes(MODULE_SELECT.Leads, "Digital_Source");
  assertStringIncludes(MODULE_SELECT.Deals, "Insurance_Provider_New");
  assertStringIncludes(MODULE_SELECT.Deals, "Outbound_Referral_BD_Rep");
  assertStringIncludes(MODULE_SELECT.Accounts, "Commerical_or_AHCCCS");
  assertStringIncludes(MODULE_SELECT.Accounts, "In_Network_Payers_Accepted");
  assertStringIncludes(MODULE_SELECT.Accounts, "OON_Preferred_Policies");
  assertStringIncludes(MODULE_SELECT.Contacts, "Associated_Facility");
});

Deno.test("every select list includes the timestamps same-day rules need", () => {
  for (const [mod, sel] of Object.entries(MODULE_SELECT)) {
    assertStringIncludes(sel, "Created_Time");
    if (mod !== "Accounts") assertStringIncludes(sel, "Owner");
  }
});

Deno.test("Calls and Events select $se_module so CA6/M6 can resolve Related To", () => {
  // Verified against live COQL: the pseudo-field must be single-quoted.
  assertStringIncludes(MODULE_SELECT.Calls, "'$se_module'");
  assertStringIncludes(MODULE_SELECT.Events, "'$se_module'");
});

Deno.test("whatIdModuleOf reads the pseudo-field Zoho returns", () => {
  assertEquals(whatIdModuleOf({ "$se_module": "Accounts" }), "Accounts");
  assertEquals(whatIdModuleOf({ "$se_module": "Deals" }), "Deals");
  assertEquals(whatIdModuleOf({}), null);
});

// Amber, reviewing Mike Mcluty's 9/7-9/13 BD scorecard: a "CHC- Guiding Road
// MTG" created 9/7 but scheduled for 9/23 was audited as that week's work.
// Windowing activities on Created/Modified pulled 45 events for him when only
// ~12 happened that week. A meeting belongs to the week it is HELD.
Deno.test("meetings are windowed on when they happen, not when they were booked", () => {
  const q = buildWindowQuery("Events", "id,Event_Title", "5162065000138237001", bounds, 0);
  assertStringIncludes(q, "Start_DateTime >= '2026-09-07T00:00:00-07:00'");
  assertStringIncludes(q, "Start_DateTime < '2026-09-14T00:00:00-07:00'");
  // Created/Modified must not creep back in — that is the bug.
  assertEquals(q.includes("Created_Time"), false);
  assertEquals(q.includes("Modified_Time"), false);
});

Deno.test("calls are windowed on when the call happened", () => {
  const q = buildWindowQuery("Calls", "id,Subject", "1", bounds, 0);
  assertStringIncludes(q, "Call_Start_Time >= '2026-09-07T00:00:00-07:00'");
  assertEquals(q.includes("Created_Time"), false);
});

Deno.test("record modules have no activity date and keep created-or-modified", () => {
  for (const m of ["Leads", "Contacts", "Deals", "Accounts"]) {
    assertEquals(ACTIVITY_DATE_FIELD[m], undefined);
    const q = buildWindowQuery(m, "id", "1", bounds, 0);
    assertStringIncludes(q, "Created_Time >=");
    assertStringIncludes(q, "Modified_Time <");
  }
});

Deno.test("every activity date field is actually selected, or it filters on a null", () => {
  for (const [m, field] of Object.entries(ACTIVITY_DATE_FIELD)) {
    assertStringIncludes(MODULE_SELECT[m], field);
  }
});
