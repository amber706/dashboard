# CRM Jail Audit Bot — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Wednesday 09:00 America/Phoenix, produce a completed Google Sheets CRM Jail scorecard for each rostered Admissions and BD rep covering the prior Mon–Sun, file it in the CRM Jail Drive folder, and notify Aaron and Megan.

**Architecture:** A Supabase edge function (`crm-jail`) driven by `pg_cron`. It reads a roster table, pulls each rep's Zoho records via COQL, samples 5 per module with a deterministic seed, scores ~100 line items with a pure rule engine, asks Claude to judge the language items, copies the team's Google Sheets template and writes only `1`/`0`/`N/A` plus explanations — never a computed cell. A roster admin screen lives in the dashboard at `/admin/crm-jail`.

**Tech Stack:** Deno (Supabase edge functions), `deno test` for the rule engine, Postgres + `pg_cron`, Zoho CRM v6 COQL API, Google Drive v3 + Sheets v4 with a service account, Claude API, React 18 + wouter + shadcn/ui for the admin screen, vitest for UI tests.

**Spec:** `docs/superpowers/specs/2026-09-15-crm-jail-audit-bot-phase1-design.md`

---

## Before you start

**Commits:** per `CLAUDE.md`, commit locally as each task completes, but **do not push and do not open a PR** unless Amber asks. Work on a branch — `git checkout -b feat/crm-jail-audit-bot` off `main`, not off the current `fix/gclid-backfill-readonly-fields`.

**Three prerequisites are outstanding and gate specific tasks:**

| Prerequisite | Owner | Blocks |
|---|---|---|
| Reconcile both scorecard templates' formulas to the policy bands (jail below 85%) | Aaron | Task 11 acceptance only |
| Megan confirms the Admissions roster | Megan | Task 5 seed values, Task 9 live run |
| Google service account with access to the CRM Jail folder + both templates | Dev/Amber | Tasks 8, 9, 11 |
| Confirm Claude API coverage for note text containing PHI | Amber | Task 7 |

**Tasks 1–6 need none of these.** Start there; they are the bulk of the logic and are fully testable offline.

## File structure

```
supabase/migrations/
  196_crm_jail_roster_and_runs.sql      roster + run ledger, RLS, seed

supabase/functions/crm-jail/
  index.ts          HTTP entry + orchestrator
  types.ts          Score, ItemResult, SampledRecord, RepAudit
  window.ts         Mon–Sun audit window in America/Phoenix
  sampler.ts        deterministic seeded sample
  zoho.ts           OAuth token, COQL, pagination, related lists
  rules/
    helpers.ts      shared predicates (present, properCase, sameDay, …)
    admissions.ts   A1–A6, L1–L28, C1–C13, D1–D41
    bd.ts           A1–A7, BC1–BC11, CA1–CA9, CO1–CO18, M1–M9
  notes-judge.ts    Claude call for language items
  google-auth.ts    service-account JWT → access token
  sheets.ts         Drive copy + Sheets batchUpdate
  notify.ts         summary to Aaron + Megan
  *_test.ts         colocated deno tests

scripts/
  crm-jail-replay.ts  acceptance harness: replay 8/31–9/4 vs manual scorecards

src/
  pages/admin/crm-jail.tsx   roster admin screen
  lib/crm-jail-roster.ts     roster queries + types
  App.tsx                    route registration
  lib/feature-flags-context.tsx  page_crm_jail FeatureKey
  lib/master-tabs.ts         claim /admin/crm-jail prefix
```

**Why the rule engine lives in the function, not `src/`:** `src/` uses extensionless imports and the `@/` alias, neither of which Deno resolves, and no edge function imports across that boundary today. Taxonomy literals (Stage, Source Category) are read from the `reporting.*_mapping` tables exactly as `reporting-sync-deals` does — that satisfies the metric-literal rule through the mechanism already in use.

---

### Task 1: Audit window

**Files:**
- Create: `supabase/functions/crm-jail/window.ts`
- Test: `supabase/functions/crm-jail/window_test.ts`

America/Phoenix never observes DST, so it is always UTC-7. That lets us do plain arithmetic instead of pulling in a timezone library.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/crm-jail/window_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { auditWindowFor } from "./window.ts";

Deno.test("Wednesday run covers the previous Monday through Sunday", () => {
  // Wed 2026-09-16 09:00 Phoenix == 16:00 UTC
  const w = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  assertEquals(w.startISO, "2026-09-07");
  assertEquals(w.endISO, "2026-09-13");
});

Deno.test("window label matches the naming used on existing scorecards", () => {
  const w = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  assertEquals(w.label, "9/7-9/13/2026");
});

Deno.test("a run on any weekday resolves to the same previous week", () => {
  const wed = auditWindowFor(new Date("2026-09-16T16:00:00Z"));
  const fri = auditWindowFor(new Date("2026-09-18T16:00:00Z"));
  assertEquals(fri.startISO, wed.startISO);
  assertEquals(fri.endISO, wed.endISO);
});

