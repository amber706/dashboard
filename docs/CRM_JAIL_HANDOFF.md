# CRM Jail — developer handoff

For **Aaron**, who audits by hand today and is picking up the bot that replaces it.
General project setup lives in [`ONBOARDING.md`](../ONBOARDING.md) and
[`docs/ACCESS_SETUP.md`](ACCESS_SETUP.md); this covers only what is specific to CRM Jail.

---

## 1. Access

GitHub write access on `amber706/dashboard` is already granted (`aaronmxwl`). Nothing to
request there. Supabase, Zoho and the CRM Audits shared drive you already have.

The one thing not covered by backend access: an **app login** with `admin` role, needed to
reach the roster screen at `/admin/crm-jail`. Ask Amber.

## 2. Get the code

Phase 1 is merged. `main` has all of it:

```bash
git clone https://github.com/amber706/dashboard.git admissions-copilot-frontend
cd admissions-copilot-frontend
npm ci
```

It landed as a **single squash commit**, `68d4262` (PR #65), because the feature branch had
no common ancestor with `main` — so `git log` on these files shows one commit rather than the
fifty that built them. If you need to know how a rule came to be the way it is, the
per-decision history is in PR #65, and the commit subjects there are written to be read.

## 3. Run the checks

```bash
npm run typecheck && npm run test && npm run lint:metrics   # 385 vitest tests
cd supabase/functions/crm-jail && deno test --allow-all     # 213 tests
```

Nearly all the audit logic is Deno edge-function code, so `deno test` is the suite that
matters for this work. `npm run test` covers only the roster screen.

## 4. How a run happens

Three live pg_cron jobs, all defined in numbered migrations:

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `crm-jail-weekly` | `0 16 * * 3` | audits the prior Mon–Sun, one invocation fanned out per rep |
| `crm-jail-weekly-notify` | `25 16 * * 3` | shares each scorecard with that rep's auditor, 25 min later |
| `referred-out-report-daily` | `50 13 * * *` | the separate Referred Out / Coming Back report |

Pause one with `select cron.unschedule('crm-jail-weekly');`.

The function reads these secrets from the Supabase edge-function environment — names only,
values come from the Supabase dashboard:

`ANTHROPIC_API_KEY` · `GOOGLE_SA_EMAIL` · `GOOGLE_SA_PRIVATE_KEY` · `CRM_JAIL_DRIVE_ID` ·
`CRM_JAIL_PROFILE_MAP` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY`

Zoho is different: the bot owns its own token in `crm_jail_zoho_token` and validates it
before building a run on it, rather than borrowing another function's.

Invocation flags, for manual runs: `dry_run`, `skip_notify`, `notify_only`, `team`,
`windowFrom`, `run_at`, `note`.

## 5. Four things that will bite you

1. **Don't re-run it ad hoc.** A full run makes ~575 Zoho calls in about two minutes. Weekly
   is fine; repeated manual runs throttle Zoho for the whole app, including the other syncs.
   Use `dry_run` or a single `team` while developing.
2. **A run reporting `9 ok / 0 failed` says nothing about delivery, or about which week it
   audited.** The first live run returned exactly that and was wrong twice over. Check
   `shareFailures`, and check `crm_jail_runs.window_start` against the window in the
   response. Both original bugs are fixed in `e580f6c` and pinned by tests.
3. **`notify_only` against the 8/24–8/30 or 8/31–9/6 windows would send dead links.** Those
   scorecards were trashed as wrong-week output, but their `crm_jail_runs` rows were kept
   deliberately as the record that the runs happened. It takes an explicit window, so
   nothing reaches it by accident.
4. **Pass the window, don't re-derive it.** `auditWindowFor` returns the week *before* the
   week containing its argument. Handing a child `run_at` instead of `windowFrom` is what
   made every child audit a week early.

## 6. Where the thinking is written down

| File | What it holds |
|---|---|
| [`CRM_JAIL_PHASE1_STATUS.md`](CRM_JAIL_PHASE1_STATUS.md) | current state, the replay numbers, operational notes — **read first** |
| [`CRM_JAIL_FIELD_MAP.md`](CRM_JAIL_FIELD_MAP.md) | every scorecard item mapped to its Zoho field, and the four that have none |
| [`CRM_JAIL_REPLAY_RESULTS.md`](CRM_JAIL_REPLAY_RESULTS.md) | item-by-item diff against the manual audits |
| [`superpowers/specs/2026-09-15-crm-jail-audit-bot-phase1-design.md`](superpowers/specs/2026-09-15-crm-jail-audit-bot-phase1-design.md) | the design, and why each component exists |
| [`superpowers/plans/2026-09-15-crm-jail-audit-bot-phase1.md`](superpowers/plans/2026-09-15-crm-jail-audit-bot-phase1.md) | the 12-task implementation plan |

Four scorecard items have no backing Zoho field (L18/D13 Partner Program, D7 How Did You
Hear, D31 Follow-up scheduled, D35 Admitted Location) and score as `DEFER` — flagged, not
0% — rather than being guessed at.

## 7. Accuracy, and what is still open

`scripts/crm-jail-replay.ts` scores the exact records you and Megan sampled for 8/31–9/4 and
diffs item by item: **92.1% agreement across 1,013 items**. The residual is mostly language
items (C12, L26, D23, D37) where a human and the model disagree on whether a note counts as
a narrative — judgement variance the auditor review step absorbs, not a broken rule. Chasing
it further risks overfitting to one week of two people's marking.

Open, and wanting a human rather than a code change:

- **The 9/23 live run needs your review** before anyone is disciplined on a bot score. It has
  already run.
- **Megan confirms the admissions roster** at `/admin/crm-jail`. Discovered candidates arrive
  inactive, and `TREATMENT Standard` also carries intake and Court Services.
- **L1, L7, L8 and L15** each disagree three times, always bot-softer, clustered on the same
  leads — Megan failed whole records the bot passes. Likely something record-level she can
  see and the bot cannot. Worth asking her before touching those rules.

Phase 2 (KIPU matching, Daily Census, Intake Tracker, BD spreadsheets and EOD PDFs) and
Phase 3 (rep notification, discipline-tracker auto-update) are not started.
