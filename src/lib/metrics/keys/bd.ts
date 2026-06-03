/**
 * BD (Business Development) dashboard metric catalog — Phase 4.
 *
 * Third consumer of the Phase 2A resolver substrate (Admissions → Executive →
 * BD). Every key is `bd.<snake_case>`. Manager/admin only (the funnel/referral
 * RPCs RAISE for non-managers), so metrics are team-wide — `supports_rep_scope`
 * is false throughout.
 *
 * Scope (decided 2026-06-02): built entirely on EXISTING op_* RPCs — no new
 * migration. Two BD asks from the brief are intentionally out of scope because
 * the warehouse has no data for them yet:
 *   - Account intelligence (top/stuck accounts) — there's no reporting.accounts
 *     table; the legacy /bd/* pages read Zoho-direct.
 *   - True referral-inflow-by-BD-rep — referral inflow is by-CHANNEL on the
 *     substrate (op_referrals_daily), not by-rep. Per-rep BD contribution is
 *     surfaced via meetings/calls (rep_activity, role_derived = bd_rep).
 *
 * Side-effect module — importing it registers every key.
 */

import { supabase } from "@/lib/supabase";

import { REP_ROLE, SOURCE_CATEGORY, TOP_LINE_ADMIT_PIPELINES } from "../definitions";
import {
  priorRange,
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
// RPC argument builders
// ────────────────────────────────────────────────────────────────────────────

/** Funnel-by-source args (p_locs supported). Top-line pipelines by default. */
function sourceArgs(
  range: DateRange,
  filters: FilterContract,
  sourceOverride?: readonly string[],
) {
  return {
    p_start: range.from,
    p_end: range.to,
    p_pipelines:
      filters.pipelines.length > 0
        ? filters.pipelines
        : (TOP_LINE_ADMIT_PIPELINES as readonly string[]),
    p_source_categories:
      sourceOverride ?? (filters.sources.length > 0 ? filters.sources : null),
    p_locs: filters.locs.length > 0 ? filters.locs : null,
    p_owner_user_ids: filters.reps.length > 0 ? filters.reps : null,
  };
}

/** Referrals-family args — no p_locs (op_referrals_daily isn't LOC-keyed). */
function referralArgs(range: DateRange, filters: FilterContract) {
  return {
    p_start: range.from,
    p_end: range.to,
    p_pipelines:
      filters.pipelines.length > 0
        ? filters.pipelines
        : (TOP_LINE_ADMIT_PIPELINES as readonly string[]),
    p_source_categories: filters.sources.length > 0 ? filters.sources : null,
    p_owner_user_ids: filters.reps.length > 0 ? filters.reps : null,
  };
}

const BD_SOURCE = [SOURCE_CATEGORY.BusinessDevelopment] as readonly string[];

function humanizeSourceCategory(sc: string | null): string {
  if (sc == null) return "(none)";
  return sc
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// Referral inflow — op_referrals_daily_filtered
// ────────────────────────────────────────────────────────────────────────────

interface ReferralsDailyRow {
  date: string;
  bd_referrals_in: number;
  digital_referrals_in: number;
  other_referrals_in: number;
  referred_out_closed_count: number;
}

async function loadReferrals(
  range: DateRange,
  filters: FilterContract,
): Promise<ReadonlyArray<ReferralsDailyRow>> {
  const { data, error } = await supabase.rpc(
    "reporting_op_referrals_daily_filtered",
    referralArgs(range, filters),
  );
  if (error) throw new Error(`reporting_op_referrals_daily_filtered: ${error.message}`);
  return (data ?? []) as ReadonlyArray<ReferralsDailyRow>;
}

type ReferralCol = "bd_referrals_in" | "referred_out_closed_count";

/** Scalar over a referrals column, with a MoM prior-period value + sparkline. */
function referralScalar(col: ReferralCol, withMoM: boolean) {
  return async (range: DateRange, filters: FilterContract): Promise<MetricResult> => {
    const [cur, prior] = await Promise.all([
      loadReferrals(range, filters),
      withMoM ? loadReferrals(priorRange(range), filters) : Promise.resolve(null),
    ]);
    const result: ScalarResult = {
      kind: "scalar",
      value: sumNullable(cur.map((r) => r[col])),
      series: cur.map((r) => ({ date: r.date, value: r[col] })),
      prior_period_value: prior ? sumNullable(prior.map((r) => r[col])) : null,
    };
    return result;
  };
}

/** bd.referrals_in_by_channel — BD / Digital / Other inflow split. */
async function resolveReferralsInByChannel(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const rows = await loadReferrals(range, filters);
  const out = [
    { dimension_value: "bd", label: humanizeSourceCategory(SOURCE_CATEGORY.BusinessDevelopment), value: sumNullable(rows.map((r) => r.bd_referrals_in)) },
    { dimension_value: "digital", label: "Digital", value: sumNullable(rows.map((r) => r.digital_referrals_in)) },
    { dimension_value: "other", label: "Other", value: sumNullable(rows.map((r) => r.other_referrals_in)) },
  ].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
}

// ── Refer-out destinations — op_referred_out_breakdown_filtered ────────────
async function resolveReferredOutDestinations(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { data, error } = await supabase.rpc(
    "reporting_op_referred_out_breakdown_filtered",
    referralArgs(range, filters),
  );
  if (error) throw new Error(`reporting_op_referred_out_breakdown_filtered: ${error.message}`);
  const byType = new Map<string, number>();
  for (const r of (data ?? []) as ReadonlyArray<{ refer_out_type: string | null; count: number }>) {
    const key = r.refer_out_type ?? "(unspecified)";
    byType.set(key, (byType.get(key) ?? 0) + (r.count ?? 0));
  }
  const rows = Array.from(byType.entries())
    .map(([dim, v]) => ({ dimension_value: dim, label: dim, value: v }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows, total: sumNullable(rows.map((r) => r.value)) };
}

// ────────────────────────────────────────────────────────────────────────────
// BD-sourced funnel — op_funnel_by_source_filtered (business_development row)
// ────────────────────────────────────────────────────────────────────────────

interface FunnelBySourceRow {
  source_category: string | null;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

type FunnelDimCol = "mqls_count" | "vobs_count" | "admits_count";

async function loadBySource(
  range: DateRange,
  filters: FilterContract,
  sourceOverride?: readonly string[],
): Promise<ReadonlyArray<FunnelBySourceRow>> {
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_by_source_filtered",
    sourceArgs(range, filters, sourceOverride),
  );
  if (error) throw new Error(`reporting_op_funnel_by_source_filtered: ${error.message}`);
  return (data ?? []) as ReadonlyArray<FunnelBySourceRow>;
}

/** BD-sourced scalar (forces source = business_development) with MoM. */
function bdSourceScalar(col: FunnelDimCol) {
  return async (range: DateRange, filters: FilterContract): Promise<MetricResult> => {
    const [cur, prior] = await Promise.all([
      loadBySource(range, filters, BD_SOURCE),
      loadBySource(priorRange(range), filters, BD_SOURCE),
    ]);
    const sum = (rows: ReadonlyArray<FunnelBySourceRow>) => sumNullable(rows.map((r) => r[col]));
    return {
      kind: "scalar",
      value: sum(cur),
      series: [],
      prior_period_value: sum(prior),
    };
  };
}

/** bd.bd_mql_to_admit_rate — BD-sourced end-to-end conversion, with MoM. */
async function resolveBdMqlToAdmitRate(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const [cur, prior] = await Promise.all([
    loadBySource(range, filters, BD_SOURCE),
    loadBySource(priorRange(range), filters, BD_SOURCE),
  ]);
  const ratio = (rows: ReadonlyArray<FunnelBySourceRow>) =>
    safeRatio(sumNullable(rows.map((r) => r.admits_count)), sumNullable(rows.map((r) => r.mqls_count)));
  return { kind: "scalar", value: ratio(cur), series: [], prior_period_value: ratio(prior) };
}

/** bd.admits_by_source — all source categories, so BD's share is visible. */
async function resolveAdmitsBySource(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const rows = await loadBySource(range, filters); // no override — all sources
  const out = rows
    .map((r) => ({
      dimension_value: r.source_category ?? "(none)",
      label: humanizeSourceCategory(r.source_category),
      value: r.admits_count ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
}

// ────────────────────────────────────────────────────────────────────────────
// BD rep activity / meetings — op_rep_activity (role_derived = bd_rep)
// ────────────────────────────────────────────────────────────────────────────

interface RepActivityRow {
  owner_user_id: string | null;
  full_name: string | null;
  role_derived: string | null;
  inbound_calls: number;
  outbound_calls: number;
  missed_calls: number;
  meetings_count: number;
  meetings_by_type: Record<string, number> | null;
}

/** Rep activity, narrowed to BD reps. Honors the `reps` filter via the
 *  _filtered variant; other categorical filters don't apply (calls/meetings
 *  aren't pipeline/source/LOC-keyed). */
async function loadBdRepActivity(
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
  const rows = (data ?? []) as ReadonlyArray<RepActivityRow>;
  return rows.filter((r) => r.role_derived === REP_ROLE.BdRep);
}

/** bd.meetings_total — total BD meetings, with MoM. */
async function resolveMeetingsTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const [cur, prior] = await Promise.all([
    loadBdRepActivity(range, filters),
    loadBdRepActivity(priorRange(range), filters),
  ]);
  return {
    kind: "scalar",
    value: sumNullable(cur.map((r) => r.meetings_count)),
    series: [],
    prior_period_value: sumNullable(prior.map((r) => r.meetings_count)),
  };
}

/** bd.meetings_by_type — aggregate the per-rep meetings_by_type JSONB. */
async function resolveMeetingsByType(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const rows = await loadBdRepActivity(range, filters);
  const byType = new Map<string, number>();
  for (const r of rows) {
    for (const [type, n] of Object.entries(r.meetings_by_type ?? {})) {
      byType.set(type, (byType.get(type) ?? 0) + (Number(n) || 0));
    }
  }
  const out = Array.from(byType.entries())
    .map(([dim, v]) => ({ dimension_value: dim, label: dim, value: v }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
}

/** Per-BD-rep breakdown over a rep-activity column. */
function bdRepBreakdown(col: "meetings_count" | "outbound_calls") {
  return async (range: DateRange, filters: FilterContract): Promise<MetricResult> => {
    const rows = await loadBdRepActivity(range, filters);
    const out: BreakdownResult["rows"] = rows
      .filter((r) => r.owner_user_id !== null)
      .map((r) => ({
        dimension_value: r.owner_user_id as string,
        label: r.full_name ?? "(unattributed)",
        value: r[col] ?? 0,
      }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────────

const BD_METRICS: ReadonlyArray<MetricDefinition> = [
  // ── Referral inflow ──────────────────────────────────────────────────────
  {
    key: "bd.referrals_in_total",
    label: "BD Referrals In",
    description: "Inbound referrals attributed to Business Development, with MoM delta.",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.leads", scope: "leads_all" },
    resolve: referralScalar("bd_referrals_in", true),
  },
  {
    key: "bd.referrals_in_by_channel",
    label: "Referral Inflow by Channel",
    description: "Inbound referrals split across BD / Digital / Other.",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.leads", scope: "leads_all" },
    resolve: resolveReferralsInByChannel,
  },
  // ── BD-sourced funnel ────────────────────────────────────────────────────
  {
    key: "bd.admits_from_bd",
    label: "Admits from BD",
    description: "Admits sourced from Business Development (top-line pipelines), with MoM.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: bdSourceScalar("admits_count"),
  },
  {
    key: "bd.vobs_from_bd",
    label: "VOBs from BD",
    description: "VOBs sourced from Business Development, with MoM.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: bdSourceScalar("vobs_count"),
  },
  {
    key: "bd.mqls_from_bd",
    label: "MQLs from BD",
    description: "MQLs sourced from Business Development, with MoM.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: bdSourceScalar("mqls_count"),
  },
  {
    key: "bd.bd_mql_to_admit_rate",
    label: "BD MQL → Admit",
    description: "End-to-end conversion for BD-sourced leads, with MoM.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals", conversion_denominator: "mqls" },
    resolve: resolveBdMqlToAdmitRate,
  },
  {
    key: "bd.admits_by_source",
    label: "Admits by Source",
    description: "Admits by source category — how BD compares to Digital / Alumni / ZocDoc.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsBySource,
  },
  // ── Wins / refer-out ─────────────────────────────────────────────────────
  {
    key: "bd.referred_out_total",
    label: "Referred Out (Wins)",
    description: "Closed Referred Out Unattached — a Win, not a loss (CONFIRMED.md #1), with MoM.",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_referred_out" },
    resolve: referralScalar("referred_out_closed_count", true),
  },
  {
    key: "bd.referred_out_destinations",
    label: "Refer-out Destinations",
    description: "Where closed refer-outs went, by refer-out type.",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_referred_out" },
    resolve: resolveReferredOutDestinations,
  },
  // ── BD rep activity / meetings ───────────────────────────────────────────
  {
    key: "bd.meetings_total",
    label: "BD Meetings",
    description: "Total meetings logged by BD reps in the window, with MoM.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.meetings", scope: "meetings_all" },
    resolve: resolveMeetingsTotal,
  },
  {
    key: "bd.meetings_by_type",
    label: "Meetings by Type",
    description: "BD meetings broken down by type (Event / In-Service / Drop / Tour / Other).",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.meetings", scope: "meetings_all" },
    resolve: resolveMeetingsByType,
  },
  {
    key: "bd.meetings_by_rep",
    label: "Meetings by BD Rep",
    description: "Meetings per BD rep (role_derived = bd_rep).",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.meetings", scope: "meetings_all" },
    resolve: bdRepBreakdown("meetings_count"),
  },
  {
    key: "bd.calls_by_bd_rep",
    label: "Outbound Calls by BD Rep",
    description: "Outbound calls per BD rep — outreach volume.",
    source_table: "reporting.op_rep_activity_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.calls", scope: "calls_outbound" },
    resolve: bdRepBreakdown("outbound_calls"),
  },
];

registerMetrics(BD_METRICS);

/** Test/debug export. */
export { BD_METRICS };

/** Typed union of every BD key. */
export type BdMetricKey = (typeof BD_METRICS)[number]["key"];

/** Loose count assert. */
export const BD_METRIC_COUNT = BD_METRICS.length;