Deno.test("late-evening Phoenix time does not roll into the next UTC day", () => {
  // Wed 2026-09-16 23:00 Phoenix == Thu 2026-09-17 06:00 UTC
  const w = auditWindowFor(new Date("2026-09-17T06:00:00Z"));
  assertEquals(w.startISO, "2026-09-07");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/window_test.ts --allow-none`
Expected: FAIL — `Module not found "./window.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/window.ts
//
// America/Phoenix never observes DST — it is UTC-7 year round. That is why
// this does plain offset arithmetic instead of depending on a tz database.

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuditWindow {
  /** Inclusive Monday, YYYY-MM-DD in Phoenix local terms. */
  startISO: string;
  /** Inclusive Sunday, YYYY-MM-DD in Phoenix local terms. */
  endISO: string;
  /** e.g. "9/7-9/13/2026" — matches existing scorecard file naming. */
  label: string;
}

function toPhoenix(instant: Date): Date {
  return new Date(instant.getTime() - PHOENIX_OFFSET_MS);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortMD(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * The Mon–Sun week immediately before the week containing `runAt`.
 * A Wednesday run therefore audits the week that ended the prior Sunday.
 */
export function auditWindowFor(runAt: Date): AuditWindow {
  const local = toPhoenix(runAt);
  // getUTCDay on the shifted date gives the Phoenix weekday. 0 = Sunday.
  const dow = local.getUTCDay();
  // Days back to this week's Monday; Sunday counts as the 7th day of the
  // week just gone, not the start of a new one.
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(local.getTime() - daysSinceMonday * DAY_MS);
  const start = new Date(thisMonday.getTime() - 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return {
    startISO: ymd(start),
    endISO: ymd(end),
    label: `${shortMD(start)}-${shortMD(end)}/${end.getUTCFullYear()}`,
  };
}

/** Zoho COQL bounds: inclusive start-of-Monday to exclusive start-of-next-Monday, Phoenix. */
export function coqlBounds(w: AuditWindow): { from: string; toExclusive: string } {
  return {
    from: `${w.startISO}T00:00:00-07:00`,
    toExclusive: `${
      ymd(new Date(new Date(`${w.endISO}T00:00:00Z`).getTime() + DAY_MS))
    }T00:00:00-07:00`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/window_test.ts --allow-none`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-jail/window.ts supabase/functions/crm-jail/window_test.ts
git commit -m "CRM Jail: audit window computation (Mon-Sun, America/Phoenix)"
```

---

### Task 2: Deterministic sampler

**Files:**
- Create: `supabase/functions/crm-jail/sampler.ts`
- Test: `supabase/functions/crm-jail/sampler_test.ts`

The seed makes a scorecard reproducible. Policy §7 lets a rep dispute a finding within two business days; if we cannot redraw the identical five records we cannot defend the finding.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/crm-jail/sampler_test.ts
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { sampleRecords } from "./sampler.ts";

const ids = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}` }));

Deno.test("same seed draws the same records", () => {
  const a = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  const b = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  assertEquals(a.map((r) => r.id), b.map((r) => r.id));
});

Deno.test("different rep draws a different sample", () => {
  const a = sampleRecords(ids, 5, "2026-09-07:4402:Leads");
  const b = sampleRecords(ids, 5, "2026-09-07:9911:Leads");
  assertNotEquals(a.map((r) => r.id).join(), b.map((r) => r.id).join());
});

Deno.test("draws exactly n and never repeats a record", () => {
  const s = sampleRecords(ids, 5, "seed");
  assertEquals(s.length, 5);
  assertEquals(new Set(s.map((r) => r.id)).size, 5);
});

Deno.test("fewer records than n returns all of them", () => {
  // Kenny's Meetings section had 1 record and scored 3/9, not 3/45.
  const s = sampleRecords(ids.slice(0, 1), 5, "seed");
  assertEquals(s.length, 1);
});

Deno.test("empty input returns empty, does not throw", () => {
  assertEquals(sampleRecords([], 5, "seed").length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/sampler_test.ts --allow-none`
Expected: FAIL — `Module not found "./sampler.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/sampler.ts
//
// Deterministic sampling. Seed is `${windowStart}:${zohoUserId}:${module}`,
// so re-running a week redraws the identical records. That reproducibility
// is what makes a finding defensible when a rep disputes it under policy §7.

/** FNV-1a. Small, fast, and stable across runtimes — we need the same draw in Deno and in Node. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xorshift32 — deterministic PRNG. Never use Math.random here. */
function makeRng(seed: string): () => number {
  let s = hashSeed(seed) || 0x2545f491;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * Seeded Fisher-Yates over a copy, returning the first `n`.
 * Returns everything when the pool is smaller than `n` — the caller scores
 * the unused record columns N/A so they leave the denominator entirely.
 */
export function sampleRecords<T>(pool: readonly T[], n: number, seed: string): T[] {
  const arr = pool.slice();
  const rng = makeRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

export function sampleSeed(windowStartISO: string, zohoUserId: string, module: string): string {
  return `${windowStartISO}:${zohoUserId}:${module}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/sampler_test.ts --allow-none`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-jail/sampler.ts supabase/functions/crm-jail/sampler_test.ts
git commit -m "CRM Jail: deterministic seeded record sampler"
```

---

### Task 3: Rule helpers and shared types

**Files:**
- Create: `supabase/functions/crm-jail/types.ts`
- Create: `supabase/functions/crm-jail/rules/helpers.ts`
- Test: `supabase/functions/crm-jail/rules/helpers_test.ts`

- [ ] **Step 1: Write `types.ts`** (no test — type-only module)

```ts
// supabase/functions/crm-jail/types.ts

/** What lands in a scoring cell. DEFER leaves the cell blank and flagged for the auditor. */
export type Score = 1 | 0 | "N/A" | "DEFER";

export interface ItemResult {
  /** Template item id, verbatim: "L3", "BC4", "CO18". */
  item: string;
  score: Score;
  /** Written to the Explanation column when the score is 0 or DEFER. */
  explanation?: string;
}

export interface ZohoRecord {
  id: string;
  [field: string]: unknown;
}

export interface RecordContext {
  /** The record being scored. */
  record: ZohoRecord;
  /** Notes attached to the record, newest first. */
  notes: Array<{ Note_Title?: string; Note_Content?: string; Created_Time?: string }>;
  /** Attachment filenames on the record. Deals only. */
  attachments: string[];
  /** Related meetings, for BC9/BC10. Business contacts only. */
  relatedMeetings: Array<{ id: string; Start_DateTime?: string }>;
  /** Raw Stage → normalized category, from reporting.stage_mapping. */
  stageCategory: (raw: unknown) => string | null;
  /** Raw Source Category → normalized, from reporting.source_category_mapping. */
  sourceCategory: (raw: unknown) => string | null;
  /** Audit window, for same-day and in-window checks. */
  window: { startISO: string; endISO: string };
  /** Scores set by the notes judge, keyed by item id. Empty when judging is disabled. */
  notesJudgments: Record<string, { score: 1 | 0; reason: string }>;
}

export type Rule = (ctx: RecordContext) => Score | ItemResult;

export interface SampledRecord {
  record: ZohoRecord;
  /** Display name for the identity row. */
  name: string;
  /** Zoho deep link for the identity row. */
  url: string;
  /** Created_Time, formatted as the templates format it. */
  createdDisplay: string;
}
```

- [ ] **Step 2: Write the failing helpers test**

```ts
// supabase/functions/crm-jail/rules/helpers_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { isProperCase, isPresent, loggedSameDay, noteText, zohoUrl } from "./helpers.ts";

Deno.test("isPresent rejects blank, whitespace and Zoho's null shapes", () => {
  assertEquals(isPresent("Wayne"), true);
  assertEquals(isPresent(0), true); // a real zero is a value
  assertEquals(isPresent(false), true);
  assertEquals(isPresent(""), false);
  assertEquals(isPresent("   "), false);
  assertEquals(isPresent(null), false);
  assertEquals(isPresent(undefined), false);
  assertEquals(isPresent([]), false);
});

Deno.test("isProperCase catches the all-caps and all-lower cases the template targets", () => {
  assertEquals(isProperCase("Wayne Jackson"), true);
  assertEquals(isProperCase("Aiyana McGarry Fairley"), true);
  assertEquals(isProperCase("O'Brien"), true);
  assertEquals(isProperCase("WAYNE JACKSON"), false);
  assertEquals(isProperCase("wayne jackson"), false);
  assertEquals(isProperCase("wayne Jackson"), false);
});

Deno.test("loggedSameDay compares Phoenix calendar days, not UTC instants", () => {
  // Occurred Fri 4 Sep 10:20 Phoenix; logged Fri 4 Sep 10:47 Phoenix.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-04T17:47:00Z"), true);
  // Occurred Fri 4 Sep; logged Mon 7 Sep — this is the CA1 failure on Kenny's sheet.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-07T15:45:00Z"), false);
  // 23:30 Phoenix is still the same Phoenix day even though UTC has rolled over.
  assertEquals(loggedSameDay("2026-09-04T17:20:00Z", "2026-09-05T06:30:00Z"), true);
});

Deno.test("noteText concatenates title and content across all notes", () => {
  const t = noteText([
    { Note_Title: "Call", Note_Content: "Left voicemail." },
    { Note_Content: "Will retry Tuesday." },
  ]);
  assertEquals(t.includes("Left voicemail."), true);
  assertEquals(t.includes("Will retry Tuesday."), true);
});

Deno.test("zohoUrl builds the tab links the templates use", () => {
  assertEquals(
    zohoUrl("Contacts", "5162065000397907018"),
    "https://crm.zoho.com/crm/cornerstone/tab/Contacts/5162065000397907018",
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/rules/helpers_test.ts --allow-none`
Expected: FAIL — `Module not found "./helpers.ts"`

- [ ] **Step 4: Write the implementation**

```ts
// supabase/functions/crm-jail/rules/helpers.ts
//
// Shared predicates for the rule engine. Every one is pure so the whole
// scoring surface is unit-testable without touching Zoho.

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Zoho returns null, "", and [] for empty. A real 0 or false is a value. */
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Proper case per template items L2 / C2 / D2 / BC2 / CO3: every alphabetic
 * word starts uppercase and is not wholly uppercase. Intra-word capitals are
 * allowed so "McGarry" and "O'Brien" pass.
 */
export function isProperCase(v: unknown): boolean {
  if (typeof v !== "string" || v.trim() === "") return false;
  const words = v.trim().split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length === 0) return false;
  return words.every((w) => {
    const letters = w.replace(/[^a-zA-Z]/g, "");
    if (letters.length === 0) return true;
    const first = letters[0];
    if (first !== first.toUpperCase()) return false;
    if (letters.length > 1 && letters === letters.toUpperCase()) return false;
    return true;
  });
}

function phoenixDay(iso: string): string {
  return new Date(new Date(iso).getTime() - PHOENIX_OFFSET_MS).toISOString().slice(0, 10);
}

/** Same Phoenix calendar day. Used by L28, C13, D25, CA1, M1, A3/A4/A5. */
export function loggedSameDay(occurredISO: string, loggedISO: string): boolean {
  if (!occurredISO || !loggedISO) return false;
  return phoenixDay(occurredISO) === phoenixDay(loggedISO);
}

export function inWindow(iso: string, w: { startISO: string; endISO: string }): boolean {
  if (!iso) return false;
  const d = phoenixDay(iso);
  return d >= w.startISO && d <= w.endISO;
}

export function noteText(
  notes: Array<{ Note_Title?: string; Note_Content?: string }>,
): string {
  return notes
    .map((n) => [n.Note_Title, n.Note_Content].filter(Boolean).join(" — "))
    .join("\n")
    .trim();
}

export function zohoUrl(module: string, id: string): string {
  return `https://crm.zoho.com/crm/cornerstone/tab/${module}/${id}`;
}

/** Zoho lookup fields arrive as { id, name }. Presence means the link exists. */
export function lookupPresent(v: unknown): boolean {
  return isPresent(v) && typeof v === "object" && v !== null && "id" in (v as object);
}

/** Formats Created_Time the way the templates display it: "Fri, 4 Sep 2026 10:27 AM". */
export function createdDisplay(iso: string): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() - PHOENIX_OFFSET_MS).toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).replace(",", ",");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/rules/helpers_test.ts --allow-none`
Expected: PASS — 5 passed

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crm-jail/types.ts supabase/functions/crm-jail/rules/
git commit -m "CRM Jail: shared types and pure rule helpers"
```

---

### Task 4: Admissions rule table

**Files:**
- Create: `supabase/functions/crm-jail/rules/admissions.ts`
- Test: `supabase/functions/crm-jail/rules/admissions_test.ts`

Item ids come straight from the [Admissions template](https://docs.google.com/spreadsheets/d/1V9YS4ML9X5UPOWGf-mTNIJYQmGliC8LhwqVKBPZkbds/edit). Do not renumber.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/crm-jail/rules/admissions_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { LEAD_RULES, DEAL_RULES } from "./admissions.ts";
import type { RecordContext } from "../types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [],
    attachments: [],
    relatedMeetings: [],
    stageCategory: (raw) => (raw === "Closed Won" ? "closed_won_admitted" : null),
    sourceCategory: (raw) => (raw === "Business Development" ? "business_development" : null),
    window: { startISO: "2026-09-07", endISO: "2026-09-13" },
    notesJudgments: {},
    ...over,
  };
}

Deno.test("L3 scores phone presence", () => {
  assertEquals(LEAD_RULES.L3(ctx({ Phone: "6025551234" })), 1);
  assertEquals(LEAD_RULES.L3(ctx({ Phone: null })), 0);
});

Deno.test("L2 fails an all-caps name", () => {
  assertEquals(LEAD_RULES.L2(ctx({ Last_Name: "JACKSON", First_Name: "WAYNE" })), 0);
  assertEquals(LEAD_RULES.L2(ctx({ Last_Name: "Jackson", First_Name: "Wayne" })), 1);
});

Deno.test("L17 is N/A when the lead is not BD-sourced", () => {
  assertEquals(LEAD_RULES.L17(ctx({ Source_Category: "Google Ads" })), "N/A");
});

Deno.test("L17 is scored when the lead is BD-sourced", () => {
  assertEquals(
    LEAD_RULES.L17(ctx({ Source_Category: "Business Development", BD_Rep: null })),
    0,
  );
});

Deno.test("D33 defers — KIPU is Phase 2", () => {
  const r = DEAL_RULES.D33(ctx({}));
  assertEquals(typeof r === "object" ? r.score : r, "DEFER");
});

Deno.test("D39 checks for a VOB attachment by filename", () => {
  assertEquals(DEAL_RULES.D39(ctx({}, { attachments: ["VOB_Jackson.pdf"] })), 1);
  assertEquals(DEAL_RULES.D39(ctx({}, { attachments: ["insurance_card.jpg"] })), 0);
});

Deno.test("D36 is N/A unless the deal is closed lost", () => {
  assertEquals(DEAL_RULES.D36(ctx({ Stage: "Closed Won" })), "N/A");
});

Deno.test("L26 reads the notes judge verdict", () => {
  const c = ctx({}, { notesJudgments: { L26: { score: 0, reason: "No narrative." } } });
  const r = LEAD_RULES.L26(c);
  assertEquals(typeof r === "object" ? r.score : r, 0);
  assertEquals(typeof r === "object" ? r.explanation : "", "No narrative.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/rules/admissions_test.ts --allow-none`
Expected: FAIL — `Module not found "./admissions.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/rules/admissions.ts
//
// Admissions scorecard rules. Item ids are the template's own — L1-L28,
// C1-C13, D1-D41, A1-A6 — and must never be renumbered, because a rep's
// notice cites the item number so they can find the line on their sheet.

import type { RecordContext, ItemResult, Score } from "../types.ts";
import { isPresent, isProperCase, loggedSameDay, lookupPresent } from "./helpers.ts";

type RuleFn = (c: RecordContext) => Score | ItemResult;

const field = (name: string): RuleFn => (c) => (isPresent(c.record[name]) ? 1 : 0);
const lookup = (name: string): RuleFn => (c) => (lookupPresent(c.record[name]) ? 1 : 0);

const defer = (why: string): RuleFn => () => ({ item: "", score: "DEFER", explanation: why });

const KIPU_DEFER = "Deferred to Phase 2 — no KIPU access.";

/** Gate a rule behind a condition; returns N/A when the gate is closed. */
const when = (gate: (c: RecordContext) => boolean, rule: RuleFn): RuleFn => (c) =>
  gate(c) ? rule(c) : "N/A";

const isBdSourced = (c: RecordContext) => c.sourceCategory(c.record.Source_Category) === "business_development";
const stageIs = (cat: string) => (c: RecordContext) => c.stageCategory(c.record.Stage) === cat;
const isReferredOut = (c: RecordContext) => (c.stageCategory(c.record.Stage) ?? "").startsWith("closed_referred_out");

/** Language items are scored by the notes judge; absent a verdict they defer. */
const judged = (item: string): RuleFn => (c) => {
  const v = c.notesJudgments[item];
  if (!v) return { item, score: "DEFER", explanation: "Notes judging unavailable." };
  return { item, score: v.score, explanation: v.reason };
};

const hasAttachment = (re: RegExp): RuleFn => (c) => (c.attachments.some((a) => re.test(a)) ? 1 : 0);

export const LEAD_RULES: Record<string, RuleFn> = {
  L1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  L2: (c) => (isProperCase(`${c.record.First_Name ?? ""} ${c.record.Last_Name ?? ""}`) ? 1 : 0),
  L3: field("Phone"),
  L4: field("Email"),
  L5: field("Emergency_Contact"),
  L6: field("Contact_Type"),
  L7: field("Interaction_Status"),
  L8: field("Interaction_Owner"),
  L9: field("How_Did_You_Hear_About_Us"),
  L10: (c) => (isPresent(c.record.Treatment_or_Court_Services) || isPresent(c.record.DUI_Service) ? 1 : 0),
  L11: field("Level_of_Care_Requested"),
  L12: field("Age_Group"),
  L13: field("Lead_Score"),
  L14: field("Generated_By"),
  L15: field("Tracking_Source"),
  L16: field("Source_Category"),
  L17: when(isBdSourced, field("BD_Rep")),
  L18: when(isBdSourced, field("Partner_Program")),
  L19: when(isBdSourced, lookup("Associated_Company")),
  L20: when(isBdSourced, lookup("Associated_Business_Contact")),
  L21: field("Insurance_Type"),
  L22: field("Insurance_Provider"),
  L23: field("Date_of_Birth"),
  L24: field("Member_ID"),
  L25: field("Insurance_Policy_Type"),
  L26: judged("L26"),
  L27: judged("L27"),
  L28: (c) => (loggedSameDay(String(c.record.Created_Time ?? ""), String(c.record.Modified_Time ?? c.record.Created_Time ?? "")) ? 1 : 0),
};

export const CONTACT_RULES: Record<string, RuleFn> = {
  C1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  C2: (c) => (isProperCase(`${c.record.First_Name ?? ""} ${c.record.Last_Name ?? ""}`) ? 1 : 0),
  C3: field("Phone"),
  C4: field("Email"),
  C5: field("Emergency_Contact"),
  C6: field("Contact_Type"),
  C7: lookup("Owner"),
  C8: when((c) => c.record.Contact_Type === "Family", lookup("Associated_Deal")),
  C9: when((c) => isPresent(c.record.Business_Contact_Role), field("Business_Contact_Role")),
  C10: when((c) => isPresent(c.record.Business_Contact_Role), lookup("Account_Name")),
  C11: when((c) => isPresent(c.record.Business_Contact_Role), (c) => {
    const owner = (c.record.Owner as { id?: string } | null)?.id;
    const companyOwner = (c.record.Company_Owner_Id as string | null) ?? null;
    return owner && companyOwner && owner === companyOwner ? 1 : 0;
  }),
  C12: judged("C12"),
  C13: (c) => (loggedSameDay(String(c.record.Created_Time ?? ""), String(c.record.Modified_Time ?? c.record.Created_Time ?? "")) ? 1 : 0),
};

export const DEAL_RULES: Record<string, RuleFn> = {
  // D1-D4 require a match against BOTH the Contact record and KIPU. The
  // Contact half is implemented in contactMatch() below and unit-tested, but
  // the item is not scored until KIPU lands — a half-check would pass records
  // that fail the item as written.
  D1: defer(KIPU_DEFER),
  D2: defer(KIPU_DEFER),
  D3: defer(KIPU_DEFER),
  D4: defer(KIPU_DEFER),
  D5: field("Emergency_Contact"),
  D6: lookup("Owner"),
  D7: field("How_Did_You_Hear_About_Us"),
  D8: (c) => (isPresent(c.record.Treatment_or_Court_Services) || isPresent(c.record.DUI_Service) ? 1 : 0),
  D9: field("Level_of_Care_Requested"),
  D10: field("Age_Group"),
  D11: field("Source_Category"),
  D12: when(isBdSourced, field("BD_Rep")),
  D13: when(isBdSourced, field("Partner_Program")),
  D14: when(isBdSourced, lookup("Associated_Company")),
  D15: when(isBdSourced, lookup("Associated_Business_Contact")),
  D16: field("Insurance_Type"),
  D17: field("Insurance_Provider"),
  D18: field("Date_of_Birth"),
  D19: field("Member_ID"),
  D20: field("Insurance_Policy_Type"),
  D21: field("VOB_Submitted_By"),
  D22: judged("D22"),
  D23: judged("D23"),
  // Consistency check only: does the stage have the fields that stage implies?
  // Not a judgment of whether the rep picked the right stage.
  D24: (c) => {
    const cat = c.stageCategory(c.record.Stage);
    if (!cat) return 0;
    if (cat === "closed_won_admitted") return isPresent(c.record.Admit_Date) ? 1 : 0;
    if (cat === "closed_lost") return isPresent(c.record.Close_Reasoning) ? 1 : 0;
    return 1;
  },
  D25: (c) => (loggedSameDay(String(c.record.Created_Time ?? ""), String(c.record.Modified_Time ?? c.record.Created_Time ?? "")) ? 1 : 0),
  D26: when(isReferredOut, field("Referred_Out_To")),
  D27: when(isReferredOut, field("Refer_Out_Rep")),
  D28: when(isReferredOut, field("Referred_Out_Type")),
  D29: when(isReferredOut, field("Admitted_to_Referring_Facility")),
  D30: when(isReferredOut, (c) => (isPresent(c.record.Referred_Out_Date) ? 1 : 0)),
  D31: when(isReferredOut, (c) => (isPresent(c.record.Follow_Up_Date) ? 1 : 0)),
  D32: when(stageIs("closed_won_admitted"), (c) => {
    const closing = String(c.record.Closing_Date ?? "").slice(0, 10);
    const admit = String(c.record.Admit_Date ?? "").slice(0, 10);
    return closing && admit && closing === admit ? 1 : 0;
  }),
  D33: defer(KIPU_DEFER),
  D34: defer(KIPU_DEFER),
  D35: defer(KIPU_DEFER),
  D36: when(stageIs("closed_lost"), field("Close_Reasoning")),
  D37: when(stageIs("closed_lost"), judged("D37")),
  D38: when(isBdSourced, hasAttachment(/referral/i)),
  D39: hasAttachment(/vob/i),
  D40: hasAttachment(/pre[-_ ]?(screen|assess)/i),
  D41: when(
    (c) => String(c.record.Insurance_Type ?? "").toLowerCase().includes("commercial"),
    hasAttachment(/insurance[-_ ]?card|ins[-_ ]?card/i),
  ),
};

/** The Contact-record half of D1-D4. Built and tested now, wired up in Phase 2. */
export function contactMatch(
  deal: Record<string, unknown>,
  contact: Record<string, unknown>,
  fieldName: string,
): boolean {
  const a = String(deal[fieldName] ?? "").trim().toLowerCase();
  const b = String(contact[fieldName] ?? "").trim().toLowerCase();
  return a !== "" && a === b;
}

/** Section A is scored once per cycle over ALL the rep's window activity, not a sample. */
export const DAILY_RULES = {
  A1: "DEFER" as const, // EOD report same-day — Google Sheet, Phase 2
  A2: "DEFER" as const, // EOD report complete — Google Sheet, Phase 2
  A3: (allRecords: Array<{ Created_Time?: string; Modified_Time?: string }>): Score =>
    allRecords.length === 0
      ? "N/A"
      : allRecords.every((r) => loggedSameDay(String(r.Created_Time ?? ""), String(r.Modified_Time ?? r.Created_Time ?? "")))
      ? 1
      : 0,
  A4: "DEFER" as const, // Daily Census — Google Sheet, Phase 2
  A5: "DEFER" as const, // Daily Census spelling — Google Sheet + KIPU, Phase 2
  A6: "DEFER" as const, // Intake Tracker — Google Sheet, Phase 2
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/rules/admissions_test.ts --allow-none`
Expected: PASS — 8 passed

- [ ] **Step 5: Verify every template item id is covered**

```bash
deno eval '
import { LEAD_RULES, CONTACT_RULES, DEAL_RULES } from "./supabase/functions/crm-jail/rules/admissions.ts";
const want = [
  ...Array.from({length:28},(_,i)=>`L${i+1}`),
  ...Array.from({length:13},(_,i)=>`C${i+1}`),
  ...Array.from({length:41},(_,i)=>`D${i+1}`),
];
const have = new Set([...Object.keys(LEAD_RULES),...Object.keys(CONTACT_RULES),...Object.keys(DEAL_RULES)]);
const missing = want.filter(k=>!have.has(k));
console.log(missing.length === 0 ? "all 82 items covered" : "MISSING: "+missing.join(","));
'
```

Expected: `all 82 items covered`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crm-jail/rules/admissions.ts supabase/functions/crm-jail/rules/admissions_test.ts
git commit -m "CRM Jail: admissions rule table (L1-L28, C1-C13, D1-D41, A1-A6)"
```

---

### Task 5: BD rule table

**Files:**
- Create: `supabase/functions/crm-jail/rules/bd.ts`
- Test: `supabase/functions/crm-jail/rules/bd_test.ts`

**The BD template has no BC3.** Ids run BC1, BC2, BC4…BC11. Preserve that gap.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/crm-jail/rules/bd_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { BC_RULES, CALL_RULES, COMPANY_RULES, MEETING_RULES } from "./bd.ts";
import type { RecordContext } from "../types.ts";

function ctx(record: Record<string, unknown>, over: Partial<RecordContext> = {}): RecordContext {
  return {
    record: { id: "1", ...record },
    notes: [],
    attachments: [],
    relatedMeetings: [],
    stageCategory: () => null,
    sourceCategory: () => null,
    window: { startISO: "2026-08-31", endISO: "2026-09-06" },
    notesJudgments: {},
    ...over,
  };
}

Deno.test("there is no BC3 — the template skips it", () => {
  assertEquals("BC3" in BC_RULES, false);
  assertEquals("BC4" in BC_RULES, true);
});

Deno.test("CA1 fails a call logged days after it occurred", () => {
  // Kenny's sheet: occurred Fri 4 Sep, logged Mon 7 Sep. Failed 5/5.
  const c = ctx({ Call_Start_Time: "2026-09-04T17:20:00Z", Created_Time: "2026-09-07T15:45:00Z" });
  assertEquals(CALL_RULES.CA1(c), 0);
});

Deno.test("CA6 fails when the call has no associated company", () => {
  // Kenny failed this 5/5.
  assertEquals(CALL_RULES.CA6(ctx({ Account_Name: null })), 0);
  assertEquals(CALL_RULES.CA6(ctx({ Account_Name: { id: "9", name: "Jacob's Hope" } })), 1);
});

Deno.test("CO18 checks for a next scheduled contact", () => {
  assertEquals(COMPANY_RULES.CO18(ctx({ Next_Scheduled_Contact: null })), 0);
  assertEquals(COMPANY_RULES.CO18(ctx({ Next_Scheduled_Contact: "2026-09-20" })), 1);
});

Deno.test("BC10 is N/A when the contact has no future meetings to verify", () => {
  assertEquals(BC_RULES.BC10(ctx({}, { relatedMeetings: [] })), "N/A");
});

Deno.test("M5 requires an associated contact on the meeting", () => {
  assertEquals(MEETING_RULES.M5(ctx({ Who_Id: null })), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/rules/bd_test.ts --allow-none`
Expected: FAIL — `Module not found "./bd.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/rules/bd.ts
//
// BD scorecard rules. Ids come from the BD template: BC1, BC2, BC4-BC11
// (there is no BC3), CA1-CA9, CO1-CO18, M1-M9, A1-A7. Do not renumber.

import type { RecordContext, ItemResult, Score } from "../types.ts";
import { isPresent, isProperCase, loggedSameDay, lookupPresent } from "./helpers.ts";

type RuleFn = (c: RecordContext) => Score | ItemResult;

const field = (name: string): RuleFn => (c) => (isPresent(c.record[name]) ? 1 : 0);
const lookup = (name: string): RuleFn => (c) => (lookupPresent(c.record[name]) ? 1 : 0);

const judged = (item: string): RuleFn => (c) => {
  const v = c.notesJudgments[item];
  if (!v) return { item, score: "DEFER", explanation: "Notes judging unavailable." };
  return { item, score: v.score, explanation: v.reason };
};

const nowISO = () => new Date().toISOString();

export const BC_RULES: Record<string, RuleFn> = {
  BC1: (c) => (isPresent(c.record.First_Name) && isPresent(c.record.Last_Name) ? 1 : 0),
  BC2: (c) => (isProperCase(`${c.record.First_Name ?? ""} ${c.record.Last_Name ?? ""}`) ? 1 : 0),
  // No BC3 — the template skips it.
  BC4: field("Phone"),
  BC5: field("Email"),
  BC6: lookup("Account_Name"),
  BC7: lookup("Owner"),
  BC8: field("Business_Contact_Role"),
  BC9: (c) => {
    const past = c.relatedMeetings.filter((m) => (m.Start_DateTime ?? "") < nowISO());
    return past.length === 0 ? "N/A" : past.every((m) => isPresent(m.Start_DateTime)) ? 1 : 0;
  },
  BC10: (c) => {
    const future = c.relatedMeetings.filter((m) => (m.Start_DateTime ?? "") >= nowISO());
    return future.length === 0 ? "N/A" : 1;
  },
  BC11: judged("BC11"),
};

export const CALL_RULES: Record<string, RuleFn> = {
  CA1: (c) => (loggedSameDay(String(c.record.Call_Start_Time ?? ""), String(c.record.Created_Time ?? "")) ? 1 : 0),
  CA2: field("Subject"),
  CA3: field("Call_Start_Time"),
  CA4: lookup("Owner"),
  CA5: lookup("Who_Id"),
  CA6: lookup("Account_Name"),
  CA7: judged("CA7"),
  CA8: judged("CA8"),
  CA9: field("Next_Activity_Date"),
};

export const COMPANY_RULES: Record<string, RuleFn> = {
  CO1: lookup("Owner"),
  CO2: field("Account_Name"),
  CO3: (c) => (isProperCase(c.record.Account_Name) ? 1 : 0),
  CO4: field("Website"),
  CO5: field("Main_Business_Phone"),
  CO6: field("Phone"),
  CO7: (c) => {
    const parts = ["Billing_Street", "Billing_City", "Billing_State", "Billing_Code"];
    return parts.every((p) => isPresent(c.record[p])) ? 1 : 0;
  },
  CO8: field("Pipeline_Stage"),
  CO9: field("Niche_Code"),
  CO10: field("Reciprocity"),
  CO11: field("Unattached_or_Attached"),
  CO12: field("Commercial_or_AHCCCS"),
  CO13: field("In_Network_Payors"),
  CO14: field("OON_Referred_Policies"),
  CO15: field("Level_of_Care"),
  CO16: field("States_Services_Are_In"),
  CO17: field("What_They_Treat"),
  CO18: field("Next_Scheduled_Contact"),
};

export const MEETING_RULES: Record<string, RuleFn> = {
  M1: (c) => (loggedSameDay(String(c.record.Start_DateTime ?? ""), String(c.record.Created_Time ?? "")) ? 1 : 0),
  M2: field("Event_Title"),
  M3: field("Start_DateTime"),
  M4: lookup("Owner"),
  M5: lookup("Who_Id"),
  M6: lookup("What_Id"),
  M7: judged("M7"),
  M8: judged("M8"),
  M9: field("Next_Activity_Date"),
};

/** Section A, scored once per cycle over all window activity. */
export const BD_DAILY_RULES = {
  A1: "DEFER" as const, // Referral form — Zoho Forms, Phase 2
  A2: "DEFER" as const, // EOD report same-day — PDFs in Drive, Phase 2
  A3: "DEFER" as const, // EOD report complete — PDFs in Drive, Phase 2
  A4: (calls: Array<{ Call_Start_Time?: string; Created_Time?: string }>): Score =>
    calls.length === 0 ? "N/A"
      : calls.every((r) => loggedSameDay(String(r.Call_Start_Time ?? ""), String(r.Created_Time ?? ""))) ? 1 : 0,
  A5: (meetings: Array<{ Start_DateTime?: string; Created_Time?: string }>): Score =>
    meetings.length === 0 ? "N/A"
      : meetings.every((r) => loggedSameDay(String(r.Start_DateTime ?? ""), String(r.Created_Time ?? ""))) ? 1 : 0,
  A6: "DEFER" as const, // Assigned spreadsheet updated — Google Sheet, Phase 2
  A7: "DEFER" as const, // Assigned spreadsheet reconciles — Google Sheet, Phase 2
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/rules/bd_test.ts --allow-none`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-jail/rules/bd.ts supabase/functions/crm-jail/rules/bd_test.ts
git commit -m "CRM Jail: BD rule table (BC, CA, CO, M, A) preserving the BC3 gap"
```

---

### Task 6: Roster and run-ledger migration

**Files:**
- Create: `supabase/migrations/196_crm_jail_roster_and_runs.sql`

Next number is **196** — the tree is at 195, not 186 as CLAUDE.md states.

- [ ] **Step 1: Write the migration**

```sql
-- 196_crm_jail_roster_and_runs.sql
--
-- CRM Jail Audit Bot, Phase 1. Two tables:
--   crm_jail_roster  who gets audited. Cannot be derived from Zoho: the
--                    TREATMENT Standard profile holds 14 users including
--                    Court Services and 10 never audited, and Sabrina
--                    Johnson — an audited rep — carries the Administrator
--                    profile. Measured 2026-09-15.
--   crm_jail_runs    one row per (rep, window) attempt. Free-text status
--                    columns on purpose: a CHECK constraint is what
--                    silently killed gclid_backfill_log.

create table if not exists public.crm_jail_roster (
  id            uuid primary key default gen_random_uuid(),
  zoho_user_id  text not null unique,
  full_name     text not null,
  email         text not null,
  team          text not null,            -- 'admissions' | 'bd'
  auditor_email text not null,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_jail_roster_active_idx
  on public.crm_jail_roster (active, team);

create table if not exists public.crm_jail_runs (
  id             uuid primary key default gen_random_uuid(),
  run_at         timestamptz not null default now(),
  window_start   date not null,
  window_end     date not null,
  zoho_user_id   text not null,
  full_name      text,
  team           text,
  sheet_id       text,
  sheet_url      text,
  overall_note   text,
  status         text,                    -- 'ok' | 'failed' | 'skipped_no_activity'
  deferred_cells integer default 0,
  error_msg      text,
  created_at     timestamptz not null default now()
);

create unique index if not exists crm_jail_runs_rep_window_idx
  on public.crm_jail_runs (zoho_user_id, window_start);

alter table public.crm_jail_roster enable row level security;
alter table public.crm_jail_runs   enable row level security;

-- Scorecards reference real client records, so reads are admin-only.
create policy crm_jail_roster_admin_all on public.crm_jail_roster
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy crm_jail_runs_admin_read on public.crm_jail_runs
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Seed. BD is exact (the Business Development profile is precisely the 5 reps).
-- Admissions is the 4 reps Megan actually audited for 8/31-9/4 and MUST be
-- confirmed by her before the first live run.
insert into public.crm_jail_roster (zoho_user_id, full_name, email, team, auditor_email, notes)
values
  ('SEED_ANDREW',  'Andrew Pritchert', 'andrewp@cornerstonehealingcenter.com',        'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('SEED_BEN',     'Ben Coulter',      'benc@cornerstonehealingcenter.com',           'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('SEED_JOEY',    'Joey Masterson',   'joelm@cornerstonehealingcenter.com',          'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('SEED_KENNY',   'Kenny Reitz',      'kennyr@cornerstonehealingcenter.com',         'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('SEED_MIKE',    'Mike Mcluty',      'mikemcluty@cornerstonehealingcenter.com',     'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('SEED_ERIC',    'Eric Wade',        'ericw@cornerstonehealingcenter.com',          'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4'),
  ('SEED_MICHAEL', 'Michael Mendez',   'michaelm@cornerstonehealingcenter.com',       'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4'),
  ('SEED_SABRINA', 'Sabrina Johnson',  'sabrinaj@cornerstonehealingcenter.com',       'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4; Administrator profile, not TREATMENT Standard'),
  ('SEED_TAYLOR',  'Taylor Bertchie',  'taylorbertchie@cornerstonehealingcenter.com', 'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4')
on conflict (zoho_user_id) do nothing;
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db push --project-ref fortdxbbazifklqwydnk
```

Then confirm the seed landed:

```bash
supabase db execute --project-ref fortdxbbazifklqwydnk \
  "select team, count(*) from public.crm_jail_roster group by team order by team;"
```

Expected: `admissions | 4` and `bd | 5`

- [ ] **Step 3: ~~Backfill the real Zoho user ids~~ — NOT NEEDED**

Superseded 2026-09-15. The real Zoho user ids were resolved during implementation and are
seeded directly in the migration, so no placeholder-resolution script is required.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/196_crm_jail_roster_and_runs.sql scripts/crm-jail-resolve-user-ids.ts
git commit -m "CRM Jail: roster + run ledger tables, RLS, seed"
```

---

### Task 7: Zoho fetcher

**Files:**
- Create: `supabase/functions/crm-jail/zoho.ts`
- Test: `supabase/functions/crm-jail/zoho_test.ts`

Adapt the OAuth and COQL shape from `supabase/functions/backfill-gclid-to-zoho/index.ts:33-70`. That function is read/write; this one is **read-only** — it must never issue a PUT.

- [ ] **Step 1: Write the failing test** (pure query-building only; no network)

```ts
// supabase/functions/crm-jail/zoho_test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildWindowQuery } from "./zoho.ts";

Deno.test("query filters by owner and by created-or-modified inside the window", () => {
  const q = buildWindowQuery("Leads", "id,Last_Name,Phone", "4402", {
    from: "2026-09-07T00:00:00-07:00",
    toExclusive: "2026-09-14T00:00:00-07:00",
  }, 0);
  assertStringIncludes(q, "from Leads");
  assertStringIncludes(q, "Owner = '4402'");
  assertStringIncludes(q, "Created_Time >= '2026-09-07T00:00:00-07:00'");
  assertStringIncludes(q, "Modified_Time <  '2026-09-14T00:00:00-07:00'");
  assertStringIncludes(q, "limit 200 offset 0");
});

Deno.test("offset advances by page", () => {
  const q = buildWindowQuery("Calls", "id", "1", { from: "a", toExclusive: "b" }, 200);
  assertStringIncludes(q, "offset 200");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/zoho_test.ts --allow-none`
Expected: FAIL — `Module not found "./zoho.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/zoho.ts
//
// Read-only Zoho access for the CRM Jail bot. This module never issues a
// write — the bot audits the CRM, it does not correct it.

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID");
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET");
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN");
const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
const ZOHO_ACCOUNTS_DOMAIN = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";

const PAGE_SIZE = 200;

export async function getZohoAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error("ZOHO secrets not set");
  }
  const body = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Zoho token failed: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

/**
 * Records the rep created OR touched inside the window. Both matter: the
 * template samples "everything the rep created or modified in the audit
 * window", which is why Kenny's sample included a company created in 2022.
 */
export function buildWindowQuery(
  module: string,
  selectFields: string,
  ownerId: string,
  bounds: { from: string; toExclusive: string },
  offset: number,
): string {
  return `select ${selectFields} from ${module} ` +
    `where Owner = '${ownerId}' ` +
    `and ((Created_Time >= '${bounds.from}' and Created_Time <  '${bounds.toExclusive}') ` +
    `or  (Modified_Time >= '${bounds.from}' and Modified_Time <  '${bounds.toExclusive}')) ` +
    `limit ${PAGE_SIZE} offset ${offset}`;
}

export async function coql(token: string, query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/coql`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ select_query: query }),
  });
  if (res.status === 204) return [];
  if (res.status === 401) throw new Error("ZOHO_AUTH_FAILED");
  if (!res.ok) throw new Error(`COQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.data ?? []) as Record<string, unknown>[];
}

/** Pages until a short page comes back. Errors are thrown, never swallowed. */
export async function fetchWindow(
  token: string,
  module: string,
  selectFields: string,
  ownerId: string,
  bounds: { from: string; toExclusive: string },
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await coql(token, buildWindowQuery(module, selectFields, ownerId, bounds, offset));
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchRelated(
  token: string,
  module: string,
  recordId: string,
  related: "Notes" | "Attachments" | "Events",
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `${ZOHO_API_DOMAIN}/crm/v6/${module}/${recordId}/${related}?per_page=100`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
  );
  if (res.status === 204) return [];
  if (res.status === 401) throw new Error("ZOHO_AUTH_FAILED");
  if (!res.ok) throw new Error(`Related ${related} ${res.status}: ${await res.text()}`);
  return ((await res.json()).data ?? []) as Record<string, unknown>[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/zoho_test.ts --allow-none`
Expected: PASS — 2 passed

- [ ] **Step 5: Smoke-test against live Zoho, read-only**

```bash
deno run --allow-net --allow-env supabase/functions/crm-jail/zoho_smoke.ts
```

Write `zoho_smoke.ts` to fetch Kenny Reitz's Calls for 8/31–9/6 and print the count and the
first record's `Subject`. Expected: a non-zero count including `Outgoing call to Cindy deck`.
Delete the smoke file before committing, or keep it — it is read-only and harmless.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crm-jail/zoho.ts supabase/functions/crm-jail/zoho_test.ts
git commit -m "CRM Jail: read-only Zoho COQL fetcher with window + owner filtering"
```

---

### Task 8: Notes judge

**Files:**
- Create: `supabase/functions/crm-jail/notes-judge.ts`
- Test: `supabase/functions/crm-jail/notes-judge_test.ts`

**Gated on the PHI/Claude confirmation.** If it comes back no, skip this task — every `judged()` rule already degrades to `DEFER`, so the bot still works and those items go to the auditor.

- [ ] **Step 1: Write the failing test** (prompt shape + response parsing; no network)

```ts
// supabase/functions/crm-jail/notes-judge_test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildJudgePrompt, parseJudgeResponse } from "./notes-judge.ts";

Deno.test("prompt carries the note text and the items being judged", () => {
  const p = buildJudgePrompt("Left voicemail for Wayne.", ["CA7", "CA8"]);
  assertStringIncludes(p, "Left voicemail for Wayne.");
  assertStringIncludes(p, "CA7");
  assertStringIncludes(p, "CA8");
});

Deno.test("parses a well-formed verdict", () => {
  const r = parseJudgeResponse('{"CA7":{"score":1,"reason":"Describes the call."},"CA8":{"score":0,"reason":"No next step."}}');
  assertEquals(r.CA7.score, 1);
  assertEquals(r.CA8.reason, "No next step.");
});

Deno.test("malformed output yields an empty verdict rather than throwing", () => {
  // A model outage must never cost a rep points — an empty verdict defers.
  assertEquals(Object.keys(parseJudgeResponse("not json")).length, 0);
});

Deno.test("a score outside 1/0 is discarded", () => {
  assertEquals(Object.keys(parseJudgeResponse('{"CA7":{"score":7,"reason":"x"}}')).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/notes-judge_test.ts --allow-none`
Expected: FAIL — `Module not found "./notes-judge.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/crm-jail/notes-judge.ts
//
// Judges the language items — narrative and next-step — that a presence check
// cannot. These are real discriminators: on Kenny's audit CA8 failed 2 of 5
// and BC11 failed 2 of 5, so a length check would have overstated his score.
//
// Note text can contain PHI. Enabling this requires the same coverage the CTM
// call-scoring bot runs under.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

export const ITEM_CRITERIA: Record<string, string> = {
  L26: "The notes contain a clear narrative of what happened.",
  L27: "The notes contain a specific, actionable next step.",
  C12: "The notes contain a clear narrative plus a specific next step.",
  D22: "The notes contain a clear narrative plus a specific next step.",
  D23: "Any field that could not be completed is named in the notes with a reason.",
  D37: "The notes explain why the deal was lost and give the next step.",
  BC11: "The notes clearly describe this person's role and their relationship to us.",
  CA7: "The notes contain a clear narrative of the conversation.",
  CA8: "The notes contain a specific, actionable next step.",
  M7: "The meeting notes include the agenda.",
  M8: "The meeting notes include next steps.",
};

export interface Verdict { score: 1 | 0; reason: string }

export function buildJudgePrompt(notes: string, items: string[]): string {
  const criteria = items.map((i) => `${i}: ${ITEM_CRITERIA[i] ?? i}`).join("\n");
  return `You are auditing CRM notes written by an admissions or business development rep.

Score each criterion 1 if the notes satisfy it, 0 if they do not. Be strict but fair:
a note that says only "called" or "left message" has no narrative and no next step.
A blank field is not automatically a failure if the note explains why it is blank.

Criteria:
${criteria}

Notes:
"""
${notes}
"""

Reply with JSON only, no prose, shaped exactly:
{"ITEM":{"score":1,"reason":"one short sentence"}}
The reason is shown to the rep as coaching, so make it specific about what was missing.`;
}

export function parseJudgeResponse(raw: string): Record<string, Verdict> {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]) as Record<string, { score?: unknown; reason?: unknown }>;
    const out: Record<string, Verdict> = {};
    for (const [item, v] of Object.entries(parsed)) {
      if (v?.score !== 1 && v?.score !== 0) continue;
      out[item] = { score: v.score, reason: String(v.reason ?? "") };
    }
    return out;
  } catch {
    return {};
  }
}

/** Returns {} on any failure. An outage must defer the items, never zero them. */
export async function judgeNotes(notes: string, items: string[]): Promise<Record<string, Verdict>> {
  if (!ANTHROPIC_API_KEY || items.length === 0 || notes.trim() === "") return {};
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: buildJudgePrompt(notes, items) }],
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return parseJudgeResponse(json.content?.[0]?.text ?? "");
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/notes-judge_test.ts --allow-none`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-jail/notes-judge.ts supabase/functions/crm-jail/notes-judge_test.ts
git commit -m "CRM Jail: Claude notes judge for narrative and next-step items"
```

---

### Task 9: Google auth and sheet writer

**Files:**
- Create: `supabase/functions/crm-jail/google-auth.ts`
- Create: `supabase/functions/crm-jail/sheets.ts`
- Test: `supabase/functions/crm-jail/sheets_test.ts`

**Gated on the Google service account existing.** Set `GOOGLE_SA_EMAIL` and `GOOGLE_SA_PRIVATE_KEY` as function secrets, and share the CRM Jail folder plus both templates with the service account email as Editor.

- [ ] **Step 1: Write the failing test** (cell mapping only; no network)

```ts
// supabase/functions/crm-jail/sheets_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { cellFor, COMPUTED_RANGES, isComputedCell, scorecardTitle } from "./sheets.ts";

Deno.test("maps an item and record index to the right A1 cell", () => {
  // Leads section: L1 is row 44, record 1 is column E.
  assertEquals(cellFor("admissions", "L1", 0), "E44");
  assertEquals(cellFor("admissions", "L1", 4), "I44");
  assertEquals(cellFor("admissions", "L2", 0), "E45");
});

Deno.test("never targets a computed cell", () => {
  for (const r of COMPUTED_RANGES.admissions) {
    assertEquals(isComputedCell("admissions", r), true);
  }
  assertEquals(isComputedCell("admissions", "E44"), false);
});

Deno.test("titles match the existing naming on both teams", () => {
  assertEquals(
    scorecardTitle("admissions", "Sabrina Johnson", "8/31-9/4/2026"),
    "SJ: CRM Audit 8/31-9/4/2026",
  );
  assertEquals(
    scorecardTitle("bd", "Kenny Reitz", "8/31-9/4/2026"),
    "BD CRM Jail Audit: Kenny Reitz 8/31-9/4/2026",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/crm-jail/sheets_test.ts --allow-none`
Expected: FAIL — `Module not found "./sheets.ts"`

- [ ] **Step 3: Capture the real cell coordinates**

Before writing `sheets.ts`, read the actual row/column of every item from the live templates —
do not guess. Run:

```bash
deno run --allow-net --allow-env scripts/crm-jail-map-template.ts \
  --template 1V9YS4ML9X5UPOWGf-mTNIJYQmGliC8LhwqVKBPZkbds --out supabase/functions/crm-jail/template-map.admissions.json
deno run --allow-net --allow-env scripts/crm-jail-map-template.ts \
  --template <BD_TEMPLATE_ID> --out supabase/functions/crm-jail/template-map.bd.json
```

That script reads column D (the item number column, per the template's own cell legend) via
`spreadsheets.values.get`, and emits `{ "L1": {"row": 44}, ... }` plus the record-column letters
and the header cell addresses. Ask Aaron for the blank BD template's file id — the only BD
scorecard found so far is Kenny's completed copy, `16gBNt4LANkFnWxYSKM0AtbIkPFLoAo0t6dkr9EG3dw8`.

- [ ] **Step 4: Write `google-auth.ts`**

```ts
// supabase/functions/crm-jail/google-auth.ts
//
// Service-account JWT → access token. Drive + Sheets only; no user impersonation.

const SA_EMAIL = Deno.env.get("GOOGLE_SA_EMAIL");
const SA_KEY = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
const SCOPES = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets";

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function getGoogleAccessToken(): Promise<string> {
  if (!SA_EMAIL || !SA_KEY) throw new Error("GOOGLE_SA secrets not set");
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: SA_EMAIL,
    scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
  const key = await importKey(SA_KEY.replace(/\\n/g, "\n"));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Google token failed: ${JSON.stringify(json)}`);
  return json.access_token as string;
}
```

- [ ] **Step 5: Write `sheets.ts`**

```ts
// supabase/functions/crm-jail/sheets.ts
//
// Copies a team template and writes ONLY the auditor-input cells. The
// template's own formulas produce section scores, the overall score, the
// compliance status and the jail decision — the bot never computes a
// percentage, so its output stays directly comparable to the manual baseline.

import adminMap from "./template-map.admissions.json" with { type: "json" };
import bdMap from "./template-map.bd.json" with { type: "json" };

export type Team = "admissions" | "bd";

const MAPS = { admissions: adminMap, bd: bdMap } as const;

/** Ranges holding formulas. Asserted against in tests and at write time. */
export const COMPUTED_RANGES: Record<Team, string[]> = {
  admissions: adminMap.computedCells as string[],
  bd: bdMap.computedCells as string[],
};

const RECORD_COLUMNS = ["E", "F", "G", "H", "I"];

export function cellFor(team: Team, item: string, recordIndex: number): string {
  const row = (MAPS[team].items as Record<string, { row: number }>)[item]?.row;
  if (!row) throw new Error(`No template row for item ${item} on ${team}`);
  const col = RECORD_COLUMNS[recordIndex];
  if (!col) throw new Error(`Record index ${recordIndex} out of range`);
  return `${col}${row}`;
}

export function isComputedCell(team: Team, a1: string): boolean {
  return COMPUTED_RANGES[team].includes(a1);
}

function initials(fullName: string): string {
  return fullName.split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export function scorecardTitle(team: Team, fullName: string, windowLabel: string): string {
  return team === "admissions"
    ? `${initials(fullName)}: CRM Audit ${windowLabel}`
    : `BD CRM Jail Audit: ${fullName} ${windowLabel}`;
}

export async function copyTemplate(
  token: string,
  templateId: string,
  title: string,
  parentFolderId: string,
): Promise<{ id: string; url: string }> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: title, parents: [parentFolderId] }),
  });
  if (!res.ok) throw new Error(`Drive copy failed: ${await res.text()}`);
  const json = await res.json();
  return { id: json.id, url: `https://docs.google.com/spreadsheets/d/${json.id}/edit` };
}

