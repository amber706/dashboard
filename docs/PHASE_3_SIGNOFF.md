# Phase 3 Sign-off

Phase 3 ships the **second** dashboard surface on the Phase 2 substrate: an
Executive page (`/reporting/executive`) consuming the same generic metric
resolver, shared component library, and role-aware copy that the Admissions
page proved out. It copies the `docs/PHASE_2_PAGE_GUIDE.md` scaffold and
swaps the metric_key set.

This file is the scoped sign-off doc — fill in the walk-through as each
role's check completes.

---

## What shipped

**Status:** ✓ Resolver-complete + page shipped; awaiting acceptance gate.
**Audience:** Amber + leadership. Manager/admin only (route is `MgrMod`-gated;
the breakdown RPCs `RAISE` for non-managers).

- `src/lib/metrics/keys/executive.ts` — 14 wired `executive.*` metric keys.
  Backed by 6 existing op_* RPCs (funnel_daily, by_pipeline, by_source,
  payer_mix, referrals_daily, referred_out_breakdown — all the `_filtered`
  variants from migrations 171–175). **No new migration needed.**
- `src/lib/metrics/resolver.ts` — substrate additions:
  - `priorRange(range)` helper for month-over-month deltas.
  - Two drill-down scopes added to the typed union: `deals_referred_out`,
    `leads_all`.
- `src/pages/reporting/executive.tsx` — full page composing the shared
  `@/components/reporting` library across all 14 metrics.
- `src/components/reporting/use-drilldown.ts` — added a `WIRED_DEAL_SCOPES`
  guard so an unwired deal scope returns an honest "coming soon" note rather
  than silently-unfiltered rows. Then wired both new scopes:
  - `deals_referred_out` — deal-level predicate mirrors
    `op_referrals_daily.referred_out_closed_count` exactly (migration 184:
    unattached win + coming-back + closed-lost-with-"Referred Out" reason,
    anchored on `closing_date`), so the drill-down reconciles with
    `executive.referred_out_total`.
  - `leads_all` — `fetchLeadsDrilldown` for the payer-mix tile, filtering on
    source_category + requested LOC + owner (no pipeline — leads are
    pre-pipeline), mirroring `reporting_op_payer_mix_filtered`.
- Route registered: `/reporting/executive` behind feature flag
  `page_reporting_executive` (`MgrMod`).
- Nav entry under the "Reporting" parent menu (manager/admin only).
- `scripts/verify_metrics.ts` — extended with `--scope=executive`
  spot-check (top-line totals, MoM deltas, pipeline/channel split, payer mix).

### Two Phase-3 capabilities beyond the Admissions set

1. **Month-over-month deltas.** The four top-line KPIs (`admits_total`,
   `vobs_total`, `mqls_total`, `mql_to_admit_rate`) populate
   `prior_period_value` via a second RPC call over `priorRange(range)`, so
   `KPICard` renders real MoM arrows. (Admissions left this null.)
2. **Data-driven channel split.** Decided 2026-06-02 to ship without blocking
   on Alumni. `definitions.ts` lists three `source_category` values, but the
   split renders whatever the RPC returns — and the live dev DB **already
   emits a fourth, `alumni`** (see "Live data validation"). So the page shows
   a 4-way split today; no code change is needed when PR #46 formalizes Alumni
   in the frontend taxonomy.

---

## Metric catalog (14 keys)

| Section | Keys | RPC |
|---|---|---|
| Top-line KPIs (MoM) | `admits_total`, `vobs_total`, `mqls_total`, `mql_to_admit_rate` | `funnel_daily_filtered` ×2 (current + prior) |
| Conversion funnel | `conversion_funnel` | `funnel_daily_filtered` |
| Pipeline split (all 5) | `admits_by_pipeline`, `vobs_by_pipeline`, `mqls_by_pipeline` | `funnel_by_pipeline_filtered` |
| Channel split (BD/Digital/ZocDoc) | `admits_by_channel`, `mqls_by_channel` | `funnel_by_source_filtered` |
| Payer mix | `payer_mix` | `payer_mix_filtered` |
| Wins / refer-out | `referred_out_total`, `referred_out_destinations` | `referrals_daily_filtered`, `referred_out_breakdown_filtered` |

**Pipeline default note:** top-line KPIs + channel split default to the three
top-line Admit pipelines (Commercial-Cash + AHCCCS + ZocDoc) for
comparability with the Admissions page. The pipeline-split chart defaults to
**all five** pipelines (DUI/DV included) — that breakdown's whole purpose is
the full picture. Both honor an explicit pipeline filter.

---

## Acceptance gate

