# CRM Jail Audit Bot — Phase 1 Design

**Date:** 2026-09-15
**Status:** Approved (design). Implementation not started.
**Owner:** Amber Vaughan. Process owners: Aaron Maxwell (BD), Megan Pabon (Admissions).
**Governing policy:** OPS-CRM-001 — [CRM Jail Policy 9/4/2026](https://docs.google.com/document/d/1e1WRl6ev6LJ0upzPFO5ZkwTY8c_g_FDfFus3Ggqci9c/edit)
**Part of:** a three-phase program, one month per phase. This spec covers **Phase 1 only**.

## Problem

CRM Jail is already running manually. Every week Aaron and Megan each open a scorecard template,
pull five records per module at random for each rep, read every field by hand, score ~100 line
items, and file the result. Nine jail events were logged in the first two weeks. The process works
— it is the hand-scoring that does not scale, and hand-sampling is hard to defend if a rep disputes
a finding.

## Goal

Every Wednesday at 09:00 America/Phoenix, produce for each rostered rep a completed Google Sheets
scorecard covering the prior Mon–Sun, filed in the CRM Jail Drive folder, and notify Aaron and
Megan that the batch is ready for their review.

## Non-goals (Phase 1)

- **No contact with reps.** The bot never emails a rep, never sends a scorecard, never announces a
  jail list. That is Phase 3. Aaron and Megan remain the only people who deliver findings.
- **No writes to the Jail Log or Discipline Tracker.** Also Phase 3.
- **No Google Sheets auditing** beyond reading the templates it copies. That is Phase 2.
- **No KIPU access.** Deferred to Phase 2 (decision 2026-09-15).
- **No changes to Zoho records.** The bot is strictly read-only against the CRM.

## Existing artifacts this builds on

| Artifact | ID / location |
|---|---|
| CRM Jail Policy OPS-CRM-001 | `1e1WRl6ev6LJ0upzPFO5ZkwTY8c_g_FDfFus3Ggqci9c` |
| Admissions CRM Jail Audit Template | `1V9YS4ML9X5UPOWGf-mTNIJYQmGliC8LhwqVKBPZkbds` |
| BD CRM Jail Audit Template | derived from `16gBNt4LANkFnWxYSKM0AtbIkPFLoAo0t6dkr9EG3dw8` (Kenny Reitz 8/31–9/4) |
| CRM Jail Log and Discipline Tracker | `1l6PZE5JG4f7WWQQfzwIxyik_ypTUDH7Zu5wy4dmrUmM` |
| CRM Jail Drive folder | `1Ort4wcRcXeyKztq3O4wWzCLCCaRhsmfd` → `Admissions/` `1malRHoSkcrUc8zSD4czt74QvS5nvAFtz`, `Business Development/` `1Y4nHrFhkxf8YAwrc9SDbwrLTUHmoXw0f` |
| Completed manual scorecards, 8/31–9/4 | SJ `1NDCgAmZ…`, EW `1hlno-mbcl…`, MM `1GzMw_tJvS…`, TB `1nQDND0LE9…`, Kenny `16gBNt4LAN…` |

## Decisions locked

1. **Runtime:** Supabase edge functions + `pg_cron`, in the main project `fortdxbbazifklqwydnk`.
   Chosen over Google Apps Script and a standalone repo because it inherits working Zoho OAuth and
   token refresh, existing cron and logging, and a home for the roster that the dashboard can
   already administer.
2. **Compliance bands: the policy's, not the template's.** The two disagree; the policy is the
   signed document reps acknowledged. Bands, with the policy's 74–75% gap closed:

   | Overall score | Status | Jail |
   |---|---|---|
   | 100% | Exemplary | No |
   | 85–99.99% | Compliant | No |
   | 75–84.99% | Non-Compliant | Yes |
   | below 75% | Materially Non-Compliant | Yes, plus coaching plan |

   **This requires changing the formulas in both templates**, which currently encode jail below
   95%. Until that is done the bot and the sheet will disagree. See Prerequisites.
3. **Audit window: Monday–Sunday**, the week before the run. Note this differs from practice so far
   — every manual scorecard to date used Mon–Fri (8/31–9/4). Stored as config, not hard-coded.
4. **KIPU deferred to Phase 2** — affects D1–D4 (name/phone/email match KIPU) and D33–D35 (admit
   date, level of care, location match KIPU).
5. **The bot writes only `1` / `0` / `N/A` and explanation text. It never computes a percentage.**
   Section scores, overall score, compliance status and the jail decision stay in the template's
   own formulas. This keeps Aaron and Megan's arithmetic authoritative and makes bot output
   directly comparable against the manual baseline.
6. **Notes quality is judged by Claude**, with its reasoning written into the Explanation column so
   the auditor can override. Presence-only checking was rejected: in Kenny's audit CA8 failed on
   2 of 5 and BC11 on 2 of 5, so a length check would have materially overstated his score.

## Scope of automation, item by item

Derived from both templates. **Bot** = scored automatically. **Claude** = language judgment.
**Defer** = left blank and flagged for the auditor in Phase 1.

### Admissions

| Section | Items | Coverage |
|---|---|---|
| A — Daily | A1, A2 (EOD report same-day + complete) | **Defer.** Submissions appear to land in the [Admissions EOD Reports](https://docs.google.com/spreadsheets/d/1hbFRElBSGWWRyfmEzeJczWQPBlqJ620yCaIWRD925oU/edit) Google Sheet (owned by Amber, actively updated) — **its column structure has not yet been verified**. Sheets auditing is Phase 2, but this one is cheap to pull forward once the structure is confirmed. |
| A — Daily | A3 (everything touched was logged same day) | **Bot.** Aggregate over all records in window, not a sample. |
| A — Daily | A4, A5 (Daily Census), A6 (Intake Tracker) | **Defer** — Google Sheets, Phase 2. |
| Leads | L1–L25, L28 | **Bot** |
| Leads | L26, L27 (narrative, next step) | **Claude** |
| Contacts | C1–C11, C13 | **Bot** |
| Contacts | C12 (narrative + next step) | **Claude** |
| Deals | D1–D4 | **Defer.** Each asks that the value match the Contact record *and* KIPU. The Contact-record half is implemented and unit-tested in Phase 1 but not scored, because a partial check would pass records that fail the item as written. It activates in Phase 2 when KIPU arrives. |
| Deals | D5–D21, D24, D25, D26–D32, D36, D38–D41 | **Bot** |
| Deals | D22, D23, D37 | **Claude** |
| Deals | D33–D35 (match KIPU) | **Defer** |

D24 ("Stage matches the actual position in the sales cycle") is bot-scored as a consistency check —
Stage vs. the presence of the fields that stage implies — not as a judgment of whether the rep
chose correctly. Flagged for the auditor when it fails.

### Business Development

| Section | Items | Coverage |
|---|---|---|
| A — Daily | A1 (referral form), A2, A3 (EOD report) | **Defer.** BD EOD submissions are `EODReport.pdf` files in Drive folder `1BEjYWsL2yZVecMUydiTwpiSZZ-IhV1rn` — same filename each time, latest from Aug 2025. Needs PDF parsing; Phase 2. |
| A — Daily | A4, A5 (all calls / meetings logged same day) | **Bot.** Aggregate over window. |
| A — Daily | A6, A7 (assigned spreadsheet) | **Defer** — Google Sheets, Phase 2. |
| Business Contacts | BC1, BC2, BC4–BC10 (there is no BC3) | **Bot** |
| Business Contacts | BC11 (role and relationship described) | **Claude** |
| Calls | CA1–CA6, CA9 | **Bot** |
| Calls | CA7, CA8 (narrative, next step) | **Claude** |
| Companies | CO1–CO18 | **Bot** |
| Meetings | M1–M6, M9 | **Bot** |
| Meetings | M7, M8 (agenda, next steps) | **Claude** |

Note the BD template numbers Business Contacts BC1, BC2, **BC4**–BC11 — there is no BC3. The rule
engine preserves the template's numbering verbatim rather than renumbering.

## Zoho module mapping

Confirmed from the record links in Kenny's completed scorecard, and against a full module listing.

| Scorecard section | Zoho module |
|---|---|
| Leads | `Leads` |
| Contacts / Business Contacts | `Contacts` (business contacts = `Business Contact Role` populated) |
| Deals | `Deals` |
| Companies | `Accounts` |
| Calls | `Calls` |
| Meetings | `Events` |

**There is no EOD Report module in Zoho CRM.** The full module list contains only the standard
modules plus custom modules for Verification of Benefits, ZohoSign, RingCentral/Twilio SMS, and
VoC. EOD reports are Zoho Forms, a separate product, and land in Drive as described above.

## Architecture

```
pg_cron  Wed 09:00 America/Phoenix
   └─> crm-jail-run            orchestrator; reads roster, fans out per rep, writes ledger
         └─> crm-jail-audit-rep    (one invocation per rep)
               ├─ fetch     COQL per module, window + owner filtered
               ├─ sample    deterministic seeded shuffle, n=5
               ├─ score     rule engine → 1 | 0 | N/A | DEFER + explanation
               ├─ judge     Claude call for the language items
               └─ write     Drive files.copy → Sheets values.batchUpdate
         └─> notify          one summary to Aaron + Megan
```

### Components

**`crm_jail_roster`** (table + admin UI). Columns: `zoho_user_id`, `full_name`, `email`, `team`
(`admissions` | `bd`), `auditor_email`, `active`, `notes`. Administered at `/admin/crm-jail`,
`AdminOnly`, behind a new `page_crm_jail` FeatureKey and a gated `<Route>` in `src/App.tsx`, per
the conventions in CLAUDE.md.

*Why a table and not a Zoho profile query.* Measured against the live directory on 2026-09-15:
the `Business Development` profile contains exactly the five BD reps, but the `TREATMENT Standard`
profile contains 14 users including a Court Services Coordinator and ten people never audited —
and **Sabrina Johnson, who Megan audited on 8/31–9/4, has the `Administrator` profile.** A profile
query would both over-include and miss a real rep. Both teams use the table so there is one place
to look.

**Fetcher.** COQL per module filtered by owner and by `Created_Time` or `Modified_Time` inside the
window. Also pulls the Notes related list, Deal attachments (D38–D41), and the meetings related
list for BC9/BC10. Paginated via COQL `LIMIT`/`OFFSET`; fetch errors are thrown, never swallowed.

**Sampler.** Deterministic seeded shuffle, seed = `${window_start}:${zoho_user_id}:${module}`. A
re-run of the same week draws the same five records, so a scorecard is reproducible if a rep
disputes it under policy §7. Fewer than five available → take all; remaining record columns score
`N/A` so they leave the denominator, matching how Kenny's Meetings section scored 3/9 rather than
3/45.

**Rule engine.** `rules/admissions.ts` and `rules/bd.ts`, one pure function per item ID:
`(record, ctx) => { score: 1 | 0 | 'N/A' | 'DEFER', explanation?: string }`. Conditional groups
return `N/A` when their gate does not apply — L17–L20 only when the record is BD-sourced, D26–D31
only when referred out, D32–D35 only when closed won, D36–D37 only when closed lost.

**Any Stage, Source Category, or pipeline literal these gates test must be imported from
`src/lib/metrics/definitions.ts`, never inlined** — `npm run lint:metrics` enforces this, and
`Closed - Referred Out Unattached` in particular is a Win, not a loss (CONFIRMED.md #1).

**Notes judge.** One Claude call per record, scoring that record's language items together so the
model sees the whole note once. Returns a score and a one-sentence reason per item, written to the
Explanation column. Same posture as the existing CTM call-scoring bot. **This sends note text,
which can contain PHI, to the Claude API** — confirm coverage before enabling (see Prerequisites).

**Sheet writer.** `files.copy` the team template → rename `{Initials}: CRM Audit {M/D}-{M/D}/{YYYY}`
for Admissions and `BD CRM Jail Audit: {Full Name} {M/D}-{M/D}/{YYYY}` for BD, matching existing
naming → move into `CRM Jail/{Team}/{Rep}/`, creating the per-rep folder if absent → one
`values.batchUpdate` writing header cells, record identity rows (name, Zoho URL, created date),
score cells, and explanations. **Computed cells are never written.** Deferred cells are left empty
and given a distinct background fill so the auditor can see at a glance what is left to do.

**Orchestrator and ledger.** `crm_jail_runs`: `id`, `run_at`, `window_start`, `window_end`,
`zoho_user_id`, `team`, `sheet_id`, `sheet_url`, `status`, `deferred_cells`, `error_msg`. Free-text
columns, no CHECK constraints — a CHECK constraint is what silently killed `gclid_backfill_log`.

**Notifier.** One message to Aaron and Megan: rep, score, status, jail yes/no, sheet link, and the
count of cells still needing a human. Reps are not on it.

## Error handling

- **Per-rep isolation.** One rep's failure is recorded in the ledger and the run continues.
- **Zoho auth failure aborts the entire run** and alerts, rather than emitting scorecards that look
  complete but are empty. This is the lesson from the conversion-push incident, where a function
  that kept running through a token problem silently zeroed real data.
- **Idempotent per (rep, window).** A re-run reuses the sample seed and overwrites the same sheet
  instead of creating a second one. Manual edits made by an auditor are detected via the sheet's
  `modifiedTime` against the ledger; if the sheet changed after the bot wrote it, the re-run creates
  a `-v2` copy rather than destroying their work.
- **Rep with no activity in the window** gets a sheet with all items `N/A` and a flag, not a 0%.
  A rep on PTO should not land in jail for it.
- **Claude call failure** degrades that item to deferred, not to 0. A model outage must never cost a
  rep points.
- **`dry_run` mode from day one** — writes to a scratch folder, notifies nobody.

## Verification

The acceptance gate is a **replay of the 8/31–9/4 window against the five completed manual
scorecards** (Kenny Reitz, Eric Wade, Michael Mendez, Taylor Bertchie, Sabrina Johnson), diffed item
by item. Every disagreement must be explained as either a bot defect or a manual-audit error before
Phase 1 is accepted. This is precisely what the month of Phase 1 is for, and it is why Phase 1 sends
sheets to Aaron and Megan rather than to reps.

Supporting tests: unit tests per rule function against fixture records covering the pass case, the
fail case, and the N/A gate; a sampler test asserting the same seed yields the same draw; a
sheet-writer test asserting no computed cell is ever in the write range.

## Prerequisites (human, before implementation)

1. **Reconcile both templates' formulas to the policy bands** (jail below 85%). Until this is done
   the bot and the sheet will report different compliance statuses for the same score.
2. **Megan confirms the admissions roster** — profile data cannot produce it.
3. **Google service account** created, with access to the CRM Jail folder and both templates.
4. **Confirm Claude API coverage for note text** containing PHI, or fall back to deferring the
   language items.

## Carried to Phase 2

KIPU matching (D1–D4, D33–D35) · Daily Census (A4–A5) · Intake Assessment & Tracker (A6) · BD
assigned spreadsheets (A6–A7) · BD EOD PDFs (A1–A3) · Admissions EOD sheet (A1–A2, cheap to pull
forward) · Clinical Outreach Forms.

## Carried to Phase 3

Direct-to-rep scorecard delivery · the weekly jail assignment list · writes to the Jail Log and
Discipline Tracker · per-rep Drive filing of delivered scorecards.

**Open question for Phase 3:** policy §4 promises reps their results by 5:00 PM the business day
before their session, and the earliest session is Monday 7:00 AM — so notices are due Friday 5:00
PM. A Wednesday 09:00 generation gives Aaron and Megan two days, which works, but the bot's own
send time in Phase 3 needs to be set against the Friday deadline, not the Wednesday run.