export interface CellWrite { a1: string; value: string | number }

export async function writeCells(token: string, team: Team, sheetId: string, writes: CellWrite[]) {
  const offenders = writes.filter((w) => isComputedCell(team, w.a1));
  if (offenders.length > 0) {
    // Hard failure, not a warning. Overwriting a formula silently breaks the
    // score for a rep whose discipline record depends on it.
    throw new Error(`Refusing to overwrite computed cells: ${offenders.map((o) => o.a1).join(",")}`);
  }
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: writes.map((w) => ({ range: w.a1, values: [[w.value]] })),
      }),
    },
  );
  if (!res.ok) throw new Error(`Sheets batchUpdate failed: ${await res.text()}`);
}

/** Creates the per-rep folder under the team folder if it does not exist. */
export async function ensureRepFolder(
  token: string,
  teamFolderId: string,
  repName: string,
): Promise<string> {
  const q = encodeURIComponent(
    `'${teamFolderId}' in parents and name = '${repName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existing = (await found.json()).files ?? [];
  if (existing.length > 0) return existing[0].id;

  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: repName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [teamFolderId],
    }),
  });
  return (await res.json()).id;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `deno test supabase/functions/crm-jail/sheets_test.ts --allow-none --allow-read`
Expected: PASS — 3 passed

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/crm-jail/google-auth.ts supabase/functions/crm-jail/sheets.ts \
        supabase/functions/crm-jail/sheets_test.ts supabase/functions/crm-jail/template-map.*.json \
        scripts/crm-jail-map-template.ts
git commit -m "CRM Jail: Google service-account auth and template-driven sheet writer"
```

---

### Task 10: Orchestrator, notifier and cron

**Files:**
- Create: `supabase/functions/crm-jail/index.ts`
- Create: `supabase/functions/crm-jail/notify.ts`
- Create: `supabase/migrations/197_crm_jail_cron.sql`

- [ ] **Step 1: Write `index.ts`**

```ts
// supabase/functions/crm-jail/index.ts
//
// Orchestrator. Per-rep isolation: one rep failing is recorded and the run
// continues. A Zoho auth failure aborts the WHOLE run — emitting scorecards
// that look complete but are empty is the failure mode that made the
// conversion-push incident expensive.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { auditWindowFor, coqlBounds } from "./window.ts";
import { getZohoAccessToken } from "./zoho.ts";
import { getGoogleAccessToken } from "./google-auth.ts";
import { auditRep } from "./audit-rep.ts";
import { sendSummary } from "./notify.ts";

const ADMISSIONS_FOLDER = "1malRHoSkcrUc8zSD4czt74QvS5nvAFtz";
const BD_FOLDER = "1Y4nHrFhkxf8YAwrc9SDbwrLTUHmoXw0f";
const ADMISSIONS_TEMPLATE = "1V9YS4ML9X5UPOWGf-mTNIJYQmGliC8LhwqVKBPZkbds";
const BD_TEMPLATE = Deno.env.get("CRM_JAIL_BD_TEMPLATE_ID") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = body.dry_run ?? false;
  const window = auditWindowFor(body.run_at ? new Date(body.run_at) : new Date());
  const bounds = coqlBounds(window);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fail the whole run here rather than per rep — see the header comment.
  let zohoToken: string, googleToken: string;
  try {
    zohoToken = await getZohoAccessToken();
    googleToken = await getGoogleAccessToken();
  } catch (e) {
    await sendSummary({ window, results: [], fatal: String(e) });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const { data: roster, error } = await supabase
    .from("crm_jail_roster").select("*").eq("active", true).order("team");
  if (error) throw error;

  const results = [];
  for (const rep of roster ?? []) {
    try {
      const r = await auditRep({
        rep, window, bounds, zohoToken, googleToken, dryRun,
        templateId: rep.team === "admissions" ? ADMISSIONS_TEMPLATE : BD_TEMPLATE,
        teamFolderId: rep.team === "admissions" ? ADMISSIONS_FOLDER : BD_FOLDER,
      });
      results.push(r);
      if (!dryRun) {
        await supabase.from("crm_jail_runs").upsert({
          window_start: window.startISO, window_end: window.endISO,
          zoho_user_id: rep.zoho_user_id, full_name: rep.full_name, team: rep.team,
          sheet_id: r.sheetId, sheet_url: r.sheetUrl, status: r.status,
          deferred_cells: r.deferredCells,
        }, { onConflict: "zoho_user_id,window_start" });
      }
    } catch (e) {
      // ZOHO_AUTH_FAILED mid-run still aborts — the token died under us.
      if (String(e).includes("ZOHO_AUTH_FAILED")) {
        await sendSummary({ window, results, fatal: "Zoho auth failed mid-run" });
        return new Response(JSON.stringify({ error: "ZOHO_AUTH_FAILED", completed: results.length }), {
          status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
      results.push({ rep: rep.full_name, status: "failed", error: String(e) });
      if (!dryRun) {
        await supabase.from("crm_jail_runs").upsert({
          window_start: window.startISO, window_end: window.endISO,
          zoho_user_id: rep.zoho_user_id, full_name: rep.full_name, team: rep.team,
          status: "failed", error_msg: String(e),
        }, { onConflict: "zoho_user_id,window_start" });
      }
    }
  }

  if (!dryRun) await sendSummary({ window, results });
  return new Response(JSON.stringify({ window, results }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Write `audit-rep.ts`** — the per-rep pipeline

Wire together, in order: `fetchWindow` per module for that team → `sampleRecords` with
`sampleSeed(window.startISO, rep.zoho_user_id, module)` → `fetchRelated` for notes/attachments/
meetings on the sampled records only → `judgeNotes` per record → run the team's rule tables →
`ensureRepFolder` → `copyTemplate` → build the `CellWrite[]` (header cells, identity rows, score
cells, explanation cells) → `writeCells`. Skip the copy entirely and return
`status: "skipped_no_activity"` when every module came back empty; a rep on PTO must not land in
jail for it.

- [ ] **Step 3: Write `notify.ts`** — the summary email to Aaron and Megan

**Transport: Resend** (`RESEND_API_KEY`), chosen because the project has no existing email sender
and Resend is a plain HTTP API that works in Deno without a vendor SDK. It requires DNS
verification on `cornerstonehealingcenter.com` — an admin task. Keep it behind a single
`sendEmail({to, subject, html})` so swapping to SendGrid or Gmail is contained.

**The body carries only rep name, overall score, status, jail yes/no, deferred-cell count, and the
sheet link — never a client name, record id, or field value.** All PHI stays inside the
access-controlled Google Sheet; the transport only ever sees employee performance data.

Recipients: `aaron@cornerstonehealingcenter.com`, `megan@cornerstonehealingcenter.com`.
**Reps are not recipients in Phase 1.**

```ts
// supabase/functions/crm-jail/notify.ts
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "CRM Jail Bot <crm-jail@cornerstonehealingcenter.com>";
const TO = ["aaron@cornerstonehealingcenter.com", "megan@cornerstonehealingcenter.com"];

export interface RepResult {
  rep: string; team?: string; score?: string; status: string;
  jail?: boolean; sheetUrl?: string; deferredCells?: number; error?: string;
}

export function buildSummaryHtml(
  window: { startISO: string; endISO: string; label: string },
  results: RepResult[],
  fatal?: string,
): string {
  if (fatal) {
    return `<p><strong>CRM Jail audit run failed.</strong></p><p>Window ${window.label}.</p>
<p>${fatal}</p><p>No scorecards were produced. Nothing was sent to reps.</p>`;
  }
  const rows = results.map((r) => `<tr>
<td>${r.rep}</td><td>${r.team ?? ""}</td><td>${r.score ?? "—"}</td>
<td>${r.status}</td><td>${r.jail ? "Yes" : "No"}</td>
<td>${r.deferredCells ?? 0}</td>
<td>${r.sheetUrl ? `<a href="${r.sheetUrl}">Open</a>` : (r.error ?? "")}</td></tr>`).join("");
  return `<p>CRM Jail audits for <strong>${window.label}</strong> are ready for review.</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Rep</th><th>Team</th><th>Score</th><th>Status</th><th>Jail</th>
<th>Cells needing you</th><th>Scorecard</th></tr>${rows}</table>
<p>Scores are not final until the flagged cells are completed. Nothing has been sent to reps.</p>`;
}

export async function sendSummary(args: {
  window: { startISO: string; endISO: string; label: string };
  results: RepResult[];
  fatal?: string;
}): Promise<void> {
  if (!RESEND_API_KEY) return; // never fail a run over a notification
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: args.fatal
        ? `CRM Jail audit FAILED — ${args.window.label}`
        : `CRM Jail audits ready for review — ${args.window.label}`,
      html: buildSummaryHtml(args.window, args.results, args.fatal),
    }),
  }).catch(() => {});
}
```

Test it in `supabase/functions/crm-jail/notify_test.ts`:

```ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildSummaryHtml } from "./notify.ts";

