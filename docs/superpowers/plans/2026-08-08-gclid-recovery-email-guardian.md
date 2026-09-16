# gclid Recovery — Email + Tier-2 Guardian Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing (deployed-only) `backfill-gclid-to-zoho` edge function to recover a gclid via **email match** and via **Tier-2 guardian/secondary/linked-contact numbers**, so leads whose caller identifier isn't the deal's primary phone still get `Recovered_GCLID` attached (and thus pushed to Google by the unchanged `push-google-conversions`).

**Architecture:** `backfill-gclid-to-zoho` builds an index of CTM gclid calls keyed by phone-last10; we add an email-keyed index and broaden the per-record identifier set. All new matches write the SAME `Recovered_GCLID` field the downstream pusher already consumes — so **no pusher, conversion-action, or CHECK-constraint changes are needed**. Pure matching logic is extracted into a testable module; live behaviour is verified via a new `dry_run` mode before any writes.

**Tech Stack:** Deno (Supabase Edge Functions, TypeScript), Zoho CRM v6 REST/COQL, CTM Supabase (cross-project service-role client), `supabase` MCP for deploy. Repo of record: `admissions-copilot` (sibling to this one).

**Scope decisions (locked in brainstorming):**
- IN: email exact match (2nd key); Tier-2 = on-deal secondary/emergency phone fields (`Phone_2..4`, `Emergency_Contact_Phone_Number`) + linked `Contact_Name` phones/email.
- OUT: Tier-3 household (name+address); suggested-match review queue; Account/related-list traversal (deferred — measured yield ~0; Deals rarely have `Account_Name`). **Flag for user if Account traversal is wanted.**
- The function is currently **deployed-only (v55 / internal label "v13")**; Task 1 brings it under version control before any change.

