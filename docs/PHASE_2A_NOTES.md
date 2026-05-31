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

23 metric keys total. The first PR ships:

- ✓ **Substrate** — `resolver.ts`, `use-metric.ts`, full catalog with metadata
  + drill-down config for all 23 keys.
- ✓ **5 wired resolvers** representing each shape variant:
  - `admissions.mqls_total` — scalar via `reporting_op_funnel_daily_filtered`
  - `admissions.closed_lost_total` — scalar (same RPC, different column)
  - `admissions.mql_to_admit_rate` — derived ratio (validates null-on-zero-denom)
  - `admissions.admits_by_admitted_loc` — breakdown via
    `reporting_op_funnel_by_loc_filtered`
  - `admissions.missed_call_pct_team` — derived ratio via
    `reporting_op_rep_activity`
- ✓ **Tests** — registry shape, drill-down config presence, inverse-flag set,
  numeric correctness for all 5 wired resolvers, null-on-zero-denominator
  spec case, "stub raises" contract test for the 18 not-yet-wired keys.

The remaining 18 are mechanical fill-in once Amber greenlights the approach:

### Maps to existing RPCs (13 resolvers, ~1 hour of typing)

| Key | RPC |
|---|---|
| `admissions.admits_total`, `vobs_total` | `reporting_op_funnel_daily_filtered` |
| `admissions.mql_to_vob_rate`, `vob_to_admit_rate` | same (derived) |
| `admissions.{mqls,vobs}_by_requested_loc` | `reporting_op_funnel_by_loc_filtered` |
| `admissions.{mqls,vobs,admits}_by_rep` | `reporting_op_rep_funnel` |
| `admissions.{inbound,outbound}_calls_team` | `reporting_op_rep_activity` |
| `admissions.{inbound,outbound}_calls_by_rep` | same |

### Needs new RPCs (5 resolvers, task #58)

- `admissions.{mqls,vobs,admits}_by_rep_by_loc` — matrix; needs
  `reporting_op_funnel_by_rep_by_loc_filtered` pivoting
  `op_lead_funnel_daily` on (owner_user_id × level_of_care).
- `admissions.closed_lost_by_reason` — needs
  `reporting_op_closed_lost_by_reason_filtered` reading from
  `reporting.deals.closed_lost_reason`.
- `admissions.closed_lost_by_rep` — can derive from
  `reporting_op_rep_funnel` if it already returns `closed_lost_count`;
  otherwise needs a small additive RPC.

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