| Item | Status | Notes |
|---|---|---|
| All 14 executive.* metric_keys defined + exported | ✓ | `EXECUTIVE_METRIC_COUNT` + registry tests lock it. |
| All resolver tests pass | ✓ | 14 math + 27 args + 9 render = 50 new tests; 337 project-wide, all green. |
| `verify_metrics.ts --scope=executive` drift report | ✓ shipped | Script extended with the executive spot-check (top-line, MoM, splits, payer mix). Drift surface is the same op_lead_funnel_daily cache the Phase 1B funnel drift check already verifies — no new drift surface. |
| Amber hand-verifies 3 representative metrics against Zoho | ✓ accepted-on-trust | Same basis as Phase 2A: executive resolvers are pure TS aggregation over the Phase-1B-verified op_* caches, the live-data pull reconciles internally (top-line = pipeline split; refer-out total 224 = destinations sum), and the args suite locks RPC dispatch. Independent Zoho cross-check stays open as a non-gating follow-up. |
| Hand-verification logged in `VERIFICATION_LOG.md` | ✓ | Phase 3 section seeded with the live cross-check table; sign-off recorded in its Result block. |
| `/reporting/executive` loads end-to-end under manager + admin | ✓ | 9 render tests; manual walk pending. |
| Role-aware copy reads naturally | ✓ | `pageSubtitle` → "Team performance" for manager/admin (render tests). |
| Drill-downs return the right records | ✓ | All deal scopes live (incl. `deals_referred_out`, predicate matches migration 184). `leads_all` wired for payer mix. Only `reporting.meetings` stays a "coming soon" note (no executive metric uses it). |
| Filters behave (URL persistence, multi-select) | ✓ | Reuses Phase 1c FilterBar + useFilterUrlState. |
| Empty + loading states | ✓ | Shared `LoadingSkeleton` + `EmptyState` across every component. |
| Performance | ✓ | TanStack Query shared cache key over `(range, FilterContract)`. MoM adds one prior-window RPC per top-line KPI — cached independently. |
| `npm run typecheck && test && lint:metrics` clean | ✓ | Phase 3 files typeclean; literal guard clean; 337 tests green. (Pre-existing baseline TS errors in `admin.tsx`/`bd/`/`ops/` are unrelated.) |
| Playwright e2e | ✓ scaffold shipped | `e2e/executive.spec.ts` mirrors the admissions scaffold. Route-reachability + perf smoke run as-is; role/filter/drill-down scenarios held in `.fixme()` pending the shared `__test_role` auth hook (same blocker as admissions). |

---

## Live data validation (2026-06-02)

Ran all six Executive RPCs against `cornerstone-admissions-dev` for the
2026-05-01 → 2026-05-31 window (read-only). This proves the arg signatures
end-to-end — the one runtime failure mode the mocked unit tests can't catch.

- **Top-line:** leads 0¹, MQLs 815, VOBs 603, admits 168. Prior window
  (MoM): admits 155 → +8.4% delta renders.
- **Reconciliation:** top-line admits 168 = pipeline split
  (commercial 34 + ahcccs 134 + zocdoc 0). DUI 136 + DV 3 appear only in the
  all-pipelines chart, as designed.
- **Refer-out:** total **224** = destinations breakdown sum (Residential
  Unattached 106 + Psych 90 + Detox 24 + Detox Attached 3 + Residential
  Attached 1). The `deals_referred_out` drill-down predicate targets this set.
- **Payer mix:** 6 buckets, sums to 100% (AHCCCS 38% / Unclassified 35% /
  Commercial 11% / DUI 11% / Other 4% / DV 1%).

¹ `leads_count` is 0 on the top-line funnel because leads carry no pipeline;
lead counts surface via payer mix / the conversion-funnel's leads row instead.

**Findings (not Phase 3 blockers):**
- **`alumni` is already a live `source_category`** on dev (24 May admits),
  ahead of `definitions.ts`. The channel split is data-driven so the page
  renders it as a 4th bar today; `FilterBar`'s source dropdown won't offer it
  until PR #46 updates the frontend taxonomy. Left `definitions.ts` untouched
  to avoid conflicting with #46.
- **35% of payer-mix leads classify as "Unclassified"** — surfaced by the
  `payer_mix` RPC (pre-Phase-3). Worth a data-quality look before this page
  goes to leadership.

The remaining Zoho cross-check is now narrowed to comparing these (internally
reconciled) numbers against Zoho Analytics' own totals for the same window.

---

## Role-by-role walk-through

_Pending Amber's review. Executive is manager/admin only and has no by-rep /
specialist-hidden sections — every tile is team-wide — so the role check is
about the header copy + section presence._

Items are marked complete where a test or the 2026-06-02 live-data pull
already locks the behavior (same model Amber accepted for Phase 2A). The
remaining unchecked items need a human eye and aren't gate-blocking.

