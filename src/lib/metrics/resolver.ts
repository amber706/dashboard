/**
 * Metric resolver substrate — Phase 2A.
 *
 * Bridges the typed `metric_key` catalog in `./keys/*` to the per-dashboard
 * UI surface. Every dashboard page (Admissions first; Executive / BD /
 * Marketing to follow) reads metrics exclusively through `useMetric(key)` →
 * resolver.resolve(filters) → an op_* RPC.
 *
 * Why a registry + resolver instead of per-metric hooks:
 *   - One TS file per dashboard page (keys/admissions.ts, keys/executive.ts)
 *     lists every metric that page exposes, with metadata the UI consumes
 *     for chart labels, drill-down links, role gating, etc.
 *   - One `useMetric` call from the page; no `useOpFunnel + useOpFunnelByLoc
 *     + useOpRepActivity + useOpReferrals + ...` shotgun spread.
 *   - Future dashboards just register another keys/<page>.ts and import the
 *     same shared components.
 *
 * Drill-downs are the ONE exception to the "frontend reads only from op_*
 * cached tables" rule (see the Phase 2 architectural notes). Drill-downs
 * read from the normalized mirrors with RLS enforced because they need
 * record-level detail bounded at a page size of 100. Every drill-down
 * resolver MUST set `drilldown.scope` so the auditor knows.
 *
 * The substrate is intentionally light — heavy work stays in the per-key
 * resolve functions, where the SQL shape and op_* table choice are
 * specific to each metric.
 */

import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

// ────────────────────────────────────────────────────────────────────────────
// Result shapes — every resolve() returns one of these, picked by metric kind
// ────────────────────────────────────────────────────────────────────────────

/** A scalar metric with optional sparkline series + prior-period comparison. */
export interface ScalarResult {
  kind: "scalar";
  /** Headline value over the requested window. `null` for ratios with zero denominator. */
  value: number | null;
  /** Optional daily series for sparklines. Empty array if unavailable. */
  series: ReadonlyArray<{ date: string; value: number | null }>;
  /** Optional prior-period total for delta arrows. `null` if not computed. */
  prior_period_value: number | null;
}

/** A breakdown of a metric along one categorical dimension (LOC, rep, source, etc.). */
export interface BreakdownResult {
  kind: "breakdown";
  /** One row per dimension value. `null` value rows survive — the UI styles them. */
  rows: ReadonlyArray<{ dimension_value: string; label: string; value: number | null }>;
  /** Sum of `rows[].value` (ignoring nulls). Useful for percentage labels. */
  total: number;
}

/** A matrix breakdown (rep × LOC, source × LOC, etc.). */
export interface MatrixResult {
  kind: "matrix";
  rows: ReadonlyArray<{ row_dim_value: string; row_label: string }>;
  cols: ReadonlyArray<{ col_dim_value: string; col_label: string }>;
  cells: ReadonlyArray<{ row_dim_value: string; col_dim_value: string; value: number | null }>;
}

export type MetricResult = ScalarResult | BreakdownResult | MatrixResult;

// ────────────────────────────────────────────────────────────────────────────
// Definition shape — every keys/<page>.ts entry conforms to this
// ────────────────────────────────────────────────────────────────────────────

/**
 * Drill-down configuration. Tells the UI how to fetch the underlying records
 * when a metric tile is clicked. The brief permits drill-downs to read from
 * normalized mirrors (reporting.deals, reporting.leads, reporting.calls)
 * because they need record-level detail bounded at a page size of 100.
 */
export interface DrilldownConfig {
  /** Which normalized mirror table holds the underlying records. */
  source:
    | "reporting.deals"
    | "reporting.leads"
    | "reporting.calls"
    | "reporting.meetings";
  /** Scope hint for the drill-down query — translated to SQL by the page. */
  scope:
    | "all_deals"
    | "deals_admitted"
    | "deals_vob_submitted"
    | "deals_closed_lost"
    | "deals_referred_out"
    | "leads_all"
    | "calls_inbound"
    | "calls_outbound"
    | "calls_missed";
  /**
   * Conversion-rate drill-downs return the denominator set plus a `converted`
   * column. The brief requires this so users can audit who didn't convert.
   */
  conversion_denominator?: "mqls" | "vobs";
}

