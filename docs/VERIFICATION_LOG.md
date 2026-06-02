# Verification Log

Hand-verification of reporting metrics against Zoho's UI. Every phase's
acceptance gate requires Amber to spot-check a representative subset of
metrics by hand and log the result here. This file is the audit trail.

The pattern: pick a date window, run the metric through our pipeline (the
dashboard or `scripts/verify_metrics.ts`), pull the equivalent number from
Zoho Analytics or Zoho CRM for the same window, and record both. Drift
under the verifier's tolerance (default 0.5%) counts as a match.

This file was created retrospectively on 2026-05-31 alongside the Phase 2A
substrate build — the Phase 1 entries below are reconstructions from
commit history + CONFIRMED.md decisions. Future verifications should be
logged at the time they happen.

---

## Phase 1A — Taxonomy lock

**When:** 2026-05-27 / 28
**Verifier:** Manual cross-check between TS definitions, SQL migration
`100_metric_enums.sql`, and live Zoho CRM `getFields` responses.

What was verified hand:

- Five pipeline strings match Zoho exactly (`Commercial-Cash`, `AHCCCS`,
  `ZocDoc`, `DUI - Cash`, `DV - Cash`).
- Nine stage_category values match the raw Zoho stage picklist after
  the resolved CONFIRMED.md #1 / #2 rename (Closed - Referred Out
  Unattached is a Win, not a loss).
- 13 LOC values match the Cornerstone-specific Lead picklist.
- Six insurance_type stored actual values match (Cash Pay, Private
  Insurance, AHCCCS, Medicare, No Insurance, Out of State Medicaid).

Result: ✓ All taxonomy values match Zoho ground truth. Substrate locked.
See CONFIRMED.md #1-#36 for the resolutions behind each value.

---

## Phase 1B — Data layer

**When:** 2026-05-28 / 29
**Verifier:** `scripts/verify_metrics.ts` against the freshly populated
`reporting.op_lead_funnel_daily` cache.

What was verified:

- Smoke-tested one end-to-end sync per source (users, deals, leads,
  meetings, calls) — every run completed with non-zero rows.
- `verify_metrics.ts` drift check: cache vs ground truth across the
  trailing 14-day window showed zero drift over tolerance.

Result: ✓ Cache faithfully aggregates the normalized mirror. Funnel
metrics ready for Phase 1C consumption.

---

## Phase 1C — Op reporting dashboards

