# Phase 1 Sign-off

Phase 1 of the Admissions Copilot reporting work is the end-to-end stack
from canonical taxonomy through dashboards: 1A locks the metrics
definitions, 1B builds the data layer, 1C ships the op-reporting
dashboards.

This sign-off was created retrospectively on 2026-05-31 alongside the
Phase 2A substrate build — the Phase 2 brief's prereq checklist called
for this file to exist, but it was never formally written at the time
Phase 1 wrapped. Each section reconstructs what shipped from commit
history + the canonical CONFIRMED.md decisions.

---

## Phase 1A — Taxonomy lock

**Shipped:** 2026-05-27 / 28 (PRs through #34).
**Owner:** Amber (decisions), Claude (implementation).
**Status:** ✓ Locked.

What landed:

- `docs/METRIC_DEFINITIONS.md` — 26 canonical sections.
- `docs/CONFIRMED.md` — 37+ decisions (now 42 after Phase 1B/2A revisions)
  documenting why each definition is shaped the way it is.
- `docs/OPEN_QUESTIONS.md` — open / deferred questions, with stable
  numbering so other docs can reference them.
- `src/lib/metrics/definitions.ts` — TS constants for every pipeline /
  stage_category / source_category / level_of_care / insurance_type /
  rep_role / marketing_channel.
- `src/lib/metrics/schemas.ts` — zod schemas + the `FilterContract` shape.
- `supabase/migrations/100_metric_enums.sql` — Postgres enums mirroring
  the TS definitions.
- `scripts/check-metric-literals.sh` — CI guard preventing inlined
  pipeline / stage / source / LOC string literals outside `definitions.ts`.
- `src/lib/metrics/__tests__/definitions.test.ts` — 145 property tests
  covering every classifier predicate.

Gate items closed:

- All 37 acceptance-gate Amber decisions documented in CONFIRMED.md.
- Typecheck + tests + lint guard all green.
- Merged to main via PR #34.

---

## Phase 1B — Data layer

**Shipped:** 2026-05-28 / 29 (PRs through #45).
**Owner:** Amber (decisions), Claude (implementation).
**Status:** ✓ Live in production.

What landed:

- `reporting.*` schema: 16 tables (raw mirrors, mappings, normalized,
  cached op_* rollups) with RLS.
- 5 sync edge functions (`reporting-sync-{users,deals,leads,meetings,calls}`)
  pulling from Zoho CRM / Analytics / CTM.
- Mapping cache + auto-derive helpers for stage / pipeline / LOC /
  source_category.
- `reporting_build_op_metrics(p_days_back)` rebuilds the trailing window;
  pg_cron scheduled every 3 hours + a Sunday weekly 365-day rebuild
  backstop.
- Verifier RPCs (`verifier_ground_truth_funnel`, `verifier_cached_funnel`)
  plus `scripts/verify_metrics.ts` driver.

Gate items closed:

- End-to-end sync smoke test passed on 2026-05-28.
- Drift check via `verify_metrics.ts` over the trailing 14-day window
  showed zero drift over tolerance.

---

## Phase 1C — Op reporting dashboards

**Shipped:** Throughout May 2026 (PRs #35 through #45).
**Owner:** Amber (UX feedback), Claude (implementation).
**Status:** ✓ Live in production behind feature flags.

What landed:

- `/analytics/op-overview` — executive summary page.
- `/analytics/op-funnel` — funnel breakdown with pipeline / source / LOC slices.
- `/analytics/op-rep-activity` — per-rep call + meeting activity.
- `/analytics/op-referrals` — referral inflow + referred-out closed mix.
- `/analytics/op-payer-mix` — payer-mix breakdown.
- `/analytics/op-sales-cycle` — sales-cycle days metric.
- `/analytics/op-data-quality` — sync failures + unmapped rows surfaces.
- Per-page hooks under `src/features/op-reporting/hooks/` consuming the
  `reporting_op_*` RPCs.
- `FilterBar` + URL-state hooks for shared filter chips.

Gate items closed:

- Amber verified `/vobs` and `/bd/meetings` live during the rev-8
  closeout (2026-05-27).
- Pages adopted at Cornerstone for daily executive review.

**Note on the Phase 2 prereqs:** Phase 1c shipped functionally — the
dashboards work — but the substrate the Phase 2 brief assumed (generic
`useMetric(key)` resolver + shared `/src/components/reporting/`
component library + `/reporting/_demo` route) wasn't part of the original
1c scope. Phase 2A introduces both retrospectively via the hybrid path
(see `docs/PHASE_2A_NOTES.md`).

---

## Phase 1 sign-off

Phase 1 is signed off **with the caveat** that the Phase 2 brief's
prereq for a generic resolver substrate + shared component library was
not part of the original 1c brief. That substrate is being introduced as
part of Phase 2A's hybrid path rather than retroactively expanding 1c.

The Phase 1 work itself — taxonomy, data layer, op-reporting dashboards
— is complete and live.

**Signed off:** 2026-05-31 (retrospectively).
**Next:** Phase 2 admissions dashboard. See `docs/PHASE_2A_NOTES.md` for
the substrate path + `docs/PHASE_2_PAGE_GUIDE.md` for the page template.
