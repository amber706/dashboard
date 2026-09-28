import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { dailyResults } from "./audit-rep.ts";

Deno.test("admissions A3 passes only when everything touched was logged same day", () => {
  const sameDay = { Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-08T19:00:00Z" };
  const late = { Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-11T19:00:00Z" };
  assertEquals(dailyResults("admissions", { Leads: [sameDay], Deals: [sameDay] }).find((r) => r.item === "A3")?.score, 1);
  assertEquals(dailyResults("admissions", { Leads: [sameDay], Deals: [late] }).find((r) => r.item === "A3")?.score, 0);
});

Deno.test("A3 aggregates across all three admissions modules, not one", () => {
  const sameDay = { Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-08T19:00:00Z" };
  const late = { Created_Time: "2026-09-08T17:00:00Z", Modified_Time: "2026-09-11T19:00:00Z" };
  // A late Contact must fail A3 even when Leads and Deals are clean.
  const r = dailyResults("admissions", { Leads: [sameDay], Contacts: [late], Deals: [sameDay] });
  assertEquals(r.find((x) => x.item === "A3")?.score, 0);
});

Deno.test("no activity at all makes A3 N/A, not a failure", () => {
  // A rep on PTO must not be marked down for an empty week.
  assertEquals(dailyResults("admissions", {}).find((r) => r.item === "A3")?.score, "N/A");
});

Deno.test("BD A4 and A5 score calls and meetings separately", () => {
  const callLate = { Call_Start_Time: "2026-09-04T17:20:00Z", Created_Time: "2026-09-07T15:45:00Z" };
  const meetingOk = { Start_DateTime: "2026-09-01T16:00:00Z", Created_Time: "2026-09-01T17:00:00Z" };
  const r = dailyResults("bd", { Calls: [callLate], Meetings: [meetingOk] });
  assertEquals(r.find((x) => x.item === "A4")?.score, 0);
  assertEquals(r.find((x) => x.item === "A5")?.score, 1);
});

Deno.test("each team gets exactly its own daily items", () => {
  assertEquals(dailyResults("admissions", {}).map((r) => r.item), ["A1","A2","A3","A4","A5","A6"]);
  assertEquals(dailyResults("bd", {}).map((r) => r.item), ["A1","A2","A3","A4","A5","A6","A7"]);
});

Deno.test("deferred daily items carry a reason the auditor can act on", () => {
  const a1 = dailyResults("bd", {}).find((r) => r.item === "A1");
  assertEquals(a1?.score, "DEFER");
  assertEquals(typeof a1?.explanation === "string" && a1.explanation.length > 0, true);
});

// Section A EOD items. A2/A3 on BD, A1/A2 on admissions.
Deno.test("a rep who filed every expected day passes, and 'complete' follows", () => {
  const eod = { expectedDays: ["2026-09-08", "2026-09-09"], missing: [], late: [], any: true };
  const bd = dailyResults("bd", {}, eod);
  assertEquals(bd.find((r) => r.item === "A2")?.score, 1);
  assertEquals(bd.find((r) => r.item === "A3")?.score, 1);
  const adm = dailyResults("admissions", {}, eod);
  assertEquals(adm.find((r) => r.item === "A1")?.score, 1);
  assertEquals(adm.find((r) => r.item === "A2")?.score, 1);
});

Deno.test("missing and late days are named, and holidays are already excluded", () => {
  const eod = {
    expectedDays: ["2026-09-08", "2026-09-09", "2026-09-11"],
    missing: ["2026-09-11"],
    late: ["2026-09-09"],
    any: true,
  };
  const a2 = dailyResults("bd", {}, eod).find((r) => r.item === "A2")!;
  assertEquals(a2.score, 0);
  assertStringIncludes(a2.explanation ?? "", "no EOD on 9/11");
  assertStringIncludes(a2.explanation ?? "", "filed late on 9/9");
  assertStringIncludes(a2.explanation ?? "", "Holidays and weekends are already excluded");
});

// The sheets were dead for seven months and nobody noticed. Scoring an
// unreadable sheet as 0 would put that failure on a rep's record.
Deno.test("unreadable EOD sheets DEFER, they never fail the rep", () => {
  const bd = dailyResults("bd", {}, null);
  assertEquals(bd.find((r) => r.item === "A2")?.score, "DEFER");
  assertEquals(bd.find((r) => r.item === "A3")?.score, "DEFER");
});

Deno.test("no EOD at all in the window fails 'complete'", () => {
  const eod = { expectedDays: ["2026-09-08"], missing: ["2026-09-08"], late: [], any: false };
  assertEquals(dailyResults("bd", {}, eod).find((r) => r.item === "A3")?.score, 0);
});

Deno.test("a window with no working days is N/A, not a miss", () => {
  const eod = { expectedDays: [], missing: [], late: [], any: false };
  assertEquals(dailyResults("bd", {}, eod).find((r) => r.item === "A2")?.score, "N/A");
});