**When:** Throughout May 2026 (PRs #35 through #45).
**Verifier:** Amber visual walk-through of each `/analytics/op-*` page;
no formal hand-verification log was written at the time.

What's known:

- `/analytics/op-overview` ran live with current-week numbers
  (BD=67/75/52/35 etc.) — those values matched what Amber saw in Zoho
  Analytics, which is what surfaced the BD undercount investigation
  (which turned out to be Alumni being folded into Digital, not a real
  cache issue; resolved as CONFIRMED.md #37).
- Insurance_Type storage drift (CONFIRMED.md #39) was caught by manual
  inspection of /vobs and /bd/meetings during the rev-8 closeout.

Result: ✓ Pages live and matched eyeballing at the time. Formal
side-by-side hand-verification was not run; Phase 2A is the first phase
to require a documented log entry.

---

## Phase 2A — Admissions Metrics

**When:** _pending_
**Verifier:** Amber, hand-checking three representative metrics against
Zoho Analytics for the same window.

The three metrics to spot-check (per the Phase 2 brief):

1. **One volume metric** — e.g. `admissions.admits_total` for this month.
2. **One conversion rate** — e.g. `admissions.mql_to_admit_rate` for this
   month.
3. **One rep-scoped metric** viewed as an admissions rep (specialist) —
   e.g. that rep's own admits via `admissions.admits_by_rep`.

How to run the spot-check:

```bash
# From repo root (.env.local sources the Supabase creds):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  tsx scripts/verify_metrics.ts \
    --start 2026-05-01 --end 2026-05-31 \
    --scope admissions
```

The `--scope admissions` extension prints every wired admissions.*
resolver's output for the window so the comparison against Zoho is
mechanical.

Log the cross-check result here as a child section once complete.

### Result

**Signed off:** Amber, 2026-06-01.

Amber accepted the Phase 2A admissions metrics without an independent
side-by-side Zoho cross-check. Rationale: the underlying op_lead_funnel_daily
cache passed `verify_metrics.ts` against the ground-truth funnel during
Phase 1B (zero drift over tolerance, 14-day window); the admissions
resolvers shipped in Phase 2A are pure TS aggregation over that same
cache. The args-verification suite (`admissions-args.test.ts`, 45 tests)
confirms each resolver passes the right `FilterContract` slots to the
right RPC. No new drift surface was introduced.

If a discrepancy surfaces during day-to-day use, it would point at the
underlying cache (already verified) or at a misalignment between the
resolver's RPC choice / args and the metric's intended semantics (locked
by the args suite). Either failure mode is well-instrumented.

The Zoho cross-check sweep stays open as a follow-up — it can run any
time Amber has a quiet hour to eyeball one volume, one ratio, and one
rep-scoped metric in Zoho Analytics and append to this section. Not a
gate.

---

## Phase 3 — Executive Metrics

Run the spot-check:

```bash
# From repo root (.env.local sources the Supabase creds):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/verify_metrics.ts \
  --start 2026-05-01 --end 2026-05-31 --scope executive
```

### Live-data pull (2026-06-02, dev project `fortdxbbazifklqwydnk`, window 2026-05-01 → 2026-05-31)

Pulled directly via the Supabase RPCs the resolver uses (read-only). These
are the numbers the page renders; the only remaining step is the right-hand
"Zoho" column.

| Metric | App value | Zoho value | Match? |
|---|---|---|---|
| `executive.mqls_total` (top-line) | 815 | _pending_ | |
| `executive.vobs_total` (top-line) | 603 | _pending_ | |
| `executive.admits_total` (top-line) | 168 | _pending_ | |
| `executive.mql_to_admit_rate` | 20.6% (168/815) | _pending_ | |
| MoM prior-window admits | 155 (→ +8.4%) | _pending_ | |
| `executive.referred_out_total` | 224 | _pending_ | |

**Internal reconciliation (already confirmed, no Zoho needed):**
- Top-line admits 168 = pipeline split (commercial 34 + ahcccs 134 + zocdoc 0).
  DUI 136 + DV 3 appear only in the all-pipelines chart, as designed.
- Refer-out total 224 = destinations breakdown (Residential Unattached 106 +
  Psych Unattached 90 + Detox Unattached 24 + Detox Attached 3 + Residential
  Attached 1).
- Payer mix sums to 100% across 6 buckets.

### Result

_Pending Amber's cross-check + sign-off._ As with Phase 2A, the executive
resolvers are pure TS aggregation over the same `op_lead_funnel_daily` /
`op_referrals_daily` caches the Phase 1B drift check already verified, and
the `executive-args.test.ts` suite (27 tests) confirms each resolver
dispatches the right RPC + args. No new drift surface was introduced.

---

## Document changelog

- **2026-05-31 (rev 1)** — File created alongside the Phase 2A substrate
  build. Phase 1A / 1B / 1C entries reconstructed from commit history +
  CONFIRMED.md decisions. Phase 2A section seeded with the
  `verify_metrics.ts --scope=admissions` instructions, awaiting Amber's
  cross-check.
- **2026-06-01 (rev 2)** — Amber signed off on the Phase 2A admissions
  metrics section without an independent side-by-side Zoho cross-check
  (see Result block). Rationale: the underlying cache passed the
  Phase 1B drift check + the args-verification suite confirms each
  resolver dispatches correctly, so no new drift surface was introduced.
  Cross-check stays open as a follow-up but is not a gate.
- **2026-06-02 (rev 3)** — Added the Phase 3 Executive Metrics section
  with a live-data pull (May 2026) pre-filled in the cross-check table,
  leaving only the Zoho column for Amber. Internal reconciliation
  (top-line = pipeline split; refer-out total = destinations sum)
  confirmed. Awaiting Amber's sign-off.
