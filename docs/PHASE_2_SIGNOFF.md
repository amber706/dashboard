# Phase 2 Sign-off

Phase 2 ships the first real dashboard surface on the Phase 1 reporting
stack: a unified Admissions page consuming a generic metric resolver
substrate. Future Executive / BD / Marketing pages copy this scaffold.

This file is the scoped sign-off doc — fill in the verification + walk
sections as each role's check completes.

---

## What shipped

### Phase 2A — Substrate + admissions catalog

**Status:** ✓ Resolver-complete; awaiting acceptance gate.
**PRs:** #50.

- `src/lib/metrics/resolver.ts` — registry + `MetricDefinition` + result
  shapes (`ScalarResult`, `BreakdownResult`, `MatrixResult`).
- `src/lib/metrics/use-metric.ts` — TanStack Query hook every dashboard
  page uses.
- `src/lib/metrics/keys/admissions.ts` — 23 wired admissions.* metric
  keys. Backed by 6 op_* RPCs (4 existing + 2 new from migration 193).
- `src/lib/metrics/__tests__/admissions.test.ts` — 32 tests covering
  registry shape, drilldown config, inverse-flag set, numeric correctness
  for all 23 wired resolvers, null-on-zero-denominator spec case,
  unattributed/null-axis fallback.
- Migration 193 — new RPCs for the rep × LOC matrix + closed-lost-by-reason
  breakdown.

### Phase 2B — Admissions page + component library

**Status:** ✓ Page + components + drill-downs shipped.
**PRs:** #50 (same PR).

- `src/components/reporting/` — 9 shared components (KPICard, TrendChart,
  BarChart, MatrixTable, DrilldownModal, AsOfBadge, EmptyState,
  LoadingSkeleton, ChartContainer).
- `src/pages/reporting/admissions.tsx` — full page composing all 23
  admissions metrics in the 8 sections the brief specified.
- `src/lib/reporting/role_copy.ts` — role-aware label helper.
  `roleLabel(role, "MQLs")` → "Your MQLs" / "Team MQLs".
- `src/components/reporting/use-drilldown.ts` — live drill-down for
  reporting.deals (4 scopes) + reporting.calls (3 scopes).
- Route registered: `/reporting/admissions` behind feature flag
  `page_reporting_admissions`.
- Nav entry under the "Reporting" parent menu.
- `docs/PHASE_2_PAGE_GUIDE.md` — template doc for future dashboards.

---

## Acceptance gate

| Item | Status | Notes |
|---|---|---|
| All 23 admissions.* metric_keys defined + exported | ✓ | `_listRegisteredKeys()` test locks the count. |
| All resolver tests pass | ✓ | 32 admissions tests; 229 project-wide. |
| `verify_metrics.ts --scope=admissions` drift report | ⏳ pending | Script extended; awaiting first run by Amber over a 30-day window. |
| Amber hand-verifies 3 representative metrics against Zoho | ⏳ pending | Volume + ratio + rep-scoped. See `VERIFICATION_LOG.md` Phase 2A section. |
| Hand-verification logged in `VERIFICATION_LOG.md` | ⏳ pending | Scaffold ready. |
| `/reporting/admissions` loads end-to-end under all three roles | ⏳ pending | Awaiting feature-flag toggle + Amber walk. |
| Role-aware copy reads naturally under each role | ⏳ pending | Same walk. |
| Drill-downs return the right records | ⏳ pending | Deals + calls scopes wired; leads/meetings stub returns "coming soon" since no admissions metric uses those sources. |
| Filters behave as expected (URL persistence, multi-select) | ⏳ pending | Reuses Phase 1c FilterBar + useFilterUrlState; should behave identically to existing /analytics/op-* pages. |
| Empty + loading states look right | ⏳ pending | LoadingSkeleton + EmptyState wired uniformly across every component. |
| Performance feels snappy | ⏳ pending | TanStack Query cache shared across components (stable key over range + filters). |
| `PHASE_2_PAGE_GUIDE.md` complete | ✓ | Shipped; covers substrate + page-layer pattern. |
| Page-level component test | ⏳ deferred | Pure-logic tests for `role_copy.ts` shipped (13 tests). Render tests need `@testing-library/react` + `jsdom` deps; deferred to a follow-up. |
| Playwright tests | ⏳ deferred | Separate infra commit. |

---

## Role-by-role walk-through

_To be filled in by Amber after enabling the feature flag and walking
the page._

### As an admissions rep (UserRole = "rep")

- [ ] Subtitle reads "Your performance"
- [ ] By-Rep section is hidden
- [ ] Rep × LOC matrix is hidden
- [ ] Closed-Lost by Rep section is hidden
- [ ] Conversion ratios show only my data (verified via fixture: I have N
      admits and the page shows N)
- [ ] Inbound / outbound call cards show my totals, not the team's
- [ ] KPI tile clicks open the drill-down modal with my records

### As a manager

- [ ] Subtitle reads "Team performance"
- [ ] By-Rep section visible (3 bar charts)
- [ ] Rep × LOC matrix visible with the tab control switching between
      MQLs / VOBs / Admits
- [ ] Closed-Lost by Rep section visible
- [ ] Conversion ratios show team-wide values
- [ ] KPI tile clicks open the drill-down modal with team records

### As an admin

- [ ] Subtitle reads "Team performance"
- [ ] Same sections as manager
- [ ] Admin-only sections (none on this page) absent

### Filter behavior (any role)

- [ ] Time range picker change → all 8 sections refetch
- [ ] FilterBar chip selection → all sections refetch
- [ ] URL query params reflect the active filter set
- [ ] Reloading the URL restores the same filter set
- [ ] Empty filter result shows the "No data" empty state, not a crash

---

## Sign-off

**Signed off by:** _Amber, pending the walk-through above._
**Date:** _pending_
**Open items at sign-off:** _pending — fill in as items land._

Once signed off, Phase 3 (next dashboard page) can begin. See
`docs/PHASE_2_PAGE_GUIDE.md` for the template.

---

## Document changelog

- **2026-05-31 (rev 1)** — File created alongside the full Phase 2A + 2B
  build (PR #50). Scaffold seeded with the acceptance-gate checklist and
  role-by-role walk-through template, awaiting Amber's review.