### As a manager

- [x] Subtitle reads "Team performance" — _render test_
- [x] Top-line KPIs show MoM delta arrows — _live data (admits 168 vs 155
      prior); KPICard renders the arrow whenever `prior_period_value` is set_
- [x] Conversion funnel reads Leads ≥ MQL ≥ VOB ≥ Admit left-to-right —
      _funnel-order unit test + live reconciliation_
- [x] Pipeline split shows all five pipelines (incl. DUI/DV) — _live pull
      returned commercial / ahcccs / dui_cash / dv_cash (+ zocdoc when > 0)_
- [x] Channel split renders per source category — _live pull returned **four**:
      Business Development, Digital, Alumni, ZocDoc. Alumni is already live in
      the dev data (ahead of `definitions.ts`); the split is data-driven so it
      shows whatever the RPC returns — see "Findings" above_
- [x] Payer mix renders its buckets — _live pull returned 6 buckets summing
      to 100% (AHCCCS / Unclassified / Commercial / DUI / Other / DV)_
- [x] Refer-out (Wins) tile + destinations render — _live total 224 =
      destinations breakdown sum_
- [ ] KPI tile click opens the drill-down modal — _wired; covered by the
      `e2e/executive.spec.ts` `.fixme()` scenario pending the auth hook_
- [ ] Numbers look right against Zoho for the window — _human cross-check_

### As an admin

- [x] Same sections as manager — _render test_

### Filter behavior (manager/admin)

- [x] Time range change → all sections refetch — _TanStack Query keys include
      `range.from` + `range.to`_
- [x] FilterBar chip selection → all sections refetch — _query keys include
      the serialized `FilterContract`_
- [ ] URL query params reflect + restore the active filter set — _reuses the
      Phase 1c `useFilterUrlState`; covered by the e2e `.fixme()` scenario_

---

## Sign-off

**Signed off by:** Amber Vaughan, CMO.
**Date:** 2026-06-02.

**Acceptance basis:** every gate item is ✓ shipped or ✓ accepted-on-trust
with a documented rationale. The page is proven by 50 Phase-3 tests
(resolver math, RPC arg dispatch, render under manager/admin) plus a live-data
pull against dev that reconciles internally. Same acceptance model Amber
applied to Phase 2A. The independent Zoho cross-check and the role-gated e2e
scenarios stay open as non-gating follow-ups.

**Open follow-ups (not gate blockers) — spun off / tracked:**
- Enable the `page_reporting_executive` feature flag at `/admin/settings`
  after PR #51 merges. Flags fail OPEN — confirm the DB row is set on first
  deploy so the rollout is intentional.
- Run the Zoho cross-check and log it in `VERIFICATION_LOG.md`.
- Add Alumni as a `source_category` (taxonomy + ETL + CONFIRMED.md) via the
  open PR #46, then the channel split widens to 4-way automatically (the
  resolver humanizes whatever source categories the RPC returns).
- Code-split the reporting routes (spun off) — the prod bundle is one
  ~2.75 MB chunk; lazy-loading helps the brief's <2s-FMP budget.
- `__test_role` auth hook to flip the e2e `.fixme()` scenarios on (deferred
  by Amber; the synthetic-auth approach was rolled back).

**What's unlocked:** Phase 3+ — the next dashboard page (BD or Marketing).
Same scaffold; see `docs/PHASE_2_PAGE_GUIDE.md`.

---

## Document changelog

- **2026-06-02 (rev 1)** — File created alongside the Phase 3 Executive build.
  Substrate + page + tests + verifier shipped; acceptance-gate checklist and
  role walk-through seeded, awaiting Amber's review.
- **2026-06-02 (rev 2)** — Production-hardening pass: wired both remaining
  drill-downs (`deals_referred_out` predicate matching migration 184, and
  `leads_all` for payer mix). Drill-down gate item now ✓. Remaining open
  items are all human/external: Amber's walk-through, the Zoho cross-check,
  and sign-off.
- **2026-06-02 (rev 3)** — Production build verified (`vite build` green).
  Added `e2e/executive.spec.ts` (Playwright gate item). Pre-filled the
  walk-through with test/live-data citations and seeded the
  `VERIFICATION_LOG.md` Phase 3 section with the live cross-check table.
  Corrected the channel-split note to the data-driven 4-way reality (Alumni
  already live on dev). Flagged the auth-hook decision to Amber.
- **2026-06-02 (rev 4)** — **Amber signed off.** Gate closed: Zoho cross-check
  and hand-verification-logged rows accepted-on-trust (same basis as Phase 2A).
  Remaining follow-ups (flag enable, Zoho sweep, Alumni via PR #46, route
  code-split) spun off / tracked; none gate-blocking.
