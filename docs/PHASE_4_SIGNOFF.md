# Phase 4 Sign-off

Phase 4 ships the **third** dashboard on the Phase 2 substrate: a Business
Development page (`/reporting/bd`) reusing the same resolver, shared component
library, and role-aware copy. Copies the `docs/PHASE_2_PAGE_GUIDE.md` scaffold
and swaps the metric_key set.

**Status:** ✓ Built + tested; awaiting acceptance gate.
**Audience:** BD reps + Amber. Manager/admin only (`MgrMod`; the
funnel/referral RPCs `RAISE` for non-managers — BD *reps* need an RLS change
to view it, tracked as a follow-up).

---

## What shipped

- `src/lib/metrics/keys/bd.ts` — 13 wired `bd.*` metric keys, backed by
  **existing** op_* RPCs (referrals_daily, funnel_by_source,
  referred_out_breakdown, rep_activity). **No new migration.**
- `src/lib/metrics/resolver.ts` — one additive drill-down scope: `meetings_all`.
- `src/pages/reporting/bd.tsx` — page composing the shared
  `@/components/reporting` library; lazy-loaded route.
- Route + nav + feature flag (`page_reporting_bd`, `MgrMod`).
- `scripts/verify_metrics.ts` — `--scope=bd` spot-check.
- Tests: 10 resolver-math + 19 RPC-args + 6 render = **35 new**.

### Catalog (13 keys)

| Section | Keys | RPC |
|---|---|---|
| Referral inflow | `referrals_in_total` (MoM), `referrals_in_by_channel` | `referrals_daily_filtered` |
| BD-sourced funnel | `mqls_from_bd`, `vobs_from_bd`, `admits_from_bd` (MoM), `bd_mql_to_admit_rate`, `admits_by_source` | `funnel_by_source_filtered` (BD row) |
| Wins / refer-out | `referred_out_total` (MoM), `referred_out_destinations` | `referrals_daily` + `referred_out_breakdown_filtered` |
| BD rep activity | `meetings_total` (MoM), `meetings_by_type`, `meetings_by_rep`, `calls_by_bd_rep` | `rep_activity` (role_derived = bd_rep) |

### Deliberately out of scope (no warehouse data yet)
- **Account intelligence** (top/stuck accounts) — no `reporting.accounts`
  table; the legacy `/bd/*` pages read Zoho-direct.
- **Referral-inflow-by-BD-rep** — inflow is by-CHANNEL on the substrate;
  per-rep BD contribution is surfaced via meetings/calls instead.

---

## Acceptance gate

| Item | Status | Notes |
|---|---|---|
| 13 `bd.*` keys defined + exported | ✓ | `BD_METRIC_COUNT` + registry tests. |
| Resolver + args + render tests pass | ✓ | 35 new; full suite green. |
| `verify_metrics.ts --scope=bd` | ✓ shipped | Referral / funnel / meetings spot-check. |
| `/reporting/bd` loads under manager + admin | ✓ | 6 render tests. |
| Role-aware copy | ✓ | `pageSubtitle` → "Team performance". |
| Drill-downs | ◑ | Deal + leads + calls scopes live; `meetings_all` returns the honest "coming soon" note (no meetings drill-down fetcher yet). |
| Filters (URL persistence) | ✓ | Reuses Phase 1c FilterBar + useFilterUrlState. |
| `lint:metrics` clean | ✓ | Labels humanized at runtime; no inline literals. |
| `typecheck` clean (Phase 4 files) | ✓ | BD files typeclean. (The stack still carries the pre-existing 45 baseline TS errors until PR #52 merges to `main`.) |
| Amber walk-through + Zoho cross-check + sign-off | ☐ pending | Run `--scope=bd`; walk the page under manager/admin. |

---

## Branch / PR

Stacked on the Phase 3 branch: **#50 ← #51 ← (this)**. Base
`reporting/phase-3-executive-metrics`; the substrate isn't on `main` yet.
Also picks up the route code-splitting commit that landed on the Phase 3
branch.

**Open follow-ups (not gate blockers):** enable `page_reporting_bd` after
merge (flags fail OPEN); relax RLS / RPC guards if BD *reps* should view the
page; a `reporting.meetings` drill-down fetcher; account intelligence when a
`reporting.accounts` table lands.

---

## Document changelog

- **2026-06-02 (rev 1)** — Phase 4 BD dashboard built on existing RPCs (no
  migration). 13 keys, page, route/nav/flag, `--scope=bd` verifier, 35 tests.
  Awaiting Amber's walk-through + sign-off.
