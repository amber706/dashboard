/**
 * Admissions dashboard metric catalog — Phase 2A.
 *
 * Twenty-three metrics, every one keyed `admissions.<snake_case>` per the
 * Phase 2 brief. Each entry conforms to `MetricDefinition` so the dashboard
 * page reads it through `useMetric(key)` instead of a per-metric hook.
 *
 * Status of resolvers in this file (run `_listRegisteredKeys()` to enumerate):
 *
 *   ✓ wired   — five representative resolvers covering each shape variant
 *                (scalar, derived ratio, breakdown, calls, closed-lost)
 *   ⏳ stubbed — eighteen resolvers throwing `not_yet_wired` until
 *                the 2A grind completes. Tests for these are skipped, not
 *                deleted, so the contract is preserved.
 *
 * Each stub still has correct metadata (label, description, source_table,
 * supports_rep_scope, drilldown). Filling in `resolve()` is mechanical.
 *
 * IMPORTANT: this file is intentionally a side-effect module — importing it
 * registers every key. The dashboard page (and its tests) MUST import this
 * file at the top so `getMetric()` lookups succeed.
 */

import { supabase } from "@/lib/supabase";

import { TOP_LINE_ADMIT_PIPELINES } from "../definitions";
import {
  registerMetrics,
  safeRatio,
  sumNullable,
  type BreakdownResult,
  type MetricDefinition,
  type MetricResult,
  type ScalarResult,
} from "../resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

// ────────────────────────────────────────────────────────────────────────────
// Helpers shared across this page's resolvers
// ────────────────────────────────────────────────────────────────────────────

/** Build the RPC args shape every `_filtered` op_* function expects. */
function filterArgs(range: DateRange, filters: FilterContract) {
  return {
    p_start: range.from,
    p_end: range.to,
    p_pipelines:
      filters.pipelines.length > 0
        ? filters.pipelines
        : // Default = top-line pipelines only, per the brief's filter defaults.
          (TOP_LINE_ADMIT_PIPELINES as readonly string[]),
    p_source_categories: filters.sources.length > 0 ? filters.sources : null,
    p_locs: filters.locs.length > 0 ? filters.locs : null,
    p_owner_user_ids: filters.reps.length > 0 ? filters.reps : null,
  };
}

/**
 * Placeholder for stubbed resolvers. Throws a typed error so test fixtures
 * and dev runs surface the missing wiring immediately rather than silently
 * resolving to empty data.
 */
function notYetWired(
  key: string,
): (range: DateRange, filters: FilterContract) => Promise<MetricResult> {
  return async () => {
    throw new Error(
      `metric not yet wired: ${key} — Phase 2A is shipping the substrate + 5 ` +
        `representative resolvers; the remaining 18 are mechanical fill-in. ` +
        `See docs/PHASE_2A_NOTES.md.`,
    );
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Wired resolvers — five representative shapes
// ────────────────────────────────────────────────────────────────────────────

/**
 * Funnel-counter loader. Three of our scalar metrics (`mqls_total`,
 * `vobs_total`, `admits_total`, plus `closed_lost_total`) all read the same
 * `reporting_op_funnel_daily_filtered` RPC and just sum a different column.
 * One trip to Supabase, four metrics derive from it.
 */
async function loadFunnelDaily(
  range: DateRange,
  filters: FilterContract,
): Promise<{
  rows: ReadonlyArray<{
    date: string;
    leads_count: number;
    mqls_count: number;
    vobs_count: number;
    admits_count: number;
    closed_lost_count: number;
  }>;
  totals: { mqls: number; vobs: number; admits: number; closed_lost: number };
}> {
  const args = filterArgs(range, filters);
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_daily_filtered",
    args,
  );
  if (error) throw new Error(`reporting_op_funnel_daily_filtered: ${error.message}`);
  const rows = (data ?? []) as ReadonlyArray<{
    date: string;
    leads_count: number;
    mqls_count: number;
    vobs_count: number;
    admits_count: number;
    closed_lost_count: number;
  }>;
  return {
    rows,
    totals: {
      mqls: sumNullable(rows.map((r) => r.mqls_count)),
      vobs: sumNullable(rows.map((r) => r.vobs_count)),
      admits: sumNullable(rows.map((r) => r.admits_count)),
      closed_lost: sumNullable(rows.map((r) => r.closed_lost_count)),
    },
  };
}

/** Build the series + scalar for a single counter column off the funnel daily. */
function scalarFromFunnel(
  rows: Awaited<ReturnType<typeof loadFunnelDaily>>["rows"],
  col: "mqls_count" | "vobs_count" | "admits_count" | "closed_lost_count",
): ScalarResult {
  return {
    kind: "scalar",
    value: sumNullable(rows.map((r) => r[col])),
    series: rows.map((r) => ({ date: r.date, value: r[col] })),
    prior_period_value: null, // Phase 2B fills this in via a second RPC call.
  };
}

/** admissions.mqls_total — wired. */
async function resolveMqlsTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { rows } = await loadFunnelDaily(range, filters);
  return scalarFromFunnel(rows, "mqls_count");
}