const w = { startISO: "2026-09-07", endISO: "2026-09-13", label: "9/7-9/13/2026" };

Deno.test("summary lists each rep with their score and link", () => {
  const html = buildSummaryHtml(w, [
    { rep: "Kenny Reitz", team: "bd", score: "77.8%", status: "ok", jail: true, sheetUrl: "https://x", deferredCells: 9 },
  ]);
  assertStringIncludes(html, "Kenny Reitz");
  assertStringIncludes(html, "77.8%");
  assertStringIncludes(html, "https://x");
});

Deno.test("body never leaks client data", () => {
  const html = buildSummaryHtml(w, [
    { rep: "Eric Wade", team: "admissions", score: "53.2%", status: "ok", jail: true, sheetUrl: "https://y" },
  ]);
  // Only employee-level facts belong here. No record ids, no client names.
  assertEquals(/crm\.zoho\.com/.test(html), false);
});

Deno.test("a fatal run says plainly that nothing was produced", () => {
  const html = buildSummaryHtml(w, [], "Zoho auth failed");
  assertStringIncludes(html, "No scorecards were produced");
});
```

- [ ] **Step 4: Deploy and dry-run**

```bash
supabase functions deploy crm-jail --project-ref fortdxbbazifklqwydnk
curl -X POST "https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{"dry_run": true, "run_at": "2026-09-09T16:00:00Z"}'
```

Expected: JSON with `window.startISO = "2026-08-31"` and a result entry per rostered rep, no
sheets created, no notification sent.

- [ ] **Step 5: Write the cron migration**

```sql
-- 197_crm_jail_cron.sql
-- Wednesday 09:00 America/Phoenix == 16:00 UTC year round (Arizona has no DST).
select cron.schedule(
  'crm-jail-weekly',
  '0 16 * * 3',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || current_setting('app.service_role_key', true)),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crm-jail/index.ts supabase/functions/crm-jail/audit-rep.ts \
        supabase/functions/crm-jail/notify.ts supabase/migrations/197_crm_jail_cron.sql