export interface MetricDefinition {
  /** The typed key — `<page>.<snake_case>` per the Phase 2 brief. */
  readonly key: string;
  /** Display label for KPI tiles + chart titles. */
  readonly label: string;
  /** One-line description for tooltips and the admin metric catalog. */
  readonly description: string;
  /** The op_* table this metric ultimately reads from. Documentation; not enforced at runtime. */
  readonly source_table: string;
  /**
   * Whether RLS scopes the underlying op_* / mirror data by `owner_user_id`.
   * The UI uses this to switch copy between "Your X" (specialist) and "Team X"
   * (manager / admin). RLS is enforced server-side regardless.
   */
  readonly supports_rep_scope: boolean;
  /**
   * `true` for KPI tiles where "down is good" (missed-call rate, closed-lost,
   * sales-cycle days). The UI uses this to flip the delta arrow color.
   */
  readonly inverse?: boolean;
  /** Drill-down config. Required for every metric tile per the Phase 2 brief. */
  readonly drilldown: DrilldownConfig;
  /**
   * The actual resolver. Called by `useMetric`. Implementations MUST:
   *   - Honor the DateRange (window) and FilterContract (pipeline/source/LOC/reps)
   *   - Return `null` for ratios with zero denominator (NOT 0, NOT NaN)
   *   - NOT throw on empty data — return zero-row results instead
   *
   * The window and the categorical filters are intentionally separate
   * arguments to match the existing op-reporting hook signatures and to
   * keep TanStack Query keys simple to compose.
   */
  resolve(range: DateRange, filters: FilterContract): Promise<MetricResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, MetricDefinition>();

/** Register a batch of metric definitions. Called once per keys/<page>.ts module. */
export function registerMetrics(defs: ReadonlyArray<MetricDefinition>): void {
  for (const def of defs) {
    if (REGISTRY.has(def.key)) {
      throw new Error(`metric key collision: ${def.key} already registered`);
    }
    REGISTRY.set(def.key, def);
  }
}

/** Look up a metric definition. Throws if the key isn't registered. */
export function getMetric(key: string): MetricDefinition {
  const def = REGISTRY.get(key);
  if (!def) {
    throw new Error(
      `unknown metric key: ${key}. ` +
        `Check that the keys/<page>.ts module is imported at app startup.`,
    );
  }
  return def;
}

/** Test/debugging helper — every key currently in the registry. */
export function _listRegisteredKeys(): readonly string[] {
  return Array.from(REGISTRY.keys()).sort();
}

/** Test helper — clear the registry. Production code should never call this. */
export function _resetRegistry(): void {
  REGISTRY.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// Numeric helpers used by per-metric resolvers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Safe ratio — returns `null` (not 0, not NaN) when the denominator is zero.
 * The Phase 2 brief explicitly requires this so conversion-rate KPIs render
 * as "—" rather than misleading "0.0%" on empty windows.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Sum a sequence ignoring null/undefined entries. */
export function sumNullable(values: ReadonlyArray<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/**
 * The immediately-preceding window of equal length, for month-over-month
 * delta arrows. A 31-day range ending 2026-05-31 returns the 31 days ending
 * 2026-04-30 (the day before `from`). Both bounds are inclusive ISO dates.
 *
 * The Executive page uses this so each top-line KPI can populate
 * `prior_period_value` with a second RPC call over the prior window — the
 * Phase 2B Admissions resolvers left that null. Date math runs in UTC to
 * avoid timezone drift on the date-only strings.
 */
export function priorRange(range: DateRange): DateRange {
  const MS_PER_DAY = 86_400_000;
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  const lengthDays = Math.round((to - from) / MS_PER_DAY) + 1; // inclusive
  const priorTo = from - MS_PER_DAY;
  const priorFrom = priorTo - (lengthDays - 1) * MS_PER_DAY;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(priorFrom), to: iso(priorTo) };
}
