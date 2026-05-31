# Phase 2A — Architectural decision + status

**Date:** 2026-05-31
**Owner:** Amber (decision), Claude (implementation)

## Substrate path: hybrid

The Phase 2 brief assumed a prereq foundation that wasn't shipped during Phase 1c:

- `/src/lib/metrics/resolver.ts` — a generic `useMetric(key)` substrate
- `/src/components/reporting/` — a shared component library
  (KPICard, TrendChart, BarChart, DataTable, DrilldownModal, AsOfBadge,
  EmptyState, LoadingSkeleton, ChartContainer)
- `/docs/VERIFICATION_LOG.md`, `/docs/PHASE_1_SIGNOFF.md`
- `/reporting/_demo` route

Three options were on the table:

1. **Phase 1d first** — retro-build the substrate before any Phase 2 code.
2. **Adapt the brief** — build Admissions on the per-metric hooks + MetricCard
   pattern the existing `/analytics/*` pages use.
3. **Hybrid** — build the substrate AS we build Admissions. The page is the
   first consumer; each component / resolver gets its first home in Phase 2A
   and is re-usable from Phase 3 onward.

Amber picked **Hybrid**. Rationale:

- Phase 1c shipped working dashboards on per-metric hooks. We have a clear
  picture of what the components and resolver actually need to do.
- The brief's premise that this page is "the template every future page
  imitates" only holds if the substrate exists. The hybrid path gets both
  the page AND the template at the same time — no upfront retro cost.
- We can extract additional patterns into the substrate as Phase 3 / 4
  pages reveal them.

## Resolver registration model

`src/lib/metrics/resolver.ts` exposes a small registry:

```ts
registerMetrics(defs: ReadonlyArray<MetricDefinition>): void
getMetric(key: string): MetricDefinition
```

Each `keys/<page>.ts` file calls `registerMetrics()` as a side effect on
import. The dashboard page (and its tests) imports the keys file at the top.
`useMetric(key, filters)` is the React Query hook every UI consumer uses.

This is intentionally lighter than the brief's "one resolver.ts holds
everything" suggestion — splitting by page keeps each file under ~600 lines
and lets Phase 3 / 4 add new pages without churn on the substrate.

## Status of admissions resolvers

23 metric keys total. **18 of 23 wired (78%); 5 remaining need new RPCs.**

### ✓ Wired (18)

| Group | Keys |
|---|---|
| Conversion ratios | `mql_to_vob_rate`, `vob_to_admit_rate`, `mql_to_admit_rate` |
| Team totals | `mqls_total`, `vobs_total`, `admits_total` |
| By LOC | `mqls_by_requested_loc`, `vobs_by_requested_loc`, `admits_by_admitted_loc` |
| By rep | `mqls_by_rep`, `vobs_by_rep`, `admits_by_rep` |
| Call activity | `missed_call_pct_team`, `inbound_calls_team`, `outbound_calls_team`, `inbound_calls_by_rep`, `outbound_calls_by_rep` |
| Closed Lost (partial) | `closed_lost_total` |

All 18 are backed by existing op_* RPCs:

| RPC | Metrics |
|---|---|
| `reporting_op_funnel_daily_filtered` | 6 (3 totals + 3 ratios + closed_lost_total) |
| `reporting_op_funnel_by_loc_filtered` | 3 by-LOC breakdowns |
| `reporting_op_rep_funnel` | 3 by-rep breakdowns |
| `reporting_op_rep_activity` / `_filtered` | 5 call-activity metrics |

### ⏳ Stubbed (5) — task #58

Each throws a typed `not_yet_wired` error pointing here.

- `admissions.{mqls,vobs,admits}_by_rep_by_loc` — matrix; needs
  `reporting_op_funnel_by_rep_by_loc_filtered` pivoting
  `op_lead_funnel_daily` on `(owner_user_id × level_of_care)`.
- `admissions.closed_lost_by_reason` — needs
  `reporting_op_closed_lost_by_reason_filtered` reading from
  `reporting.deals.closed_lost_reason` (CONFIRMED.md #36).
- `admissions.closed_lost_by_rep` — can derive from
  `reporting_op_rep_funnel` (already returns `closed_lost_count`); just
  needs the resolver wired analogously to the other by_rep metrics.
  *Note: this one is actually trivial — flagging for cleanup.*

### Test coverage

| Test bucket | Count |
|---|---|
| Helper / registry / contract | 7 |
| Wired resolvers (numeric correctness + edge cases) | 25 |
| Stubbed `not_yet_wired` contract | 6 |
| **Total** | **38** |

### Known gaps surfaced during wiring

- **`reporting_op_rep_funnel` is not filter-aware.** The 3 by-rep metrics
  honor the `reps` filter client-side; pipeline / source / LOC filters are
  silent no-ops on this surface. Building a `_filtered` variant is a follow-up.
- **Call totals have no daily series.** `reporting_op_rep_activity` already
  aggregates away the date dimension; sparklines for call metrics need
  either a new RPC or a client-side re-aggregation off the per-day cache.
  Phase 2B decision.

## Acceptance gate (per the brief)

Before Phase 2B can start:

- [x] All `admissions.*` metric_keys defined in `keys/admissions.ts` and
      exported (23 keys; verified by `_listRegisteredKeys()` test).
- [ ] All resolver tests pass against seed data (current PR: tests pass for
      the 5 wired resolvers + 18 stub-raises contracts).
- [ ] `/scripts/verify_metrics.ts --scope=admissions` shows zero drift on
      every wired `admissions.*` metric for a 30-day window. (Pending the
      remaining 18 wirings + verify_metrics script update.)
- [ ] Amber spot-checks 3 metrics by hand from the resolver against Zoho:
  - one volume metric (e.g. `admits_total` this month)
  - one conversion rate (e.g. `mql_to_admit_rate` this month)
  - one rep-scoped metric viewed as an admissions rep (own admits)
- [ ] Hand-verification logged in `/docs/VERIFICATION_LOG.md` under a new
      "Phase 2a — Admissions Metrics" section.

## Next decisions

1. **Wire the remaining 13 existing-RPC resolvers in this PR, or follow-up?**
   Recommend: this PR (it's mechanical + the substrate is hard to validate
   with only 5 metrics live).
2. **Build the 5 new RPCs (task #58) in 2A or split to a separate PR?**
   Recommend: separate PR — the matrix RPC needs its own design review
   (pivot strategy, response shape).
3. **Hand-verification:** Amber to spot-check three metrics before the 2A
   gate closes.