git commit -m "CRM Jail: orchestrator, per-rep isolation, summary notifier, weekly cron"
```

---

### Task 11: Roster admin screen

**Files:**
- Create: `src/pages/admin/crm-jail.tsx`
- Create: `src/lib/crm-jail-roster.ts`
- Modify: `src/App.tsx` (imports near line 84, route near line 264)
- Modify: `src/lib/feature-flags-context.tsx` (add `page_crm_jail` to `PageKey`)
- Modify: `src/lib/master-tabs.ts` (claim `/admin/crm-jail` in the explicit prefix list, ~line 150)
- Test: `src/pages/admin/__tests__/crm-jail.test.tsx`

**The master-tabs step is not optional.** A route whose prefix is not claimed there renders
nowhere — that is what hid the `/reporting` dashboards.

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/admin/__tests__/crm-jail.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CrmJailRoster from "@/pages/admin/crm-jail";

vi.mock("@/lib/crm-jail-roster", () => ({
  useRoster: () => ({
    data: [
      { id: "1", full_name: "Kenny Reitz", team: "bd", active: true, email: "kennyr@x.com", auditor_email: "aaron@x.com" },
      { id: "2", full_name: "Sabrina Johnson", team: "admissions", active: true, email: "sabrinaj@x.com", auditor_email: "megan@x.com" },
    ],
    isLoading: false,
  }),
  useSetRepActive: () => ({ mutate: vi.fn() }),
}));

describe("CRM Jail roster admin", () => {
  it("lists rostered reps grouped by team", () => {
    render(<CrmJailRoster />);
    expect(screen.getByText("Kenny Reitz")).toBeInTheDocument();
    expect(screen.getByText("Sabrina Johnson")).toBeInTheDocument();
  });

  it("shows who audits each rep", () => {
    render(<CrmJailRoster />);
    expect(screen.getByText(/aaron@x.com/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/admin/__tests__/crm-jail.test.tsx`
