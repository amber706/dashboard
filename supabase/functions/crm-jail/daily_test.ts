import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildDailyMessage,
  buildDailyRows,
  buildDigestRows,
  byRecord,
  dailyBounds,
  dailyFolderPath,
  dailyTitle,
  dayLabel,
  missesFor,
  phoenixToday,
  previousDay,
  repDayFromChild,
  singular,
  type DailyMiss,
  type RepDay,
} from "./daily.ts";
import type { ItemResult, SampledRecord } from "./types.ts";

const rec = (name: string, id: string): SampledRecord => ({
  record: { id },
  name,
  url: `https://crm.zoho.com/crm/cornerstone/tab/Leads/${id}`,
  createdDisplay: "",
});

Deno.test("an 8am run audits yesterday", () => {
  assertEquals(previousDay("2026-09-25"), "2026-09-24");
  // Across a month boundary, which is where naive date maths breaks.
  assertEquals(previousDay("2026-10-01"), "2026-09-30");
  assertEquals(previousDay("2026-01-01"), "2025-12-31");
});

Deno.test("the day runs midnight to midnight Phoenix, end-exclusive", () => {
  const b = dailyBounds("2026-09-24");
  assertEquals(b.from, "2026-09-24T00:00:00-07:00");
  assertEquals(b.toExclusive, "2026-09-25T00:00:00-07:00");
});

Deno.test("the audited day reads as a weekday people recognise", () => {
  assertEquals(dayLabel("2026-09-24"), "Thu, Sep 24, 2026");
});

// DEFER is the whole reason this filter exists: a weekly scorecard carries
// roughly 50 of them per rep (KIPU, census, referral packets) and not one is
// something a rep can act on this morning.
Deno.test("only outright misses reach the rep", () => {
  const results: ItemResult[][] = [[
    { item: "L3", score: 1 },
    { item: "L4", score: 0, reasonKind: "blank" },
    { item: "L17", score: "N/A" },
    { item: "L26", score: "DEFER", explanation: "Notes judging unavailable." },
    { item: "L24", score: 0, reasonKind: "blank" },
  ]];
  const misses = missesFor("admissions", "Leads", [rec("Jo Harrell", "1")], results);
  assertEquals(misses.map((m) => m.item), ["L4", "L24"]);
});

Deno.test("each miss carries the label and the sentence from the weekly scorecard", () => {
  const results: ItemResult[][] = [[{ item: "L4", score: 0, reasonKind: "blank" }]];
  const [m] = missesFor("admissions", "Leads", [rec("Jo Harrell", "1")], results);
  assertEquals(m.label, "Email");
  assertEquals(m.reason, "Email is blank on the record.");
  assertEquals(m.recordName, "Jo Harrell");
  assertStringIncludes(m.url, "/Leads/1");
});

Deno.test("a rule's own explanation wins over the generic wording", () => {
  const results: ItemResult[][] = [[
    { item: "L7", score: 0, explanation: 'Interaction Status is still "Pending Initial Contact".' },
  ]];
  const [m] = missesFor("admissions", "Leads", [rec("Jo Harrell", "1")], results);
  assertStringIncludes(m.reason, "Pending Initial Contact");
});

Deno.test("misses group by record and keep scoring order", () => {
  const misses: DailyMiss[] = [
    { section: "Leads", recordName: "A", url: "u1", item: "L4", label: "Email", reason: "x" },
    { section: "Leads", recordName: "B", url: "u2", item: "L4", label: "Email", reason: "x" },
    { section: "Leads", recordName: "A", url: "u1", item: "L24", label: "Member ID", reason: "y" },
  ];
  const groups = byRecord(misses);
  assertEquals(groups.map((g) => g.recordName), ["A", "B"]);
  assertEquals(groups[0].misses.length, 2);
});

Deno.test("the sheet gives every missing field its own row", () => {
  const misses: DailyMiss[] = [
    { section: "Leads", recordName: "A", url: "u1", item: "L4", label: "Email", reason: "Email is blank." },
    { section: "Leads", recordName: "A", url: "u1", item: "L24", label: "Member ID", reason: "Member ID is blank." },
  ];
  const rows = buildDailyRows("Taylor Bertchie", "2026-09-24", 12, misses);
  const header = rows.findIndex((r) => r[0] === "Record");
  assertEquals(rows[header + 1], ["A", "Lead", "L4", "Email is blank.", "u1"]);
  // The name and link repeat only on the record's first row.
  assertEquals(rows[header + 2], ["", "", "L24", "Member ID is blank.", ""]);
});

Deno.test("the sheet says plainly that this is not a score", () => {
  const rows = buildDailyRows("Taylor Bertchie", "2026-09-24", 1, []);
  const text = rows.flat().join(" ");
  assertStringIncludes(text, "not a score");
  assertStringIncludes(text, "CRM Jail");
});