**Pre-existing defect handled in passing:** `gclid_backfill_log` inserts have failed silently since ~2026-05-27 (schema drift; errors only `console.error`'d). Task 4 makes the insert failure visible in the response so verification is trustworthy. Full root-cause of the log drift is out of scope beyond surfacing the error.

---

## File Structure

All paths under `admissions-copilot/` (the sibling repo, git remote `github.com/amber706/admissions-copilot.git`). **Do the work there, not in `admissions-copilot-frontend`.**

- Create: `supabase/functions/backfill-gclid-to-zoho/index.ts` — the function (seeded from the deployed v13 source verbatim in Task 1, then modified).
- Create: `supabase/functions/backfill-gclid-to-zoho/matching.ts` — pure, testable matching helpers (types, `last10`, `normEmail`, `buildCtmIndexes`, `gatherDealIdentifiers`, `matchByIdentifiers`).
- Create: `supabase/functions/backfill-gclid-to-zoho/matching_test.ts` — Deno unit tests for `matching.ts`.
- Create: `supabase/functions/backfill-gclid-to-zoho/README.md` — notes it was deployed-only; deploy/verify steps.

Deno is NOT installed on this machine and the repo has no test harness — Task 0 installs Deno so the pure logic gets real unit tests. Network I/O (Zoho/CTM) is verified via `dry_run` against live data in Task 7, not mocked.

---

### Task 0: Install Deno + confirm repo/branch

**Files:** none (environment).

- [ ] **Step 1: Install Deno**

Run:
```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$HOME/.deno/bin:$PATH"
deno --version
```
Expected: prints a `deno 2.x` (or `1.4x`) version. If `curl` install is blocked, `brew install deno`.

- [ ] **Step 2: Confirm you are in the function's repo of record on a feature branch**

Run:
```bash
cd /Users/macbookair152025/projects/admissions-copilot
git checkout -b feat/gclid-recovery-email-guardian
git status -sb
```
Expected: new branch created; working tree otherwise as-is.

---

### Task 1: Bring the deployed function under version control (baseline)

Establish the exact live source as a committed baseline so the diff is reviewable and deploys are reproducible.

**Files:**
- Create: `supabase/functions/backfill-gclid-to-zoho/index.ts`
- Create: `supabase/functions/backfill-gclid-to-zoho/README.md`

- [ ] **Step 1: Fetch the current deployed source and write it verbatim**

The current deployed source is the `files[0].content` of `mcp__supabase__get_edge_function({function_slug:"backfill-gclid-to-zoho"})` (project ref `fortdxbbazifklqwydnk`), internal label **v13**. Write that exact content to `supabase/functions/backfill-gclid-to-zoho/index.ts` unchanged.

- [ ] **Step 2: Add a README documenting provenance + deploy**

Create `supabase/functions/backfill-gclid-to-zoho/README.md`:
```markdown
# backfill-gclid-to-zoho

Recovers Google `gclid`s onto Zoho records by matching CTM call attribution.
Runs hourly via pg_cron `hourly-backfill-gclid-to-zoho` (`5 * * * *`) in project
`fortdxbbazifklqwydnk`. Writes `Recovered_GCLID` (+ PPC fields on Leads); the
downstream `push-google-conversions` cron consumes `Recovered_GCLID` and uploads
the conversion to Google Ads dated at the source CTM call time.

## History
Created out-of-band (dashboard/MCP); committed here first at deployed version 55
(internal label v13) as the baseline before the email + Tier-2 guardian extension.

## Deploy
Deployed via the `supabase` MCP `deploy_edge_function` (project ref
`fortdxbbazifklqwydnk`, slug `backfill-gclid-to-zoho`, entrypoint `index.ts`),
or `supabase functions deploy backfill-gclid-to-zoho`.

## Modes (POST JSON body)
- `{}` — full run, 90-day lookback, writes to Zoho.
- `{ "lookback_days": N }` — override lookback.
- `{ "topup_only": true }` — only the PPC top-up pass.
- `{ "dry_run": true }` — compute all matches, write NOTHING to Zoho; counts + samples returned.
```

- [ ] **Step 3: Commit the baseline**

```bash
cd /Users/macbookair152025/projects/admissions-copilot
git add supabase/functions/backfill-gclid-to-zoho/index.ts supabase/functions/backfill-gclid-to-zoho/README.md
git commit -m "chore(backfill-gclid): commit deployed v13 source as baseline"
```

---

### Task 2: Extract pure matching module (TDD)

Move the parts we will change into a pure, testable module. This is the correctness core.

**Files:**
- Create: `supabase/functions/backfill-gclid-to-zoho/matching.ts`
- Test: `supabase/functions/backfill-gclid-to-zoho/matching_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/backfill-gclid-to-zoho/matching_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  last10, normEmail, buildCtmIndexes, gatherDealIdentifiers, matchByIdentifiers,
} from "./matching.ts";

Deno.test("last10 strips formatting and takes last 10", () => {
  assertEquals(last10("+1 (623) 399-5781"), "6233995781");
  assertEquals(last10("6233995781"), "6233995781");
  assertEquals(last10("399-5781"), null); // too short
  assertEquals(last10(null), null);
});

Deno.test("normEmail lowercases/trims and rejects non-emails", () => {
  assertEquals(normEmail("  Foo@Bar.COM "), "foo@bar.com");
  assertEquals(normEmail("notanemail"), null);
  assertEquals(normEmail(""), null);
  assertEquals(normEmail(undefined), null);
});

Deno.test("buildCtmIndexes keys by phone-last10 and email, freshest wins", () => {
  const calls = [
    { call_id: "old", caller_number: "+16233995781", received_at: "2026-08-01T00:00:00Z",
      raw_payload: { ga: { gclid: "OLD" }, email: "mom@x.com", paid: { campaign: "c1" } } },
    { call_id: "new", caller_number: "623-399-5781", received_at: "2026-08-07T00:00:00Z",
      raw_payload: { ga: { gclid: "NEW" }, email: "MOM@x.com", paid: { campaign: "c2" } } },
    { call_id: "nogclid", caller_number: "+15550000000", received_at: "2026-08-07T00:00:00Z",
      raw_payload: { ga: {}, email: "skip@x.com" } },
  ];
  const { byPhone, byEmail } = buildCtmIndexes(calls);
  assertEquals(byPhone.get("6233995781")?.gclid, "NEW");
  assertEquals(byEmail.get("mom@x.com")?.gclid, "NEW");
  assertEquals(byPhone.has("5550000000"), false); // no gclid -> skipped
  assertEquals(byEmail.get("mom@x.com")?.campaign_id, "c2");
});

Deno.test("gatherDealIdentifiers pulls deal secondary + emergency + linked contact", () => {
  const ids = gatherDealIdentifiers(
    { Phone: "480-111-1111", Phone_2: null, Phone_3: "623-399-5781",
      Emergency_Contact_Phone_Number: "602-222-2222", Email: "kid@x.com" },
    { Phone: "623-000-0000", Mobile: null, Email: "GUARDIAN@x.com" },
  );
  assertEquals(ids.phones10.sort(), ["4801111111", "6020000000", "6023992222", "6230000000", "6233995781"].sort().filter(p=>p.length===10));
  assertEquals(ids.emails.sort(), ["guardian@x.com", "kid@x.com"]);
});

Deno.test("matchByIdentifiers returns freshest across phone+email, notes via", () => {
  const idx = {
    byPhone: new Map([["6233995781", { gclid: "P", call_id: "cp", phone_e164: "", received_at: "2026-08-05T00:00:00Z", keyword: null, campaign_id: null, ad_group_id: null }]]),
    byEmail: new Map([["kid@x.com", { gclid: "E", call_id: "ce", phone_e164: "", received_at: "2026-08-07T00:00:00Z", keyword: null, campaign_id: null, ad_group_id: null }]]),
  };
  const m = matchByIdentifiers({ phones10: ["6233995781"], emails: ["kid@x.com"] }, idx);
  assertEquals(m?.bundle.gclid, "E"); // email call is fresher
  assertEquals(m?.via, "email");
  assertEquals(matchByIdentifiers({ phones10: ["9999999999"], emails: [] }, idx), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/macbookair152025/projects/admissions-copilot && deno test supabase/functions/backfill-gclid-to-zoho/matching_test.ts`
Expected: FAIL — `Module not found "./matching.ts"`.

- [ ] **Step 3: Implement `matching.ts`**

Create `supabase/functions/backfill-gclid-to-zoho/matching.ts`:
```ts
// Pure matching helpers for backfill-gclid-to-zoho. No network / Deno APIs -> unit-testable.

export type PPCBundle = {
  gclid: string;
  call_id: string;
  phone_e164: string;
  received_at: string;
  keyword: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
};

export type CtmCallRow = {
  call_id: string;
  caller_number: string | null;
  received_at: string;
  raw_payload: any;
};

export type CtmIndexes = { byPhone: Map<string, PPCBundle>; byEmail: Map<string, PPCBundle> };

export function last10(phone: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export function emptyToNull(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function upsertFreshest(map: Map<string, PPCBundle>, key: string, b: PPCBundle) {
  const cur = map.get(key);
  if (!cur || new Date(b.received_at).getTime() > new Date(cur.received_at).getTime()) map.set(key, b);
}

export function buildCtmIndexes(calls: CtmCallRow[]): CtmIndexes {
  const byPhone = new Map<string, PPCBundle>();
  const byEmail = new Map<string, PPCBundle>();
  for (const c of calls) {
    const ga = c.raw_payload?.ga ?? {};
    const paid = c.raw_payload?.paid ?? {};
    const gclid = emptyToNull(ga.gclid);
    if (!gclid) continue;
    const b: PPCBundle = {
      gclid,
      call_id: c.call_id,
      phone_e164: c.caller_number ?? "",
      received_at: c.received_at,
      keyword: emptyToNull(paid.keyword),
      campaign_id: emptyToNull(paid.campaign) ?? emptyToNull(paid.campaign_id),
      ad_group_id: emptyToNull(paid.ad_group_id),
    };
    const p10 = last10(c.caller_number);
    if (p10) upsertFreshest(byPhone, p10, b);
    const email = normEmail(c.raw_payload?.email);
    if (email) upsertFreshest(byEmail, email, b);
  }
  return { byPhone, byEmail };
}

export type RecordIdentifiers = { phones10: string[]; emails: string[] };

export function gatherDealIdentifiers(
  deal: {
    Phone?: string | null; Phone_2?: string | null; Phone_3?: string | null; Phone_4?: string | null;
    Emergency_Contact_Phone_Number?: string | null; Email?: string | null;
  },
  linkedContact?: {
    Phone?: string | null; Mobile?: string | null; Home_Phone?: string | null;
    Other_Phone?: string | null; Emergency_Contact_Phone_Number?: string | null; Email?: string | null;
  } | null,
): RecordIdentifiers {
  const phones = new Set<string>();
  const emails = new Set<string>();
  const addP = (p?: string | null) => { const x = last10(p ?? null); if (x) phones.add(x); };
  const addE = (e?: string | null) => { const x = normEmail(e); if (x) emails.add(x); };
  addP(deal.Phone); addP(deal.Phone_2); addP(deal.Phone_3); addP(deal.Phone_4);
  addP(deal.Emergency_Contact_Phone_Number); addE(deal.Email);
  if (linkedContact) {
    addP(linkedContact.Phone); addP(linkedContact.Mobile); addP(linkedContact.Home_Phone);
    addP(linkedContact.Other_Phone); addP(linkedContact.Emergency_Contact_Phone_Number);
    addE(linkedContact.Email);
  }
  return { phones10: [...phones], emails: [...emails] };
}

export function matchByIdentifiers(
  ids: RecordIdentifiers,
  idx: CtmIndexes,
): { bundle: PPCBundle; via: "phone" | "email" } | null {
  let best: { bundle: PPCBundle; via: "phone" | "email" } | null = null;
  const consider = (b: PPCBundle | undefined, via: "phone" | "email") => {
    if (!b) return;
    if (!best || new Date(b.received_at).getTime() > new Date(best.bundle.received_at).getTime()) best = { bundle: b, via };
  };
  for (const p of ids.phones10) consider(idx.byPhone.get(p), "phone");
  for (const e of ids.emails) consider(idx.byEmail.get(e), "email");
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/macbookair152025/projects/admissions-copilot && deno test supabase/functions/backfill-gclid-to-zoho/matching_test.ts`
Expected: PASS (5 tests). If the `gatherDealIdentifiers` assertion is brittle on ordering, it uses `.sort()` on both sides — keep it.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/backfill-gclid-to-zoho/matching.ts supabase/functions/backfill-gclid-to-zoho/matching_test.ts
git commit -m "feat(backfill-gclid): add pure matching module (phone+email indexes, deal identifiers)"
```

---

### Task 3: Wire `index.ts` to the pure module + add `dry_run`

Replace the inline CTM-index build with `buildCtmIndexes`, and add a `dry_run` guard so Task 7 can verify safely. No behaviour change yet beyond `dry_run`.

**Files:**
- Modify: `supabase/functions/backfill-gclid-to-zoho/index.ts`

- [ ] **Step 1: Import the module and read `dry_run`**

At the top of `index.ts`, after the existing `import { createClient } ...` line, add:
```ts
import { buildCtmIndexes, gatherDealIdentifiers, matchByIdentifiers, last10, normEmail, type PPCBundle } from "./matching.ts";
```
Delete the now-duplicated local `type PPCBundle`, `last10`, and `emptyToNull` definitions from `index.ts` ONLY IF unused after later tasks; for now, to avoid churn, keep `emptyToNull` (still used) and delete the local `type PPCBundle` and local `last10` (both now imported). Verify no other local redefinition conflicts (`emptyToNull` stays local; it is also exported from matching but the local one shadows harmlessly — prefer removing the local and importing `emptyToNull` too for one source of truth).

In `Deno.serve`, where `topupOnly` is read, add:
```ts
const dryRun: boolean = body.dry_run === true;
```

- [ ] **Step 2: Replace the inline phone-bundle build with the module**

Replace this block (the `phoneBundle`/`ctmP10Map` construction after the `ctmCalls` fetch):
```ts
    const phoneBundle = new Map<string, PPCBundle>();
    for (const c of (ctmCalls ?? []) as any[]) { /* ...existing... */ }
    const ctmP10Map = new Map<string, PPCBundle>();
    for (const [phone, info] of phoneBundle) { /* ...existing... */ }
```
with:
```ts
    const { byPhone: ctmP10Map, byEmail: ctmEmailMap } = buildCtmIndexes((ctmCalls ?? []) as any[]);
```
`ctmP10Map` keeps the exact type/semantics the rest of the function already relies on (phone-last10 → freshest PPCBundle). `ctmEmailMap` is new and used in Task 4.

- [ ] **Step 3: Guard every Zoho write behind `dry_run`**

Introduce a single helper just above `Deno.serve` usage (after `putRecords` is defined), and route all writes through it:
```ts
async function writeRecords(token: string, module: "Contacts" | "Deals" | "Leads", records: Array<Record<string, any>>, dryRun: boolean) {
  if (dryRun) return { data: records.map(() => ({ code: "SUCCESS", _dry: true })) };
  return await putRecords(token, module, records);
}
```
Then replace each `await putRecords(token, <module>, batch...)` call in steps 1, 2a, 2b, 2c, 3, and topup with `await writeRecords(token, <module>, batch..., dryRun)`. (Search for `putRecords(` — there are 6 call sites; the definition stays.)

- [ ] **Step 4: Surface `dry_run` in the response and skip log persistence on dry run**

In the `persist_logs` stage, wrap the insert:
```ts
    stage = "persist_logs";
    let logInsertError: string | null = null;
    if (!dryRun) {
      for (let i = 0; i < logRows.length; i += 500) {
        const { error } = await supabase.from("gclid_backfill_log").insert(logRows.slice(i, i + 500));
        if (error) { logInsertError = error.message; console.error("log insert:", error.message); }
      }
    }
```
Add `dry_run: dryRun,` and `log_insert_error: logInsertError,` to the final `jsonResponse({...})` object. (This is the Task-note "surface the silent log failure" — `log_insert_error` now appears in the response.)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/macbookair152025/projects/admissions-copilot && deno check supabase/functions/backfill-gclid-to-zoho/index.ts`
Expected: no errors. Fix any unused-import / duplicate-identifier errors from Step 1.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/backfill-gclid-to-zoho/index.ts
git commit -m "refactor(backfill-gclid): use matching module + add dry_run and log-error surfacing"
```

---

### Task 4: Add email matching to Contacts / Leads

For the Contacts and Leads steps, after building the existing phone map, also match by `Email` against `ctmEmailMap`. New `match_method` suffix `_email`. **Deals are intentionally NOT touched here — Task 5 rewrites Deal matching wholesale (phone + email + guardian) via `matchByIdentifiers`, so adding a separate Deal-email step now would be thrown away.**

**Files:**
- Modify: `supabase/functions/backfill-gclid-to-zoho/index.ts`

- [ ] **Step 1: Contacts (step2a) — add Email to select + email match**

Change the Contacts fetch select from `"id, Phone, GCLID"` to `"id, Phone, Email, GCLID"`. After the existing `contactPhoneMap` build, add an email map and fold email matches into `contactUpdates`, de-duplicating by contact id (phone match wins if both exist, since phone is Tier-1a):
```ts
    const contactEmailMap = new Map<string, string>(); // email -> contact id
    for (const r of contactRows) {
      if (r.GCLID || !r.Email) continue;
      const em = normEmail(r.Email);
      if (em && !contactEmailMap.has(em)) contactEmailMap.set(em, r.id);
    }
    const contactMatched = new Map<string, { gclid: string; call_id: string; method: string }>();
    for (const [p10, info] of ctmP10Map) { const cid = contactPhoneMap.get(p10); if (cid && !contactMatched.has(cid)) contactMatched.set(cid, { gclid: info.gclid, call_id: info.call_id, method: "ctm_call_to_contact" }); }
    for (const [em, info] of ctmEmailMap) { const cid = contactEmailMap.get(em); if (cid && !contactMatched.has(cid)) contactMatched.set(cid, { gclid: info.gclid, call_id: info.call_id, method: "ctm_call_to_contact_email" }); }
```
Replace the old `contactUpdates` construction (the loop over `ctmP10Map`) with one built from `contactMatched`:
```ts
    const contactUpdates = Array.from(contactMatched.entries()).map(([id, m]) => ({ id, Recovered_GCLID: m.gclid, call_id: m.call_id, method: m.method }));
```
In the write loop, log `match_method: meta.method` instead of the hard-coded `"ctm_call_to_contact"`, and keep pushing to `contactIdsWithGclid` on success (unchanged).

- [ ] **Step 2: Leads (step2b) — add Email to select + email match**

Change the Leads fetch select to include `Email`. Build `leadInfoMap` as today (phone), plus a parallel `leadEmailInfoMap` keyed by normalized email → the same `{ id, has_* }` shape. When iterating matches, iterate phone first then email, skipping ids already matched. Set `match_method` to `"ctm_call_to_lead"` (phone) or `"ctm_call_to_lead_email"` (email). Preserve the existing PPC-field enrichment logic (`GCLID1`, `Keyword`, `Campaign_ID`, `ADGROUPID`, `Ad_Click_Date`) unchanged — it applies regardless of which key matched.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/macbookair152025/projects/admissions-copilot && deno check supabase/functions/backfill-gclid-to-zoho/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/backfill-gclid-to-zoho/index.ts
git commit -m "feat(backfill-gclid): match Contacts and Leads by email as a second key"
```

---

### Task 5: Tier-2 guardian / linked-contact sourcing for Deals

Broaden Deal matching to secondary/emergency phones on the deal and to the linked `Contact_Name`'s phones/email — the minor-caller case where the guardian's number isn't the deal's primary phone.

**Files:**
- Modify: `supabase/functions/backfill-gclid-to-zoho/index.ts`

- [ ] **Step 1: Widen the Deals select and fetch linked-contact identifiers**

Change the step2c Deals select from `"id, Phone, Phone_2, Email"` to:
```
"id, Phone, Phone_2, Phone_3, Phone_4, Emergency_Contact_Phone_Number, Email, Contact_Name"
```
Collect the set of linked contact ids: `const contactIds = dealRows.map(d => d.Contact_Name?.id).filter(Boolean)`. In chunks of 50, COQL-fetch those contacts' identifier fields into a map `contactById`:
```ts
    const contactById = new Map<string, any>();
    for (let i = 0; i < contactIds.length; i += 50) {
      const chunk = contactIds.slice(i, i + 50).map((id: string) => `'${id}'`).join(",");
      if (!chunk) continue;
      try {
        const rows = await coql(token, `select id, Phone, Mobile, Home_Phone, Other_Phone, Emergency_Contact_Phone_Number, Email from Contacts where id in (${chunk})`);
        for (const r of rows) contactById.set(r.id, r);
      } catch (err) { console.error("step2c linked-contact fetch:", err instanceof Error ? err.message : String(err)); }
    }
```

- [ ] **Step 2: Match each deal via its full identifier set**

Replace the current `dealPhoneMap`/`dealUpdatesDirect` construction with per-deal identifier gathering + `matchByIdentifiers`:
```ts
    const idx = { byPhone: ctmP10Map, byEmail: ctmEmailMap };
    const dealUpdatesDirect: Array<{ id: string; Recovered_GCLID: string; call_id: string; method: string }> = [];
    for (const d of dealRows) {
      const linked = d.Contact_Name?.id ? contactById.get(d.Contact_Name.id) : null;
      const ids = gatherDealIdentifiers(d, linked);
      const m = matchByIdentifiers(ids, idx);
      if (!m) continue;
      const method = m.via === "email"
        ? "ctm_call_to_deal_email"
        : (last10(d.Phone) && idx.byPhone.get(last10(d.Phone)!)?.gclid === m.bundle.gclid ? "ctm_call_to_deal_direct" : "ctm_call_to_deal_guardian");
      dealUpdatesDirect.push({ id: d.id, Recovered_GCLID: m.bundle.gclid, call_id: m.bundle.call_id, method });
    }
```
Keep the existing batched write loop, but log `match_method: meta.method` (from the row) instead of the hard-coded `"ctm_call_to_deal_direct"`. This makes `ctm_call_to_deal_guardian` and `ctm_call_to_deal_email` distinguishable in `gclid_backfill_log`.

- [ ] **Step 3: Add the guardian counters to the response**

Track `step2cRecovered` as today; additionally count by method for observability. Add to the JSON response a `step2c_by_method` object, e.g.:
```ts
      step2c_ctm_to_deal_direct: { deals_recovered: step2cRecovered, by_method: step2cByMethod },
```
where `step2cByMethod` is a `Record<string, number>` incremented on each success.

- [ ] **Step 4: Typecheck**

Run: `cd /Users/macbookair152025/projects/admissions-copilot && deno check supabase/functions/backfill-gclid-to-zoho/index.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/backfill-gclid-to-zoho/index.ts
git commit -m "feat(backfill-gclid): Tier-2 guardian/linked-contact sourcing for Deals"
```

---

### Task 6: Verify pusher timing-safety for off-deal recovered gclids

A Tier-2 gclid comes from the guardian's CTM call, whose number is NOT on the deal. The pusher (`push-google-conversions`) re-dates recovered-gclid conversions to the source CTM call time via its `gclidToCallTime` map (v36 fix). Confirm that map is keyed by **gclid string** (globally), not by the deal's phone — otherwise a guardian-sourced gclid could be dropped or mis-timed (`CONVERSION_PRECEDES_EVENT`).

**Files:** read-only investigation; possible follow-up.

- [ ] **Step 1: Inspect the pusher's `gclidToCallTime` construction**

Read `supabase/functions/push-google-conversions/index.ts` lines ~497–545 (the `gclidToCallTime` map + its application in the Commercial backstop). Determine the key.

- [ ] **Step 2: Decide**

- If keyed by **gclid string** → no change; note "timing-safe for Tier-2" in this plan's PR description and proceed.
- If keyed by **phone/deal** → the recovered gclid must still resolve a click time. Add a follow-up task: when the pusher encounters a `Recovered_GCLID` it cannot time from its own map, look the gclid up in CTM `ctm_call` by `raw_payload->ga->>gclid` to get `received_at`. **Do not expand this plan's Zoho writes** — this is a pusher-side read. Flag to the user before implementing, as it modifies the conversion pusher.

- [ ] **Step 3: Record the finding**

Append the conclusion (safe / follow-up-needed) to `supabase/functions/backfill-gclid-to-zoho/README.md` under a "Downstream timing" heading, and commit.

---

### Task 7: Deploy + verify against live data (dry-run first)

**Files:** deploy of `supabase/functions/backfill-gclid-to-zoho/index.ts`.

- [ ] **Step 1: Deploy**

Deploy via the `supabase` MCP `deploy_edge_function` (project ref `fortdxbbazifklqwydnk`, slug `backfill-gclid-to-zoho`, files = the new `index.ts` + `matching.ts`). Confirm the returned version increments from 55.

> Note: the entrypoint imports `./matching.ts`; ensure BOTH files are included in the deploy payload.

- [ ] **Step 2: Dry-run the full pass**

Invoke the function with `{ "dry_run": true, "lookback_days": 90 }` (POST with the service-role/authorized bearer, since `verify_jwt=true`). Capture the JSON response.
Expected: `ok: true`, `dry_run: true`, `log_insert_error: null`, and the step counters populated. Note especially `step2c_by_method` — you should see non-zero `ctm_call_to_deal_guardian` and/or `*_email` counts if any exist in the last 90 days.

- [ ] **Step 3: Sanity-check a sample without writing**

For 2–3 deals the dry-run reports as newly matched via `guardian` or `email`, manually verify in CTM that the matched gclid’s call truly shares an identifier reachable from the deal (guardian phone / linked-contact phone / email). Use:
```sql
-- CTM project (supabase-ctm): confirm the matched call carries the gclid + identifier
select call_id, caller_number, raw_payload->'ga'->>'gclid' gclid, raw_payload->>'email' email, received_at
from ctm_call where call_id = '<matched_call_id>';
```
Expected: the call’s phone-last10 or email matches one of the deal’s gathered identifiers.

- [ ] **Step 4: Compare against a baseline count**

Confirm the change is additive, not a regression: the dry-run’s phone-only match counts (`ctm_call_to_contact`, `ctm_call_to_deal_direct`, `ctm_call_to_lead`) should be **>= 0 and consistent** with a `topup_only:false` run of the *old* logic. If phone-direct counts dropped, investigate before a live run.

- [ ] **Step 5: Limited live run**

Invoke with `{ "lookback_days": 7 }` (small window, real writes). Then verify writes + logging recovered:
```sql
-- main project (supabase): NEW rows should appear again (logging un-blocked) with new methods
select match_method, zoho_write_status, count(*)
from gclid_backfill_log
where attempted_at >= now() - interval '1 hour'
group by 1,2 order by 3 desc;
```
Expected: rows present (proving `log_insert_error` was resolved), including any `ctm_call_to_deal_guardian` / `*_email` successes. If `log_insert_error` was non-null in Step 2, fix the schema drift (align `logRows` keys to `gclid_backfill_log` columns) before this step and re-deploy.

- [ ] **Step 6: Full live run + confirm downstream**

Invoke with `{}` (default 90-day). After the next `push-google-conversions` cron cycle, confirm recovered gclids flow to Google:
```sql
-- main project: recovered-source pushes in the last 2 hours
select gclid_source, count(*) from conversion_push_log
where attempted_at >= now() - interval '2 hours' and gclid is not null
group by 1 order by 2 desc;
```
Expected: continued `zoho_recovered*` pushes; no new `error_msg='CONVERSION_PRECEDES_EVENT'` attributable to guardian-sourced gclids (cross-check Task 6).

- [ ] **Step 7: Open the PR**

```bash
cd /Users/macbookair152025/projects/admissions-copilot
git push -u origin feat/gclid-recovery-email-guardian
gh pr create --title "gclid recovery: email + Tier-2 guardian matching" --body "<summary + dry-run counts + Task 6 timing finding>"
```

---

## Notes for the implementer
- **`Ad_Click_Date` timing:** Leads enrichment writes `Ad_Click_Date = toZohoDate(received_at)`. Email/guardian matches use the SAME `PPCBundle`, so the click date remains the CTM call’s time — correct.
- **Precision guardrail:** `matchByIdentifiers` picks the single freshest bundle across all identifiers; it does not attach multiple/conflicting gclids. Household (Tier-3) and any "ambiguous → review" handling are explicitly out of scope.
- **Idempotency:** all steps still gate on `Recovered_GCLID is null`, so re-runs won’t overwrite existing recoveries. Email/guardian matches respect the same gate.
- **Do NOT** touch `conversion_push_log` event_type / gclid_source CHECK constraints — this feature reuses the existing `Recovered_GCLID` → `zoho_recovered*` path end-to-end.
