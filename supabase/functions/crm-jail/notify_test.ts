import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildShareMessage,
  buildSummaryRows,
  notifyAuditors,
  type RepResult,
  shareAndNotify,
} from "./notify.ts";

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
  assertStringIncludes(out.failures[0], "A -> bad@x.com:");
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

// Every scorecard lives in the CRM Audits Shared Drive. The live 9/7-9/13 run
// wrote all nine sheets correctly and shared none of them: Drive answers 404
// File not found on a shared-drive file unless supportsAllDrives is set, so the
// run reported success while Aaron and Megan were never told. Pin the params.
Deno.test("the share call opts into shared drives, or nobody is ever notified", async () => {
  const original = globalThis.fetch;
  let seen = "";
  globalThis.fetch = ((url: string | URL | Request) => {
    seen = String(url);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await shareAndNotify("tok", "file123", "megan@example.com", "hello");
  } finally {
    globalThis.fetch = original;
  }
  assertStringIncludes(seen, "supportsAllDrives=true");
  assertStringIncludes(seen, "sendNotificationEmail=true");
  assertStringIncludes(seen, "/files/file123/permissions");
});

Deno.test("cc gets every scorecard, and an auditor on cc is not mailed twice", async () => {
  const sent: Array<[string, string]> = [];
  const out = await notifyAuditors(w, [
    { rep: "Mike", team: "bd", status: "ok", sheetId: "s1", auditorEmail: "aaron@x.com" },
    { rep: "Ben", team: "bd", status: "ok", sheetId: "s2", auditorEmail: "aaron@x.com" },
  ], {
    createSummarySheet: async () => ({ id: "sum", url: "https://sum" }),
    share: async (fileId, email) => {
      sent.push([fileId, email]);
    },
  }, undefined, ["amber@x.com", "aaron@x.com"]);

  assertEquals(out.failures, []);
  assertEquals(sent.filter(([f]) => f === "s1").map(([, e]) => e), ["aaron@x.com", "amber@x.com"]);
  assertEquals(sent.filter(([f]) => f === "s2").map(([, e]) => e), ["aaron@x.com", "amber@x.com"]);
  // The summary goes to this batch's auditors plus cc — never to the other
  // team's auditor, who has nothing new to review.
  assertEquals(sent.filter(([f]) => f === "sum").map(([, e]) => e), ["aaron@x.com", "amber@x.com"]);
});