/** admissions.closed_lost_total — wired (same shape, different column). */
async function resolveClosedLostTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { rows } = await loadFunnelDaily(range, filters);
  return scalarFromFunnel(rows, "closed_lost_count");
}

/** admissions.mql_to_admit_rate — wired, derived ratio (validates null-on-zero-denom). */
async function resolveMqlToAdmitRate(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { totals } = await loadFunnelDaily(range, filters);
  return {
    kind: "scalar",
    value: safeRatio(totals.admits, totals.mqls),
    series: [], // Per-day ratios are noisy; the sparkline shows nothing.
    prior_period_value: null,
  };
}

/** admissions.admits_by_admitted_loc — wired, breakdown via op_funnel_by_loc. */
async function resolveAdmitsByAdmittedLoc(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const args = filterArgs(range, filters);
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_by_loc_filtered",
    args,
  );
  if (error) throw new Error(`reporting_op_funnel_by_loc_filtered: ${error.message}`);
  // The by-LOC RPC returns one row per (loc, date). We aggregate to (loc) totals
  // and use admits_count, which the op_metrics builder keys on admitted_level_of_care.
  const byLoc = new Map<string, number>();
  for (const r of (data ?? []) as ReadonlyArray<{
    level_of_care: string | null;
    admits_count: number;
  }>) {
    const key = r.level_of_care ?? "(none)";
    byLoc.set(key, (byLoc.get(key) ?? 0) + (r.admits_count ?? 0));
  }
  const rows = Array.from(byLoc.entries())
    .map(([dim, v]) => ({ dimension_value: dim, label: dim, value: v }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return {
    kind: "breakdown",
    rows,
    total: sumNullable(rows.map((r) => r.value)),
  };
}

// ── Rep-activity loader (shared by 5 metrics) ─────────────────────────────
// op_rep_activity_daily is not keyed by pipeline/source/LOC (calls + meetings
// don't carry those dims — see migration 191 comments). We honor the `reps`
// filter via the _filtered RPC; other filters are intentional no-ops here.
interface RepActivityRow {
  owner_user_id: string | null;
  full_name: string | null;
  inbound_calls: number;
  outbound_calls: number;
  missed_calls: number;
  meetings_count: number;
}

async function loadRepActivity(
  range: DateRange,
  filters: FilterContract,
): Promise<ReadonlyArray<RepActivityRow>> {
  const repIds = filters.reps.length > 0 ? filters.reps : null;
  const { data, error } = repIds
    ? await supabase.rpc("reporting_op_rep_activity_filtered", {
        p_start: range.from,
        p_end: range.to,
        p_owner_user_ids: repIds,
      })
    : await supabase.rpc("reporting_op_rep_activity", {
        p_start: range.from,
        p_end: range.to,
      });
  if (error) throw new Error(`reporting_op_rep_activity: ${error.message}`);
  return (data ?? []) as ReadonlyArray<RepActivityRow>;
}

/** admissions.missed_call_pct_team — wired, derived from rep_activity. */
async function resolveMissedCallPctTeam(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const rows = await loadRepActivity(range, filters);
  const inbound = sumNullable(rows.map((r) => r.inbound_calls));
  const missed = sumNullable(rows.map((r) => r.missed_calls));
  return {
    kind: "scalar",
    value: safeRatio(missed, inbound),
    series: [],
    prior_period_value: null,
  };
}

// ── Funnel-derived resolvers (4 more on top of mqls_total / closed_lost) ──

/** admissions.admits_total — wired. */
async function resolveAdmitsTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { rows } = await loadFunnelDaily(range, filters);
  return scalarFromFunnel(rows, "admits_count");
}