Expected: FAIL — cannot resolve `@/pages/admin/crm-jail`

- [ ] **Step 3: Write `src/lib/crm-jail-roster.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface RosterRep {
  id: string;
  zoho_user_id: string;
  full_name: string;
  email: string;
  team: "admissions" | "bd";
  auditor_email: string;
  active: boolean;
  notes: string | null;
}

export function useRoster() {
  return useQuery({
    queryKey: ["crm-jail-roster"],
    queryFn: async (): Promise<RosterRep[]> => {
      const { data, error } = await supabase
        .from("crm_jail_roster").select("*").order("team").order("full_name");
      if (error) throw error;
      return data as RosterRep[];
    },
  });
}

export function useSetRepActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("crm_jail_roster").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-jail-roster"] }),
  });
}
```

- [ ] **Step 4: Write `src/pages/admin/crm-jail.tsx`**

A table per team (Admissions, Business Development) with columns Rep, Email, Auditor, Active
(a `Switch` wired to `useSetRepActive`). Use the existing shadcn `Table`, `Card`, and `Switch`
primitives and follow the layout of `src/pages/admin/users.tsx`. Include a short note above the
Admissions table explaining why it is hand-managed — the `TREATMENT Standard` profile holds 14
users including Court Services, and Sabrina Johnson carries the `Administrator` profile — so the
next person does not "fix" it by switching to a profile query.