Deno.test("counts in the header are per record and per field, not the same number", () => {
  const misses: DailyMiss[] = [
    { section: "Leads", recordName: "A", url: "u1", item: "L4", label: "Email", reason: "r" },
    { section: "Leads", recordName: "A", url: "u1", item: "L24", label: "Member ID", reason: "r" },
    { section: "Deals", recordName: "B", url: "u2", item: "D19", label: "Member ID", reason: "r" },
  ];
  const rows = buildDailyRows("Taylor Bertchie", "2026-09-24", 12, misses);
  assertStringIncludes(rows[1][0], "12 records checked");
  assertStringIncludes(rows[1][0], "2 need a fix");
  assertStringIncludes(rows[1][0], "3 fields to complete");
});

// The email is the whole interaction for most reps — it has to stand alone.
Deno.test("the email lists the records and names the fields", () => {
  const misses: DailyMiss[] = [
    { section: "Leads", recordName: "Jo Harrell", url: "u1", item: "L4", label: "Email", reason: "r" },
    { section: "Leads", recordName: "Jo Harrell", url: "u1", item: "L12", label: "Age Group", reason: "r" },
  ];
  const msg = buildDailyMessage("Taylor Bertchie", "2026-09-24", 12, misses);
  assertStringIncludes(msg, "Taylor,");
  assertStringIncludes(msg, "Thu, Sep 24, 2026");
  assertStringIncludes(msg, "Jo Harrell (Lead) — Email, Age Group");
  assertStringIncludes(msg, "not a score");
});

// Drive truncates a long share message, so an over-long list must be counted,
// not silently cut off mid-record.
Deno.test("a long list is capped and the remainder counted", () => {
  const misses: DailyMiss[] = Array.from({ length: 20 }, (_, i) => ({
    section: "Leads",
    recordName: `Rec ${i}`,
    url: `u${i}`,
    item: "L4",
    label: "Email",
    reason: "r",
  }));
  const msg = buildDailyMessage("Taylor Bertchie", "2026-09-24", 25, misses, 8);
  assertEquals(msg.split("\n").filter((l) => l.startsWith("• Rec ")).length, 8);
  assertStringIncludes(msg, "and 12 more");
});

Deno.test("singular names read correctly for every section", () => {
  assertEquals(singular("Leads"), "Lead");
  assertEquals(singular("Deals"), "Deal");
  assertEquals(singular("Calls"), "Call");
  assertEquals(singular("Companies"), "Company");
  assertEquals(singular("BusinessContacts"), "Business Contact");
});

Deno.test("the digest ranks by who has the most to fix", () => {
  const days: RepDay[] = [
    { rep: "A", team: "admissions", recordsChecked: 5, misses: [], status: "clean" },
    {
      rep: "B",
      team: "admissions",
      recordsChecked: 9,
      status: "sent",
      sheetUrl: "s2",
      misses: [
        { section: "Leads", recordName: "x", url: "u1", item: "L4", label: "Email", reason: "r" },
        { section: "Leads", recordName: "y", url: "u2", item: "L4", label: "Email", reason: "r" },
      ],
    },
  ];
  const rows = buildDigestRows("2026-09-24", days);
  const header = rows.findIndex((r) => r[0] === "Rep");
  assertEquals(rows[header + 1][0], "B");
  assertEquals(rows[header + 1][4], "2");
  assertEquals(rows[header + 2][0], "A");
  assertEquals(rows[header + 2][5], "nothing to fix");
});

Deno.test("a rep who worked nothing is named as such, not as clean", () => {
  const rows = buildDigestRows("2026-09-24", [
    { rep: "A", team: "bd", recordsChecked: 0, misses: [], status: "no_activity" },
  ]);
  assertEquals(rows[rows.length - 1][5], "no records worked");
  assertStringIncludes(rows[1][0], "0 reps worked records");
});

Deno.test("daily lists file under the rep by month", () => {
  assertEquals(dailyFolderPath("Taylor Bertchie", "2026-09-24"), [
    "Daily Corrections",
    "Taylor Bertchie",
    "2026-09",
  ]);
  assertEquals(dailyTitle("Taylor Bertchie", "2026-09-24"), "TB: CRM corrections 2026-09-24");
});

// The 8am Phoenix job fires at 15:00 UTC, so the UTC date and the Phoenix date
// agree — but a run late in the Phoenix evening would not, and the offset has
// to be applied rather than assumed.
Deno.test("today is read in Phoenix, not UTC", () => {
  assertEquals(phoenixToday(new Date("2026-09-25T15:00:00Z")), "2026-09-25");
  // 23:30 Phoenix on the 25th is already the 26th in UTC.
  assertEquals(phoenixToday(new Date("2026-09-26T06:30:00Z")), "2026-09-25");
});

