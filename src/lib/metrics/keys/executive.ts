/**
 * Executive dashboard metric catalog — Phase 3.
 *
 * The second consumer of the Phase 2A resolver substrate (Admissions was the
 * first — see keys/admissions.ts). Every key is `executive.<snake_case>` per
 * the Phase 2 brief; each entry conforms to `MetricDefinition` so the page
 * reads it through `useMetric(key)`.
 *
 * Audience: Amber + leadership. The page is manager/admin only (every
 * breakdown RPC below RAISEs for non-managers via reporting.is_manager_or_admin),
 * so these metrics are team-wide — `supports_rep_scope` is false throughout.
 *
 * Two Phase-3 capabilities this catalog adds on top of the Admissions set:
 *   1. Month-over-month deltas — the four top-line KPIs populate
 *      `prior_period_value` via a second RPC call over `priorRange(range)`,
 *      so KPICard renders real MoM arrows. (Admissions left this null.)
 *   2. A 3-way channel split (Business Development / Digital / ZocDoc). The
 *      taxonomy has exactly three source categories today — Alumni is a
 *      Marketing-page future, not a current bucket (definitions.ts).
 *
 * IMPORTANT: side-effect module — importing it registers every key. The page
 * (and its tests) MUST import this file so `getMetric()` lookups succeed.
 */

import { supabase } from "@/lib/supabase";

import { RAW_PIPELINE_STRINGS, TOP_LINE_ADMIT_PIPELINES } from "../definitions";
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
// RPC argument builders — each filtered RPC has a slightly different signature
// (PostgREST matches by the exact set of named params), so they don't share
// one helper. See migration 175 for the canonical signatures.
// ────────────────────────────────────────────────────────────────────────────

/** Shared categorical filters present on every RPC. */
function categoricalArgs(filters: FilterContract) {
  return {
    p_source_categories: filters.sources.length > 0 ? filters.sources : null,
    p_owner_user_ids: filters.reps.length > 0 ? filters.reps : null,
  };
}

/**
 * Funnel-family args (funnel_daily / by_pipeline / by_source).
 * `pipelineDefault` decides what an empty pipeline filter means:
 *   - "top_line": headline KPIs + channel split restrict to the three
 *     top-line Admit pipelines for comparability with the Admissions page.
 *   - "all": the pipeline-split chart shows ALL five pipelines (DUI/DV
 *     included) — that breakdown's whole purpose is the full picture.
 */
function funnelArgs(
  range: DateRange,
  filters: FilterContract,
  pipelineDefault: "top_line" | "all",
) {
  const p_pipelines =
    filters.pipelines.length > 0
      ? filters.pipelines
      : pipelineDefault === "top_line"
        ? (TOP_LINE_ADMIT_PIPELINES as readonly string[])
        : null;
  return {
    p_start: range.from,
    p_end: range.to,
    p_pipelines,
    ...categoricalArgs(filters),
    p_locs: filters.locs.length > 0 ? filters.locs : null,
  };
}

/** Referrals-family args — no `p_locs` (op_referrals_daily isn't LOC-keyed). */
function referralArgs(
  range: DateRange,
  filters: FilterContract,
  pipelineDefault: "top_line" | "all",
) {
  const p_pipelines =
    filters.pipelines.length > 0
      ? filters.pipelines
      : pipelineDefault === "top_line"
        ? (TOP_LINE_ADMIT_PIPELINES as readonly string[])
        : null;
  return {
    p_start: range.from,
    p_end: range.to,
    p_pipelines,
    ...categoricalArgs(filters),
  };
}

