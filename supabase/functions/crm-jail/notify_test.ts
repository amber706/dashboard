import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildShareMessage, buildSummaryRows, notifyAuditors, type RepResult } from "./notify.ts";

const w = { startISO: "2026-09-07", endISO: "2026-09-13", label: "9/7-9/13/2026" };

Deno.test("share message names the rep, the window and the work left", () => {
  const m = buildShareMessage("Kenny Reitz", w, 9);
  assertStringIncludes(m, "Kenny Reitz");
  assertStringIncludes(m, "9/7-9/13/2026");
  assertStringIncludes(m, "9 cells still need you");
});

Deno.test("share message is singular for one cell and clear when none are left", () => {
  assertStringIncludes(buildShareMessage("X", w, 1), "1 cell still needs you");
  assertStringIncludes(buildShareMessage("X", w, 0), "Every line the bot can check is scored");
});

Deno.test("share message states plainly that the rep has not been told", () => {
  // Phase 1 sends nothing to reps. The auditor must not assume otherwise.
  assertStringIncludes(buildShareMessage("Eric Wade", w, 3), "Nothing has been sent to Eric Wade");
});

Deno.test("summary carries employee-level facts only — never client data", () => {
  const rows = buildSummaryRows(w, [
    { rep: "Kenny Reitz", team: "bd", score: "77.8%", status: "ok", jail: true, sheetUrl: "https://docs.google.com/x", deferredCells: 9 },
  ]);
  const flat = rows.flat().join(" ");
  assertStringIncludes(flat, "Kenny Reitz");
  assertStringIncludes(flat, "77.8%");
  // No Zoho record links, which would identify clients.
  assertEquals(/crm\.zoho\.com/.test(flat), false);
});

Deno.test("each scorecard goes to that rep's own auditor, not to everyone", () => {
  const shares: Array<[string, string]> = [];
  const results: RepResult[] = [
    { rep: "Kenny Reitz", status: "ok", sheetId: "s1", auditorEmail: "aaron@x.com" },
    { rep: "Eric Wade", status: "ok", sheetId: "s2", auditorEmail: "megan@x.com" },
  ];
  return notifyAuditors(w, results, {
    createSummarySheet: async () => ({ id: "sum", url: "https://sum" }),
    share: async (id, email) => { shares.push([id, email]); },
  }).then(() => {
    assertEquals(shares[0], ["s1", "aaron@x.com"]);
    assertEquals(shares[1], ["s2", "megan@x.com"]);
    // Summary goes to both.
    assertEquals(shares.filter(([id]) => id === "sum").length, 2);
  });
});

Deno.test("one failed share does not hide the other results", async () => {
  const results: RepResult[] = [
    { rep: "A", status: "ok", sheetId: "s1", auditorEmail: "bad@x.com" },
    { rep: "B", status: "ok", sheetId: "s2", auditorEmail: "good@x.com" },
  ];
  const ok: string[] = [];
  const out = await notifyAuditors(w, results, {
    createSummarySheet: async () => ({ id: "sum", url: "https://sum" }),
    share: async (_id, email) => {
      if (email === "bad@x.com") throw new Error("no such user");
      ok.push(email);
    },
  });
  assertEquals(out.failures.length, 1);
  assertStringIncludes(out.failures[0], "A:");
  assertEquals(ok.includes("good@x.com"), true);
  assertEquals(out.summaryUrl, "https://sum");
});

Deno.test("a rep whose run failed has no sheet and is skipped, not crashed on", async () => {
  const out = await notifyAuditors(w, [{ rep: "C", status: "failed", error: "boom" }], {
    createSummarySheet: async () => ({ id: "sum", url: "https://sum" }),
    share: async () => {},
  });
  assertEquals(out.failures.length, 0);
});

Deno.test("a run note is prepended so a trial cannot read as live scores", () => {
  const m = buildShareMessage("Kenny Reitz", w, 5, "TEST RUN — please review, do not action.");
  assertEquals(m.startsWith("TEST RUN — please review, do not action."), true);
  assertStringIncludes(m, "Kenny Reitz");
});

Deno.test("without a note the message is unchanged", () => {
  assertEquals(buildShareMessage("X", w, 0).startsWith("CRM Jail audit for X"), true);
});
