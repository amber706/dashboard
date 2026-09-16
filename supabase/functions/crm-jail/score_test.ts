import { assertEquals } from "jsr:@std/assert@1";
import { buildWrites, displayName, scoreRecord, toSampledRecord, type SectionResult } from "./score.ts";
import { isComputedCell } from "./sheets.ts";
import type { ItemResult, RecordContext } from "./types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [], attachments: [], relatedMeetings: [],
    stageCategory: (r) => (r === "Closed Won" ? "closed_won_admitted" : null),
    sourceCategory: (r) => (r === "Business Development" ? "business_development" : null),
    window: { startISO: "2026-09-07", endISO: "2026-09-13" },
    notesJudgments: {},
    relatedDealCount: 0, futureActivityCount: 0, accountOwnerId: null, whatIdModule: null,
    ...over,
  };
}

const HEADER = {
  rep: "Kenny Reitz", team: "bd" as const, auditor: "aaron@x.com",
  windowFrom: "8/31/2026", windowTo: "9/4/2026",
};

Deno.test("each module names records the way its scorecard does", () => {
  assertEquals(displayName("Deals", { Deal_Name: "Jane Doe" }), "Jane Doe");
  assertEquals(displayName("Companies", { Account_Name: "Jacob's Hope" }), "Jacob's Hope");
  assertEquals(displayName("Calls", { Subject: "Outgoing call to Cindy deck" }), "Outgoing call to Cindy deck");
  assertEquals(displayName("Meetings", { Event_Title: "Cornerstone x Vivant Lunch" }), "Cornerstone x Vivant Lunch");
  assertEquals(displayName("BusinessContacts", { First_Name: "Wayne", Last_Name: "Jackson" }), "Wayne Jackson");
});

Deno.test("record links point at the right Zoho module", () => {
  // Companies are Accounts, Meetings are Events — the scorecard names differ.
  assertEquals(toSampledRecord("Companies", { id: "9" }).url.includes("/tab/Accounts/9"), true);
  assertEquals(toSampledRecord("Meetings", { id: "9" }).url.includes("/tab/Events/9"), true);
  assertEquals(toSampledRecord("BusinessContacts", { id: "9" }).url.includes("/tab/Contacts/9"), true);
});

Deno.test("scoreRecord tags every result with its item id", () => {
  const out = scoreRecord("bd", "Calls", ctx({ Subject: "x" }));
  assertEquals(out.length, 9);
  assertEquals(out.map((r) => r.item).includes("CA1"), true);
  assertEquals(out.every((r) => typeof r.item === "string" && r.item.length > 0), true);
});

Deno.test("the bot never writes a computed cell", () => {
  const section: SectionResult = {
    section: "Calls",
    records: [toSampledRecord("Calls", { id: "1", Subject: "call" })],
    results: [scoreRecord("bd", "Calls", ctx({ Subject: "call" }))],
  };
  const { writes } = buildWrites(HEADER, [section], []);
  const bad = writes.filter((w) => isComputedCell("bd", w.a1));
  assertEquals(bad.map((b) => b.a1), []);
});

Deno.test("N/A is written literally so the formula drops it from the denominator", () => {
  const results: ItemResult[][] = [[{ item: "CA1", score: "N/A" }]];
  const { writes } = buildWrites(HEADER, [{ section: "Calls", records: [], results }], []);
  assertEquals(writes.find((w) => w.a1 === "E59")?.value, "N/A");
});

Deno.test("DEFER writes nothing and is counted for the auditor", () => {
  const results: ItemResult[][] = [[
    { item: "CA1", score: "DEFER", explanation: "Notes judging unavailable." },
    { item: "CA2", score: 1 },
  ]];
  const { writes, deferredCells } = buildWrites(HEADER, [{ section: "Calls", records: [], results }], []);
  assertEquals(writes.some((w) => w.a1 === "E59"), false); // CA1 left blank
  assertEquals(writes.find((w) => w.a1 === "E60")?.value, 1);
  assertEquals(deferredCells, 1);
});

Deno.test("failure reasons are collected per item across records", () => {
  const results: ItemResult[][] = [
    [{ item: "CA8", score: 0, explanation: "No next step." }],
    [{ item: "CA8", score: 0, explanation: "Only 'called'." }],
    [{ item: "CA8", score: 1 }],
  ];
  const { writes } = buildWrites(HEADER, [{ section: "Calls", records: [], results }], []);
  const expl = writes.find((w) => w.a1 === "K66");
  assertEquals(expl?.value, "#1: No next step. · #2: Only 'called'.");
});

Deno.test("the header identifies the rep, auditor and window", () => {
  const { writes } = buildWrites(HEADER, [], []);
  assertEquals(writes.find((w) => w.a1 === "C6")?.value, "Kenny Reitz");
  assertEquals(writes.find((w) => w.a1 === "E6")?.value, "Business Development");
  assertEquals(writes.find((w) => w.a1 === "C7")?.value, "aaron@x.com");
  assertEquals(writes.find((w) => w.a1 === "C8")?.value, "8/31/2026");
  assertEquals(writes.find((w) => w.a1 === "E8")?.value, "9/4/2026");
});

Deno.test("identity rows are written per sampled record", () => {
  const recs = [
    toSampledRecord("Calls", { id: "1", Subject: "first", Created_Time: "2026-09-01T17:00:00Z" }),
    toSampledRecord("Calls", { id: "2", Subject: "second", Created_Time: "2026-09-02T17:00:00Z" }),
  ];
  const { writes } = buildWrites(HEADER, [{ section: "Calls", records: recs, results: [] }], []);
  assertEquals(writes.find((w) => w.a1 === "E56")?.value, "first");
  assertEquals(writes.find((w) => w.a1 === "F56")?.value, "second");
  assertEquals(String(writes.find((w) => w.a1 === "F57")?.value).includes("/tab/Calls/2"), true);
});
