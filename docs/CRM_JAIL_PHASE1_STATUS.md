# CRM Jail Audit Bot — Phase 1 status

**Code complete 2026-09-16.** Not yet scheduled; see *Before it runs unattended*.

## What it does

Every Wednesday 09:00 America/Phoenix it audits the prior Mon–Sun for each rostered
rep, files a scorecard in the **CRM Audits** shared drive under `{Rep}/{Year}/{Month}`,
and shares it with that rep's auditor so Google sends the notification. **Reps are never
contacted** — that is Phase 3.

## Verified end to end against live data

Zoho auth with a shared cached token · COQL across six modules · deterministic seeded
sampling · 128 scoring rules · Claude notes judging via structured outputs · the
documented-blank rule · Google service-account auth · template copy · cell writing with
the template's own formulas recalculating · `Rep/Year/Month` filing · per-rep isolation
with retry · run ledger.

Last full run: **9/9 reps, no failures.**

## Accuracy — the acceptance gate

`scripts/crm-jail-replay.ts` scores the exact records Aaron and Megan sampled by hand for
8/31–9/4 and diffs item by item.

| | |
|---|---|
| Agreement | **92.1%** across 1,013 compared items (up from 88.0%) |
| Bot-stricter | 42 (was 82) |
| Bot-softer | 38 |
| Per rep | 94.4%, 91.0%, 91.0% |

Four rules were found one-sided against the auditors and corrected or deferred:

| Item | Was | Now |
|---|---|---|
| D25 / L28 / C13 | `Created_Time` vs `Modified_Time` — failed every live record | deferred; Zoho does not record when the work happened |
| D17 | branched to `AHCCCS_Insurance_Provider`, null on every deal | reads `Insurance_Provider_New` for both payer types |
| D20 | scored policy type on Medicaid, where it does not apply | N/A for AHCCCS |
| D38 | matched attachment names against `/referral/i` | deferred; real packets are not named that way |

The residual disagreement is mostly **language items** (C12, L26, D23, D37) where Claude and
a human differ on whether a note counts as a narrative. That is judgement variance, which the
auditor review step exists to absorb — a different thing from a rule that is wrong on every
record. Chasing it further risks overfitting to two people's marking of one week.

**One pattern to ask Megan about, not to "fix":** L1, L7, L8 and L15 each disagree three times
and are *always* bot-softer, clustered on the same leads. The auditor failed whole records the
bot passes — likely something record-level she can see and the bot cannot.

## Deferred to Phase 2

KIPU matching (D1–D4, D33–D35) · Daily Census (A4–A5) · Intake Tracker (A6) · BD assigned
spreadsheets (A6–A7) · BD EOD PDFs (A1–A3) · Admissions EOD sheet (A1–A2) · Clinical Outreach
Forms · the same-day and referral-packet items above.

## Before it runs unattended

1. **Enable the cron** — `supabase/migrations/199_crm_jail_cron.sql`, written and deliberately
   not applied. Turning it on starts weekly emails to Aaron and Megan.
2. **Megan confirms the admissions roster** at `/admin/crm-jail`. Discovered candidates arrive
   inactive; `TREATMENT Standard` also carries intake and Court Services.
3. **One live run reviewed by Aaron and Megan** before anyone is jailed on a bot score.

## Operational notes

- **Zoho load**: a full run makes roughly 575 Zoho calls in ~2 minutes. Fine weekly; repeated
  ad-hoc runs will throttle the whole app, including the other sync functions.
- **Templates were corrected 2026-09-16** to the policy bands. The Non-Compliant threshold read
  `>=0.84`, making that band a 1% sliver and labelling everyone between 75–84% as *Materially*
  Non-Compliant. Anyone previously marked Materially in that range — Kenny 77.8%, Joey 78.2%,
  Taylor 78.5%, Mike 82.8% — was mislabelled under policy §4.
- **The service account cannot permanently delete** anything in the shared drive. Structural, and
  worth keeping.