Deno.test("the 8am job audits the day that just ended", () => {
  const today = phoenixToday(new Date("2026-09-25T15:00:00Z"));
  assertEquals(previousDay(today), "2026-09-24");
});

// The first live dry run asked Taylor Bertchie to supply a Date of Birth and a
// Member ID for "WIRELESS CALLER" — a caller-ID row CTM creates for every
// inbound call. 220 corrections across 32 of 34 records. A list like that is
// ignored on day one.
const leadRec = (name: string, id: string, status: string): SampledRecord => ({
  record: { id, Lead_Status: status },
  name,
  url: `https://crm.zoho.com/crm/cornerstone/tab/Leads/${id}`,
  createdDisplay: "",
});
const blanks: ItemResult[] = [
  { item: "L4", score: 0, reasonKind: "blank" },
  { item: "L23", score: 0, reasonKind: "blank" },
  { item: "L26", score: 0, explanation: "No note on the record." },
];

Deno.test("a disqualified lead carries no corrections at all", () => {
  for (const status of ["Wrong Number", "Junk/Spam/Sales", "Client Care Call/HR/Admin"]) {
    const misses = missesFor("admissions", "Leads", [leadRec("X", "1", status)], [blanks]);
    assertEquals(misses, []);
  }
});

Deno.test("a lead nobody reached still owes a note, but not a date of birth", () => {
  const misses = missesFor(
    "admissions",
    "Leads",
    [leadRec("TUCSON AZ", "1", "Unable to Contact: Follow Up Needed")],
    [blanks],
  );
  assertEquals(misses.map((m) => m.item), ["L26"]);
});

Deno.test("a lead never dispositioned is told only that", () => {
  const results: ItemResult[] = [
    ...blanks,
    { item: "L7", score: 0, explanation: "Interaction Status is still Pending." },
  ];
  const misses = missesFor(
    "admissions",
    "Leads",
    [leadRec("X", "1", "Pending Initial Contact: Urgent Follow Up Needed")],
    [results],
  );
  assertEquals(misses.map((m) => m.item), ["L7"]);
});

Deno.test("a lead the rep actually worked keeps every miss", () => {
  const misses = missesFor(
    "admissions",
    "Leads",
    [leadRec("Tarren Compton", "1", "Potential: Still Assessing/Info Missing")],
    [blanks],
  );
  assertEquals(misses.map((m) => m.item), ["L4", "L23", "L26"]);
});

// Contacts and Deals are reached by being worked; neither carries a status
// meaning "never a real prospect", so the filter must not touch them.
Deno.test("the lead-status filter does not reach Contacts or Deals", () => {
  const rec2: SampledRecord = {
    record: { id: "1", Lead_Status: "Wrong Number" },
    name: "X",
    url: "u",
    createdDisplay: "",
  };
  assertEquals(missesFor("admissions", "Contacts", [rec2], [blanks]).length, 3);
  assertEquals(missesFor("admissions", "Deals", [rec2], [blanks]).length, 3);
});

// The dispatcher used to map any status it did not recognise to "sent", so a
// whole-team dry run reported fourteen lists sent while sending none.
const taylor = { full_name: "Taylor Bertchie", team: "admissions" as const };
const miss: DailyMiss = {
  section: "Leads", recordName: "Jane D", url: "https://crm.zoho.com/x", item: "L4",
  label: "Date of Birth", reason: "blank",
};

Deno.test("a dry-run child is counted as a dry run, not as sent", () => {
  const d = repDayFromChild(taylor, true, 200, { status: "dry_run", recordsChecked: 12, misses: [miss] });
  assertEquals(d.status, "dry_run");
  assertEquals(d.misses.length, 1);
});

Deno.test("an unrecognised child status is a failure, never sent", () => {
  const d = repDayFromChild(taylor, true, 200, { status: "something_new" });
  assertEquals(d.status, "failed");
  assertStringIncludes(d.error ?? "", "something_new");
});

Deno.test("an HTTP error from a child is a failure carrying its detail", () => {
  const d = repDayFromChild(taylor, false, 500, { error: "ZOHO_AUTH_FAILED", detail: "token expired" });
  assertEquals(d.status, "failed");
  assertEquals(d.error, "token expired");
});

// A sent child returns its misses so the digest can count them. Before, the
// digest read "0 fields to fix" for every rep on every live day.
Deno.test("a sent child's misses reach the digest counts", () => {
  const d = repDayFromChild(taylor, true, 200, {
    status: "sent", recordsChecked: 12, misses: [miss, { ...miss, item: "L23" }],
    sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
  });
  const rows = buildDigestRows("2026-09-24", [d]);
  const row = rows.find((r) => r[0] === "Taylor Bertchie")!;
  assertEquals(row[4], "2");
});
