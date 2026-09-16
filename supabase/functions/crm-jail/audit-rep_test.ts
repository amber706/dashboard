import { assertEquals } from "jsr:@std/assert@1";
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
