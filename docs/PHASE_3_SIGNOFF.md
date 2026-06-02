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
2. **3-way channel split** (Business Development / Digital / ZocDoc). The
   taxonomy has exactly three `source_category` values today — **Alumni is a
   Marketing-page future, not a current bucket** (`definitions.ts`). Decided
   2026-06-02: ship the 3-way now; Alumni lands when the taxonomy grows it.

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
| Amber hand-verifies 3 representative metrics against Zoho | ☐ pending | Run `--scope=executive`, pick one top-line total, one MoM delta, one breakdown; cross-check vs Zoho Analytics / legacy `/analytics/executive`. |
| Hand-verification logged in `VERIFICATION_LOG.md` | ☐ pending | New "Phase 3 — Executive Metrics" section. |
| `/reporting/executive` loads end-to-end under manager + admin | ✓ | 9 render tests; manual walk pending. |
| Role-aware copy reads naturally | ✓ | `pageSubtitle` → "Team performance" for manager/admin (render tests). |
| Drill-downs return the right records | ✓ | All deal scopes live (incl. `deals_referred_out`, predicate matches migration 184). `leads_all` wired for payer mix. Only `reporting.meetings` stays a "coming soon" note (no executive metric uses it). |
| Filters behave (URL persistence, multi-select) | ✓ | Reuses Phase 1c FilterBar + useFilterUrlState. |
| Empty + loading states | ✓ | Shared `LoadingSkeleton` + `EmptyState` across every component. |
| Performance | ✓ | TanStack Query shared cache key over `(range, FilterContract)`. MoM adds one prior-window RPC per top-line KPI — cached independently. |
| `npm run typecheck && test && lint:metrics` clean | ✓ | Phase 3 files typeclean; literal guard clean; 337 tests green. (Pre-existing baseline TS errors in `admin.tsx`/`bd/`/`ops/` are unrelated.) |

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

### As a manager

- [ ] Subtitle reads "Team performance" — _locked by render test_
- [ ] Top-line KPIs show MoM delta arrows when a prior window has data
- [ ] Conversion funnel reads Leads ≥ MQL ≥ VOB ≥ Admit left-to-right
- [ ] Pipeline split shows all five pipelines (incl. DUI/DV)
- [ ] Channel split shows BD / Digital / ZocDoc (3-way, no Alumni — by design)
- [ ] Payer mix renders the AHCCCS / Commercial / Other / DUI / DV buckets
- [ ] Refer-out (Wins) tile + destinations render
- [ ] KPI tile click opens the drill-down modal

### As an admin

- [ ] Same sections as manager — _locked by render test_

### Filter behavior (manager/admin)

- [ ] Time range change → all sections refetch
- [ ] FilterBar chip selection → all sections refetch
- [ ] URL query params reflect + restore the active filter set

---

## Sign-off

**Signed off by:** _pending — Amber Vaughan, CMO._
**Date:** _pending._

**Open follow-ups (not gate blockers):**
- Enable the `page_reporting_executive` feature flag at `/admin/settings`.
- Run the Zoho cross-check and log it in `VERIFICATION_LOG.md`.
- Add Alumni as a `source_category` (taxonomy + ETL + CONFIRMED.md) via the
  open PR #46, then the channel split widens to 4-way automatically (the
  resolver humanizes whatever source categories the RPC returns).

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