- [ ] **Step 5: Wire up flag, route and nav**

In `src/lib/feature-flags-context.tsx`, add `page_crm_jail` to the `PageKey` union alongside the
other `page_*` keys (~line 34-58).

In `src/App.tsx`, add the import beside the other admin imports (~line 84):

```tsx
import CrmJailRoster from "@/pages/admin/crm-jail";
```

and the route beside the other admin routes (~line 264):

```tsx
<Route path="/admin/crm-jail" component={AdminOnly(CrmJailRoster)} />
```

In `src/lib/master-tabs.ts`, add `"/admin/crm-jail"` to the explicit prefix list (~line 150),
before the broad `"/admin"` catch-all.

- [ ] **Step 6: Run the tests and the guards**

```bash
npx vitest run src/pages/admin/__tests__/crm-jail.test.tsx
npm run typecheck && npm run test && npm run lint:metrics
```

Expected: the new test passes, typecheck is clean, the full suite is green, `lint:metrics` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/crm-jail.tsx src/lib/crm-jail-roster.ts src/App.tsx \
        src/lib/feature-flags-context.tsx src/lib/master-tabs.ts \
        src/pages/admin/__tests__/crm-jail.test.tsx
git commit -m "CRM Jail: roster admin screen at /admin/crm-jail"
```

---

### Task 12: Replay acceptance harness

**Files:**
- Create: `scripts/crm-jail-replay.ts`
- Create: `docs/CRM_JAIL_REPLAY_RESULTS.md`

This is the acceptance gate for Phase 1. Everything before it is unverified against reality.

- [ ] **Step 1: Write the harness**

```ts
// scripts/crm-jail-replay.ts
//
// Replays the 8/31-9/4 window through the bot and diffs every item against
// the scorecards Aaron and Megan filled in by hand. Each disagreement is
// either a bot defect or a manual-audit error, and Phase 1 is not accepted
// until every one of them has been explained.