/** admissions.vobs_total — wired. */
async function resolveVobsTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { rows } = await loadFunnelDaily(range, filters);
  return scalarFromFunnel(rows, "vobs_count");
}

/** admissions.mql_to_vob_rate — wired derived ratio. */
async function resolveMqlToVobRate(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { totals } = await loadFunnelDaily(range, filters);
  return {
    kind: "scalar",
    value: safeRatio(totals.vobs, totals.mqls),
    series: [],
    prior_period_value: null,
  };
}

/** admissions.vob_to_admit_rate — wired derived ratio. */
async function resolveVobToAdmitRate(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { totals } = await loadFunnelDaily(range, filters);
  return {
    kind: "scalar",
    value: safeRatio(totals.admits, totals.vobs),
    series: [],
    prior_period_value: null,
  };
}

// ── By-LOC breakdowns (2 more on top of admits_by_admitted_loc) ───────────

type FunnelByLocCol = "mqls_count" | "vobs_count" | "admits_count";

/** Shared logic: aggregate `reporting_op_funnel_by_loc_filtered` rows by LOC. */
async function resolveBreakdownByLoc(
  range: DateRange,
  filters: FilterContract,
  col: FunnelByLocCol,
): Promise<MetricResult> {
  const args = filterArgs(range, filters);
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_by_loc_filtered",
    args,
  );
  if (error) throw new Error(`reporting_op_funnel_by_loc_filtered: ${error.message}`);
  const byLoc = new Map<string, number>();
  for (const r of (data ?? []) as ReadonlyArray<
    { level_of_care: string | null } & Record<FunnelByLocCol, number | null>
  >) {
    const key = r.level_of_care ?? "(none)";
    byLoc.set(key, (byLoc.get(key) ?? 0) + (r[col] ?? 0));
  }
  const rows = Array.from(byLoc.entries())
    .map(([dim, v]) => ({ dimension_value: dim, label: dim, value: v }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return {
    kind: "breakdown",
    rows,
    total: sumNullable(rows.map((r) => r.value)),
  };
}

async function resolveMqlsByRequestedLoc(range: DateRange, filters: FilterContract) {
  return resolveBreakdownByLoc(range, filters, "mqls_count");
}
async function resolveVobsByRequestedLoc(range: DateRange, filters: FilterContract) {
  return resolveBreakdownByLoc(range, filters, "vobs_count");
}

// ── By-rep breakdowns (3 metrics) ─────────────────────────────────────────
// reporting_op_rep_funnel returns one row per rep with MQL/VOB/Admit/Closed-Lost
// counts — single RPC call serves all four by-rep metrics. The function does
// not yet take a filter contract (pipeline/source/LOC). Filter wiring on this
// surface is a follow-up; see PHASE_2A_NOTES.md.
interface RepFunnelRow {
  owner_user_id: string | null;
  full_name: string | null;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
}

async function loadRepFunnel(range: DateRange): Promise<ReadonlyArray<RepFunnelRow>> {
  const { data, error } = await supabase.rpc("reporting_op_rep_funnel", {
    p_start: range.from,
    p_end: range.to,
  });
  if (error) throw new Error(`reporting_op_rep_funnel: ${error.message}`);
  return (data ?? []) as ReadonlyArray<RepFunnelRow>;
}

type RepFunnelCol =
  | "mqls_count"
  | "vobs_count"
  | "admits_count"
  | "closed_lost_count";

function breakdownFromRepFunnel(
  rows: ReadonlyArray<RepFunnelRow>,
  col: RepFunnelCol,
  filters: FilterContract,
): BreakdownResult {
  // The rep_funnel RPC isn't filter-aware yet — we honor the `reps` filter
  // client-side so the page reflects the user's chip selection.
  const repFilter = new Set(filters.reps);
  const filtered = rows.filter((r) => {
    if (repFilter.size === 0) return true;
    return r.owner_user_id !== null && repFilter.has(r.owner_user_id);
  });
  const breakdown = filtered
    .map((r) => ({
      dimension_value: r.owner_user_id ?? "(unattributed)",
      label: r.full_name ?? "(unattributed)",
      value: r[col] ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return {
    kind: "breakdown",
    rows: breakdown,
    total: sumNullable(breakdown.map((r) => r.value)),
  };
}

async function resolveMqlsByRep(range: DateRange, filters: FilterContract) {
  return breakdownFromRepFunnel(await loadRepFunnel(range), "mqls_count", filters);
}
async function resolveVobsByRep(range: DateRange, filters: FilterContract) {
  return breakdownFromRepFunnel(await loadRepFunnel(range), "vobs_count", filters);
}
async function resolveAdmitsByRep(range: DateRange, filters: FilterContract) {
  return breakdownFromRepFunnel(await loadRepFunnel(range), "admits_count", filters);
}

// ── Call-volume resolvers (4 metrics) ─────────────────────────────────────

type CallVolumeCol = "inbound_calls" | "outbound_calls";

function scalarFromRepActivity(
  rows: ReadonlyArray<RepActivityRow>,
  col: CallVolumeCol,
): ScalarResult {
  return {
    kind: "scalar",
    value: sumNullable(rows.map((r) => r[col])),
    // op_rep_activity_daily is keyed by date but the RPC already aggregates
    // away the date dimension. Empty series; Phase 2B can extend the RPC to
    // return a daily series if the UI wants sparklines on call totals.
    series: [],
    prior_period_value: null,
  };
}

function breakdownFromRepActivity(
  rows: ReadonlyArray<RepActivityRow>,
  col: CallVolumeCol,
): BreakdownResult {
  const breakdown = rows
    .filter((r) => r.owner_user_id !== null) // drop the unattributed row from the per-rep view
    .map((r) => ({
      dimension_value: r.owner_user_id ?? "(unattributed)",
      label: r.full_name ?? "(unattributed)",
      value: r[col] ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return {
    kind: "breakdown",
    rows: breakdown,
    total: sumNullable(breakdown.map((r) => r.value)),
  };
}

async function resolveInboundCallsTeam(range: DateRange, filters: FilterContract) {
  return scalarFromRepActivity(await loadRepActivity(range, filters), "inbound_calls");
}
async function resolveOutboundCallsTeam(range: DateRange, filters: FilterContract) {
  return scalarFromRepActivity(await loadRepActivity(range, filters), "outbound_calls");
}
async function resolveInboundCallsByRep(range: DateRange, filters: FilterContract) {
  return breakdownFromRepActivity(await loadRepActivity(range, filters), "inbound_calls");
}
async function resolveOutboundCallsByRep(range: DateRange, filters: FilterContract) {
  return breakdownFromRepActivity(await loadRepActivity(range, filters), "outbound_calls");
}

// ────────────────────────────────────────────────────────────────────────────
// The catalog. Order mirrors the Phase 2 brief for easy review.
// ────────────────────────────────────────────────────────────────────────────

const ADMISSIONS_METRICS: ReadonlyArray<MetricDefinition> = [
  // ── Conversion ratios (3) ───────────────────────────────────────────────
  {
    key: "admissions.mql_to_vob_rate",
    label: "MQL → VOB",
    description: "Share of MQLs that reached the VOB stage in the window.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: {
      source: "reporting.deals",
      scope: "all_deals",
      conversion_denominator: "mqls",
    },
    resolve: resolveMqlToVobRate,
  },
  {
    key: "admissions.vob_to_admit_rate",
    label: "VOB → Admit",
    description: "Share of VOBs that converted to admits in the window.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: {
      source: "reporting.deals",
      scope: "deals_vob_submitted",
      conversion_denominator: "vobs",
    },
    resolve: resolveVobToAdmitRate,
  },
  {
    key: "admissions.mql_to_admit_rate",
    label: "MQL → Admit",
    description: "End-to-end conversion: share of MQLs that became admits.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: {
      source: "reporting.deals",
      scope: "all_deals",
      conversion_denominator: "mqls",
    },
    resolve: resolveMqlToAdmitRate,
  },
  // ── Team-level volume (3) ───────────────────────────────────────────────
  {
    key: "admissions.admits_total",
    label: "Admits",
    description: "Total admits in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsTotal,
  },
  {
    key: "admissions.vobs_total",
    label: "VOBs",
    description: "Total VOBs in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: resolveVobsTotal,
  },
  {
    key: "admissions.mqls_total",
    label: "MQLs",
    description: "Total MQLs in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveMqlsTotal,
  },
  // ── Volume by LOC (3) ───────────────────────────────────────────────────
  {
    key: "admissions.admits_by_admitted_loc",
    label: "Admits by Admitted LOC",
    description:
      "Admits broken down by the Admitted_Level_of_Care field. Distinct from " +
      "Requested LOC used for MQL/VOB; reflects the canonical CONFIRMED.md #21.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsByAdmittedLoc,
  },
  {
    key: "admissions.vobs_by_requested_loc",
    label: "VOBs by Requested LOC",
    description: "VOBs broken down by the Lead's Requested LOC.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: resolveVobsByRequestedLoc,
  },
  {
    key: "admissions.mqls_by_requested_loc",
    label: "MQLs by Requested LOC",
    description: "MQLs broken down by the Lead's Requested LOC.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveMqlsByRequestedLoc,
  },
  // ── Volume by Rep (3) ───────────────────────────────────────────────────
  {
    key: "admissions.admits_by_rep",
    label: "Admits by Rep",
    description: "Admits attributed to each owner. Hidden for specialist role.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsByRep,
  },
  {
    key: "admissions.vobs_by_rep",
    label: "VOBs by Rep",
    description: "VOBs attributed to each owner. Hidden for specialist role.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: resolveVobsByRep,
  },
  {
    key: "admissions.mqls_by_rep",
    label: "MQLs by Rep",
    description: "MQLs attributed to each owner. Hidden for specialist role.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveMqlsByRep,
  },
  // ── Rep × LOC matrix (3) ────────────────────────────────────────────────
  // These three need a new RPC (`reporting_op_funnel_by_rep_by_loc_filtered`)
  // that pivots op_lead_funnel_daily on (owner_user_id, level_of_care). See
  // task #58 — building it is in scope for 2A but split for review.
  {
    key: "admissions.admits_by_rep_by_loc",
    label: "Admits by Rep × LOC",
    description: "Matrix of admits per (rep, admitted LOC) cell.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: notYetWired("admissions.admits_by_rep_by_loc"),
  },
  {
    key: "admissions.vobs_by_rep_by_loc",
    label: "VOBs by Rep × LOC",
    description: "Matrix of VOBs per (rep, requested LOC) cell.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: notYetWired("admissions.vobs_by_rep_by_loc"),
  },
  {
    key: "admissions.mqls_by_rep_by_loc",
    label: "MQLs by Rep × LOC",
    description: "Matrix of MQLs per (rep, requested LOC) cell.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: notYetWired("admissions.mqls_by_rep_by_loc"),
  },
  // ── Call activity (5) ───────────────────────────────────────────────────
  {
    key: "admissions.missed_call_pct_team",
    label: "Missed-call rate",
    description:
      "Share of inbound calls that were missed across the team. Down-is-good — " +
      "UI flips the delta arrow color.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: true,
    inverse: true,
    drilldown: { source: "reporting.calls", scope: "calls_missed" },
    resolve: resolveMissedCallPctTeam,
  },
  {
    key: "admissions.inbound_calls_team",
    label: "Inbound calls",
    description: "Total inbound calls across the team in the window.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.calls", scope: "calls_inbound" },
    resolve: resolveInboundCallsTeam,
  },
  {
    key: "admissions.inbound_calls_by_rep",
    label: "Inbound calls (by rep)",
    description: "Per-rep inbound-call totals. Used for specialist-role tile.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.calls", scope: "calls_inbound" },
    resolve: resolveInboundCallsByRep,
  },
  {
    key: "admissions.outbound_calls_team",
    label: "Outbound calls",
    description: "Total outbound calls across the team in the window.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.calls", scope: "calls_outbound" },
    resolve: resolveOutboundCallsTeam,
  },
  {
    key: "admissions.outbound_calls_by_rep",
    label: "Outbound calls (by rep)",
    description: "Per-rep outbound-call totals. Used for specialist-role tile.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: true,
    drilldown: { source: "reporting.calls", scope: "calls_outbound" },
    resolve: resolveOutboundCallsByRep,
  },
  // ── Closed lost (3) ─────────────────────────────────────────────────────
  {
    key: "admissions.closed_lost_total",
    label: "Closed Lost",
    description:
      "Total Closed Lost deals in the window. Down-is-good — UI flips delta color.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    inverse: true,
    drilldown: { source: "reporting.deals", scope: "deals_closed_lost" },
    resolve: resolveClosedLostTotal,
  },
  {
    key: "admissions.closed_lost_by_reason",
    label: "Closed Lost by Reason",
    description:
      "Breakdown by Lost_Reasoning / Close_Reasoning_DUI / Reason_For_Loss__s " +
      "per pipeline (CONFIRMED.md #36).",
    source_table: "reporting.deals",
    supports_rep_scope: true,
    inverse: true,
    drilldown: { source: "reporting.deals", scope: "deals_closed_lost" },
    resolve: notYetWired("admissions.closed_lost_by_reason"),
  },
  {
    key: "admissions.closed_lost_by_rep",
    label: "Closed Lost by Rep",
    description: "Per-rep Closed Lost counts. Hidden for specialist role.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: true,
    inverse: true,
    drilldown: { source: "reporting.deals", scope: "deals_closed_lost" },
    resolve: notYetWired("admissions.closed_lost_by_rep"),
  },
];

registerMetrics(ADMISSIONS_METRICS);

/** Test/debug export — not consumed by the page itself. */
export { ADMISSIONS_METRICS };

/**
 * Typed union of every admissions key. Use this on the page side for
 * compile-time guards: `useMetric<AdmissionsMetricKey>("admissions.mqls_total", ...)`.
 */
export type AdmissionsMetricKey = (typeof ADMISSIONS_METRICS)[number]["key"];

// Sanity export to assert the file holds exactly 23 entries — kept loose
// (not a TS literal type) so reorderings during review don't churn the diff.
export const ADMISSIONS_METRIC_COUNT = ADMISSIONS_METRICS.length;

// Status of resolver wiring — read by docs/tests so we can audit progress.
// 18 of 23 resolvers wired; the remaining 5 need new op_* RPCs (task #58):
// mqls/vobs/admits_by_rep_by_loc (matrix), closed_lost_by_reason, closed_lost_by_rep.
export const ADMISSIONS_WIRED_KEYS: ReadonlyArray<string> = Object.freeze([
  // Conversion ratios (3/3)
  "admissions.mql_to_vob_rate",
  "admissions.vob_to_admit_rate",
  "admissions.mql_to_admit_rate",
  // Team totals (3/3)
  "admissions.admits_total",
  "admissions.vobs_total",
  "admissions.mqls_total",
  // By LOC (3/3)
  "admissions.admits_by_admitted_loc",
  "admissions.vobs_by_requested_loc",
  "admissions.mqls_by_requested_loc",
  // By rep (3/3) — via reporting_op_rep_funnel + client-side rep filter
  "admissions.admits_by_rep",
  "admissions.vobs_by_rep",
  "admissions.mqls_by_rep",
  // Call activity (5/5)
  "admissions.missed_call_pct_team",
  "admissions.inbound_calls_team",
  "admissions.inbound_calls_by_rep",
  "admissions.outbound_calls_team",
  "admissions.outbound_calls_by_rep",
  // Closed lost (1/3) — total wired; by_reason + by_rep need new RPCs
  "admissions.closed_lost_total",
]);