/** Payer-mix args — no `p_pipelines` (payer mix is lead-side, pre-pipeline). */
function payerMixArgs(range: DateRange, filters: FilterContract) {
  return {
    p_start: range.from,
    p_end: range.to,
    ...categoricalArgs(filters),
    p_locs: filters.locs.length > 0 ? filters.locs : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Display labels — never inline a forbidden taxonomy literal (CI guard). We
// import RAW_PIPELINE_STRINGS for pipelines and humanize the source-category
// enum at runtime so no normalized literal appears in this file.
// ────────────────────────────────────────────────────────────────────────────

function pipelineLabel(canonical: string | null): string {
  if (canonical == null) return "(unassigned)";
  return RAW_PIPELINE_STRINGS[canonical as keyof typeof RAW_PIPELINE_STRINGS] ?? canonical;
}

function channelLabel(canonical: string | null): string {
  if (canonical == null) return "(none)";
  return canonical
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// Funnel-daily loader — top-line totals + daily series, shared by the four
// top-line KPIs and the conversion funnel.
// ────────────────────────────────────────────────────────────────────────────

interface FunnelDailyRow {
  date: string;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
}

type FunnelTotalKey = "leads" | "mqls" | "vobs" | "admits";
const TOTAL_TO_COLUMN: Record<FunnelTotalKey, keyof FunnelDailyRow> = {
  leads: "leads_count",
  mqls: "mqls_count",
  vobs: "vobs_count",
  admits: "admits_count",
};

async function loadFunnelDaily(
  range: DateRange,
  filters: FilterContract,
): Promise<{
  rows: ReadonlyArray<FunnelDailyRow>;
  totals: Record<FunnelTotalKey, number>;
}> {
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_daily_filtered",
    funnelArgs(range, filters, "top_line"),
  );
  if (error) throw new Error(`reporting_op_funnel_daily_filtered: ${error.message}`);
  const rows = (data ?? []) as ReadonlyArray<FunnelDailyRow>;
  return {
    rows,
    totals: {
      leads: sumNullable(rows.map((r) => r.leads_count)),
      mqls: sumNullable(rows.map((r) => r.mqls_count)),
      vobs: sumNullable(rows.map((r) => r.vobs_count)),
      admits: sumNullable(rows.map((r) => r.admits_count)),
    },
  };
}

/** Top-line scalar with a daily sparkline AND a month-over-month prior value. */
function topLineScalarResolver(total: FunnelTotalKey) {
  return async (range: DateRange, filters: FilterContract): Promise<MetricResult> => {
    const col = TOTAL_TO_COLUMN[total];
    const [current, prior] = await Promise.all([
      loadFunnelDaily(range, filters),
      loadFunnelDaily(priorRange(range), filters),
    ]);
    const result: ScalarResult = {
      kind: "scalar",
      value: current.totals[total],
      series: current.rows.map((r) => ({ date: r.date, value: r[col] as number })),
      prior_period_value: prior.totals[total],
    };
    return result;
  };
}

/** End-to-end conversion ratio with a MoM prior ratio. */
async function resolveMqlToAdmitRate(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const [current, prior] = await Promise.all([
    loadFunnelDaily(range, filters),
    loadFunnelDaily(priorRange(range), filters),
  ]);
  return {
    kind: "scalar",
    value: safeRatio(current.totals.admits, current.totals.mqls),
    series: [], // per-day ratios are noisy — no sparkline (matches Admissions).
    prior_period_value: safeRatio(prior.totals.admits, prior.totals.mqls),
  };
}

/**
 * Conversion funnel as an ordered breakdown: Leads → MQLs → VOBs → Admits.
 * BarChart renders rows in resolver order, and the funnel is monotonically
 * decreasing, so the bars read left-to-right as the funnel.
 */
async function resolveConversionFunnel(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { totals } = await loadFunnelDaily(range, filters);
  const rows = [
    { dimension_value: "leads", label: "Leads", value: totals.leads },
    { dimension_value: "mqls", label: "MQLs", value: totals.mqls },
    { dimension_value: "vobs", label: "VOBs", value: totals.vobs },
    { dimension_value: "admits", label: "Admits", value: totals.admits },
  ];
  return { kind: "breakdown", rows, total: totals.leads };
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline split — funnel_by_pipeline_filtered, ALL pipelines by default.
// ────────────────────────────────────────────────────────────────────────────

interface FunnelByDimRow {
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}
type FunnelByPipelineRow = FunnelByDimRow & { pipeline: string | null };
type FunnelBySourceRow = FunnelByDimRow & { source_category: string | null };

type FunnelDimCol = "mqls_count" | "vobs_count" | "admits_count";

async function loadByPipeline(
  range: DateRange,
  filters: FilterContract,
): Promise<ReadonlyArray<FunnelByPipelineRow>> {
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_by_pipeline_filtered",
    funnelArgs(range, filters, "all"),
  );
  if (error) throw new Error(`reporting_op_funnel_by_pipeline_filtered: ${error.message}`);
  return (data ?? []) as ReadonlyArray<FunnelByPipelineRow>;
}

function breakdownByPipeline(
  rows: ReadonlyArray<FunnelByPipelineRow>,
  col: FunnelDimCol,
): BreakdownResult {
  const out = rows
    .map((r) => ({
      dimension_value: r.pipeline ?? "(unassigned)",
      label: pipelineLabel(r.pipeline),
      value: r[col] ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
}

async function resolveAdmitsByPipeline(range: DateRange, filters: FilterContract) {
  return breakdownByPipeline(await loadByPipeline(range, filters), "admits_count");
}
async function resolveVobsByPipeline(range: DateRange, filters: FilterContract) {
  return breakdownByPipeline(await loadByPipeline(range, filters), "vobs_count");
}
async function resolveMqlsByPipeline(range: DateRange, filters: FilterContract) {
  return breakdownByPipeline(await loadByPipeline(range, filters), "mqls_count");
}

// ────────────────────────────────────────────────────────────────────────────
// Channel split — funnel_by_source_filtered (BD / Digital / ZocDoc).
// ────────────────────────────────────────────────────────────────────────────

async function loadBySource(
  range: DateRange,
  filters: FilterContract,
): Promise<ReadonlyArray<FunnelBySourceRow>> {
  const { data, error } = await supabase.rpc(
    "reporting_op_funnel_by_source_filtered",
    funnelArgs(range, filters, "top_line"),
  );
  if (error) throw new Error(`reporting_op_funnel_by_source_filtered: ${error.message}`);
  return (data ?? []) as ReadonlyArray<FunnelBySourceRow>;
}

function breakdownBySource(
  rows: ReadonlyArray<FunnelBySourceRow>,
  col: FunnelDimCol,
): BreakdownResult {
  const out = rows
    .map((r) => ({
      dimension_value: r.source_category ?? "(none)",
      label: channelLabel(r.source_category),
      value: r[col] ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows: out, total: sumNullable(out.map((r) => r.value)) };
}

async function resolveAdmitsByChannel(range: DateRange, filters: FilterContract) {
  return breakdownBySource(await loadBySource(range, filters), "admits_count");
}
async function resolveMqlsByChannel(range: DateRange, filters: FilterContract) {
  return breakdownBySource(await loadBySource(range, filters), "mqls_count");
}

// ────────────────────────────────────────────────────────────────────────────
// Payer mix — payer_mix_filtered. Buckets come back labeled from the RPC.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display-only relabel of the RPC's residual bucket. `Unclassified` is leads
 * with neither a captured Insurance Type nor a payer-bearing Lead Score (★3–5);
 * per CONFIRMED.md #24 they're left unclassified by design and are
 * overwhelmingly early-funnel leads whose payer is confirmed later at VOB
 * (investigated 2026-06-02 — not an ETL gap; insurance simply isn't captured at
 * lead creation for these). "Unclassified" reads as a bug to leadership, so we
 * rename the wedge for display. We remap `label` only — `dimension_value` keeps
 * the raw RPC bucket so any drilldown keyed on it is unaffected.
 */
const PAYER_BUCKET_DISPLAY_LABELS: Record<string, string> = {
  Unclassified: "Payer Pending",
};

async function resolvePayerMix(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { data, error } = await supabase.rpc(
    "reporting_op_payer_mix_filtered",
    payerMixArgs(range, filters),
  );
  if (error) throw new Error(`reporting_op_payer_mix_filtered: ${error.message}`);
  const rows = ((data ?? []) as ReadonlyArray<{ bucket: string; count: number }>)
    .map((r) => ({
      dimension_value: r.bucket,
      label: PAYER_BUCKET_DISPLAY_LABELS[r.bucket] ?? r.bucket,
      value: r.count ?? 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { kind: "breakdown", rows, total: sumNullable(rows.map((r) => r.value)) };
}

// ────────────────────────────────────────────────────────────────────────────
// Wins / Refer-out — Referred Out Unattached is a Win (CONFIRMED.md #1).
// ────────────────────────────────────────────────────────────────────────────

interface ReferralsDailyRow {
  date: string;
  bd_referrals_in: number;
  digital_referrals_in: number;
  other_referrals_in: number;
  referred_out_closed_count: number;
}

/** Total closed refer-outs with a daily sparkline. */
async function resolveReferredOutTotal(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { data, error } = await supabase.rpc(
    "reporting_op_referrals_daily_filtered",
    referralArgs(range, filters, "top_line"),
  );
  if (error) throw new Error(`reporting_op_referrals_daily_filtered: ${error.message}`);
  const rows = (data ?? []) as ReadonlyArray<ReferralsDailyRow>;
  return {
    kind: "scalar",
    value: sumNullable(rows.map((r) => r.referred_out_closed_count)),
    series: rows.map((r) => ({ date: r.date, value: r.referred_out_closed_count })),
    prior_period_value: null, // count of Wins; MoM not requested for this tile.
  };
}

/** Refer-out destinations breakdown by refer_out_type. */
async function resolveReferredOutDestinations(
  range: DateRange,
  filters: FilterContract,
): Promise<MetricResult> {
  const { data, error } = await supabase.rpc(
    "reporting_op_referred_out_breakdown_filtered",
    referralArgs(range, filters, "top_line"),
  );
  if (error) throw new Error(`reporting_op_referred_out_breakdown_filtered: ${error.message}`);
  // The RPC returns one row per (refer_out_type, pipeline); aggregate to type.
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
// The catalog. Order mirrors the page layout for easy review.
// ────────────────────────────────────────────────────────────────────────────

const EXECUTIVE_METRICS: ReadonlyArray<MetricDefinition> = [
  // ── Top-line KPIs (4) — with month-over-month deltas ─────────────────────
  {
    key: "executive.admits_total",
    label: "Admits",
    description: "Total admits in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: topLineScalarResolver("admits"),
  },
  {
    key: "executive.vobs_total",
    label: "VOBs",
    description: "Total VOBs in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: topLineScalarResolver("vobs"),
  },
  {
    key: "executive.mqls_total",
    label: "MQLs",
    description: "Total MQLs in the window. Top-line pipelines only by default.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: topLineScalarResolver("mqls"),
  },
  {
    key: "executive.mql_to_admit_rate",
    label: "MQL → Admit",
    description: "End-to-end conversion: share of MQLs that became admits.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: {
      source: "reporting.deals",
      scope: "all_deals",
      conversion_denominator: "mqls",
    },
    resolve: resolveMqlToAdmitRate,
  },
  // ── Conversion funnel (1) ────────────────────────────────────────────────
  {
    key: "executive.conversion_funnel",
    label: "Conversion funnel",
    description: "Leads → MQL → VOB → Admit counts over the window.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveConversionFunnel,
  },
  // ── Pipeline split (3) — all five pipelines ──────────────────────────────
  {
    key: "executive.admits_by_pipeline",
    label: "Admits by Pipeline",
    description: "Admits split across all pipelines (DUI/DV report on their own dimensions).",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsByPipeline,
  },
  {
    key: "executive.vobs_by_pipeline",
    label: "VOBs by Pipeline",
    description: "VOBs split across all pipelines.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_vob_submitted" },
    resolve: resolveVobsByPipeline,
  },
  {
    key: "executive.mqls_by_pipeline",
    label: "MQLs by Pipeline",
    description: "MQLs split across all pipelines.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveMqlsByPipeline,
  },
  // ── Channel split (2) — BD / Digital / ZocDoc ────────────────────────────
  {
    key: "executive.admits_by_channel",
    label: "Admits by Channel",
    description: "Admits by source category: Business Development, Digital, ZocDoc.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_admitted" },
    resolve: resolveAdmitsByChannel,
  },
  {
    key: "executive.mqls_by_channel",
    label: "MQLs by Channel",
    description: "MQLs by source category: Business Development, Digital, ZocDoc.",
    source_table: "reporting.op_lead_funnel_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "all_deals" },
    resolve: resolveMqlsByChannel,
  },
  // ── Payer mix (1) ────────────────────────────────────────────────────────
  {
    key: "executive.payer_mix",
    label: "Payer Mix",
    description:
      "Lead distribution across payer buckets (AHCCCS / Commercial / Other / DUI / DV).",
    source_table: "reporting.leads",
    supports_rep_scope: false,
    drilldown: { source: "reporting.leads", scope: "leads_all" },
    resolve: resolvePayerMix,
  },
  // ── Wins / Refer-out (2) ─────────────────────────────────────────────────
  {
    key: "executive.referred_out_total",
    label: "Referred Out (Wins)",
    description:
      "Closed Referred Out Unattached — counted as a Win, not a loss (CONFIRMED.md #1).",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_referred_out" },
    resolve: resolveReferredOutTotal,
  },
  {
    key: "executive.referred_out_destinations",
    label: "Refer-out Destinations",
    description: "Where closed refer-outs went, by refer-out type.",
    source_table: "reporting.op_referrals_daily",
    supports_rep_scope: false,
    drilldown: { source: "reporting.deals", scope: "deals_referred_out" },
    resolve: resolveReferredOutDestinations,
  },
];

registerMetrics(EXECUTIVE_METRICS);

/** Test/debug export — not consumed by the page itself. */
export { EXECUTIVE_METRICS };

/** Typed union of every executive key for compile-time guards on the page. */
export type ExecutiveMetricKey = (typeof EXECUTIVE_METRICS)[number]["key"];

/** Loose count assert — kept non-literal so reorderings don't churn the diff. */
export const EXECUTIVE_METRIC_COUNT = EXECUTIVE_METRICS.length;