const MANUAL = {
  "Kenny Reitz":     { sheet: "16gBNt4LANkFnWxYSKM0AtbIkPFLoAo0t6dkr9EG3dw8", team: "bd" },
  "Sabrina Johnson": { sheet: "1NDCgAmZ-KDXiYJ87oCs37S1ulytvQRisd2IsuI1URxg", team: "admissions" },
  "Eric Wade":       { sheet: "1hlno-mbcl-xuk-T00PIlXXr65OSXqgw2unTJ2lr7hCo", team: "admissions" },
  "Michael Mendez":  { sheet: "1GzMw_tJvSxVYKv2RYy_HTiGy8a-wkIZwWKwn3ww9bAM", team: "admissions" },
  "Taylor Bertchie": { sheet: "1nQDND0LE90VjWzeuBoaVQ0JqhfcHGEVbv7wdG_WIskM", team: "admissions" },
};
// Window used by every manual scorecard to date: Mon 8/31 - Fri 9/4.
const WINDOW = { startISO: "2026-08-31", endISO: "2026-09-04" };
```

The harness must: for each rep, read the manual sheet's score cells; run the bot in dry-run over
the same window **using the manual sheet's sampled record ids rather than its own draw** (the
manual auditor's sample was not seeded, so comparing different record sets would prove nothing);
score those exact records; and emit a per-item table of `item | manual | bot | agree?`.

- [ ] **Step 2: Run it**

```bash
deno run --allow-net --allow-env --allow-write scripts/crm-jail-replay.ts \
  > docs/CRM_JAIL_REPLAY_RESULTS.md
```

- [ ] **Step 3: Triage every disagreement**

For each mismatch, record in `docs/CRM_JAIL_REPLAY_RESULTS.md` which of these it is:
**bot defect** (fix it and re-run), **manual error** (note it, the bot is right),
or **genuinely ambiguous** (escalate the item's wording to Aaron and Megan — the policy promises
reps five business days' notice before a changed checklist is used to score them).

Target for acceptance: every field-presence item agrees, and every disagreement anywhere is
classified. Do not chase 100% agreement on the judged language items — human and model
disagreement there is expected and is exactly what the auditor review step exists for.

- [ ] **Step 4: Commit**

```bash
git add scripts/crm-jail-replay.ts docs/CRM_JAIL_REPLAY_RESULTS.md
git commit -m "CRM Jail: replay harness diffing bot output against the manual 8/31-9/4 scorecards"
```

---

## Self-review

**Spec coverage.** Roster store → Task 6 + 11. Zoho fetcher → Task 7. Sampler → Task 2. Rule
engine → Tasks 3–5. Notes judge → Task 8. Sheet writer → Task 9. Orchestrator, ledger, notifier,
cron → Task 10. Verification → Task 12. Window → Task 1. Error handling is distributed across
Tasks 7 (`ZOHO_AUTH_FAILED`), 8 (empty verdict on failure), 9 (computed-cell guard), 10 (per-rep
isolation, idempotent upsert, no-activity skip).

**One spec item still unresolved.** The BD blank template file id (Task 9 Step 3) does not exist in
anything searched; only Kenny's completed copy was found, so Aaron has to supply it. It is flagged
inline at the step that needs it rather than silently assumed.

**Notification transport** was resolved to Resend on 2026-09-15 (Amber). It needs DNS verification
on `cornerstonehealingcenter.com` before the first live run — a Google Workspace admin task.

**Naming consistency.** `auditWindowFor`/`coqlBounds` (Task 1) are consumed in Tasks 7 and 10.
`sampleRecords`/`sampleSeed` (Task 2) in Task 10. `RecordContext` (Task 3) is the argument type
for every rule in Tasks 4–5. `cellFor`/`writeCells`/`copyTemplate`/`ensureRepFolder` (Task 9) in
Task 10. `Score` includes `"DEFER"` throughout.

---

## Execution order

Tasks 1–5 and 7 need no credentials — start there, it is most of the logic. Task 6 needs database
access. Task 8 waits on the PHI/Claude answer. Tasks 9, 10 and 12 wait on the Google service
account. Task 11 is independent and can run in parallel with any of them.
