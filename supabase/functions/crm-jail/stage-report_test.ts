import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildStageReportRows, stageReportSummary, type StageReportRep } from "./stage-report.ts";

const ok = { correct: true, current: "Referring", expected: "Referring", reason: "last referral 2026-10-20 (6 days ago)" };
const bad = { correct: false, current: "Admitting", expected: "Dormant", reason: "no referral in 90+ days" };
const reps: StageReportRep[] = [
  { rep: "Ben Coulter", owned: 3, checked: [
    { account: { id: "1", Account_Name: "Soba Mesa" }, verdict: ok },
    { account: { id: "2", Account_Name: "CBI Phoenix" }, verdict: bad },
    { account: { id: "3", Account_Name: "Old Co" }, verdict: null },
  ] },
  { rep: "Kenny Reitz", owned: 1, checked: [{ account: { id: "4", Account_Name: "Destiny Springs" }, verdict: ok }] },
];

Deno.test("per-rep compliance leaves Archive/Delete out of the count", () => {
  const rows = buildStageReportRows("2026-10-26", reps);
  assertEquals(rows.find((r) => r[0] === "Ben Coulter"), ["Ben Coulter", "3", "2", "1", "1", "50.0%"]);
  assertEquals(rows.find((r) => r[0] === "BD team"), ["BD team", "", "3", "2", "1", "66.7%"]);
});

Deno.test("each wrong-stage company is listed with what it should be and why", () => {
  const rows = buildStageReportRows("2026-10-26", reps);
  const row = rows.find((r) => r[1] === "CBI Phoenix")!;
  assertEquals(row.slice(0, 5), ["Ben Coulter", "CBI Phoenix", "Admitting", "Dormant", "no referral in 90+ days"]);
  assertStringIncludes(row[5], "/tab/Accounts/2");
});

Deno.test("the email lists reps worst first", () => {
  const s = stageReportSummary("2026-10-26", reps);
  assertEquals(s.indexOf("Ben Coulter") < s.indexOf("Kenny Reitz"), true);
  assertStringIncludes(s, "Ben Coulter: 50.0% (1 of 2 in the wrong stage)");
});
