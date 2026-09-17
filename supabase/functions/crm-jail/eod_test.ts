import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { eodDate, judgeEod, parseEodSheet, rowsForRep } from "./eod.ts";

Deno.test("Zoho's d-MMM-yyyy dates and timestamps both parse", () => {
  assertEquals(eodDate("16-Sep-2026"), "2026-09-16");
  assertEquals(eodDate("16-Sep-2026 17:39:40"), "2026-09-16");
  assertEquals(eodDate("4-Jul-2026"), "2026-07-04");
  assertEquals(eodDate("2026-09-16"), "2026-09-16");
  assertEquals(eodDate(""), null);
  assertEquals(eodDate("not a date"), null);
});

// The BD live sheet repeats Date/Rep/Added Time across TWO merged header rows.
// Taking the first as the header reads the second as a submission — a phantom
// row with a rep named "Rep".
Deno.test("a two-row header is consumed entirely, not read as data", () => {
  const rows = parseEodSheet([
    ["Added Time", "IP Address", "Date", "Rep", "Referrals by LOC"],
    ["Added Time", "IP Address", "Date", "Rep", "BHRF"],
    ["16-Sep-2026 17:39:40", "1.2.3.4", "16-Sep-2026", "Mike", "2"],
  ]);
  assertEquals(rows, [{ rep: "Mike", date: "2026-09-16", submittedOn: "2026-09-16" }]);
});

Deno.test("a one-row header works the same way", () => {
  const rows = parseEodSheet([
    ["Added Time", "IP Address", "Date", "Rep", "Inbound Calls Taken"],
    ["15-Sep-2026 09:02:00", "1.2.3.4", "15-Sep-2026", "Sabrina Johnson", "22"],
  ]);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].rep, "Sabrina Johnson");
});

Deno.test("columns are found by name, so a reordered sheet still reads", () => {
  const rows = parseEodSheet([
    ["Date", "Rep", "Wins/Challenges", "Added Time"],
    ["11-Sep-2026", "Ben", "good day", "11-Sep-2026 18:00:00"],
  ]);
  assertEquals(rows[0], { rep: "Ben", date: "2026-09-11", submittedOn: "2026-09-11" });
});

Deno.test("a sheet with no recognisable header throws rather than reading nothing", () => {
  // Silently returning [] would mark every rep as having filed no EOD at all.
  assertThrows(() => parseEodSheet([["Something", "Else"], ["a", "b"]]));
});

Deno.test("BD sheets use first names; admissions sheets use full names", () => {
  const roster = ["Mike Mcluty", "Joey Masterson", "Ben Coulter"];
  const rows = [
    { rep: "Mike", date: "2026-09-08", submittedOn: "2026-09-08" },
    { rep: "Joey", date: "2026-09-08", submittedOn: "2026-09-08" },
  ];
  assertEquals(rowsForRep(rows, "Mike Mcluty", roster)?.length, 1);
  assertEquals(rowsForRep(rows, "Ben Coulter", roster)?.length, 0);
  const full = [{ rep: "Sabrina Johnson", date: "2026-09-08", submittedOn: "2026-09-08" }];
  assertEquals(rowsForRep(full, "Sabrina Johnson", ["Sabrina Johnson"])?.length, 1);
});

Deno.test("an ambiguous first name refuses to guess", () => {
  // Two Mikes on the roster and a sheet row that just says "Mike": crediting
  // one person's EOD to another is worse than deferring.
  const roster = ["Mike Mcluty", "Mike Rossi"];
  const rows = [{ rep: "Mike", date: "2026-09-08", submittedOn: "2026-09-08" }];
  assertEquals(rowsForRep(rows, "Mike Mcluty", roster), null);
});

Deno.test("a day with no submission is missing; a day filed later is late", () => {
  const expected = ["2026-09-08", "2026-09-09", "2026-09-10"];
  const v = judgeEod(expected, [
    { rep: "Kenny", date: "2026-09-08", submittedOn: "2026-09-08" },
    { rep: "Kenny", date: "2026-09-09", submittedOn: "2026-09-11" },
  ]);
  assertEquals(v.missing, ["2026-09-10"]);
  assertEquals(v.late, ["2026-09-09"]);
  assertEquals(v.any, true);
});

Deno.test("a rep who filed everything on time has nothing against them", () => {
  const v = judgeEod(["2026-09-08"], [
    { rep: "Ben", date: "2026-09-08", submittedOn: "2026-09-08" },
  ]);
  assertEquals(v, { missing: [], late: [], any: true });
});
