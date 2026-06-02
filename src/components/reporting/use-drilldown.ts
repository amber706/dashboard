/**
 * useDrilldown — fetch the bounded record list underlying a metric tile.
 *
 * The Phase 2 brief permits drill-downs to read from normalized mirrors
 * (`reporting.deals` / `reporting.leads` / `reporting.calls`) directly,
 * because:
 *   1. Page size is capped at 100 rows.
 *   2. Records need detail (full deal info, not aggregates).
 *   3. RLS is enforced on the mirror — specialists see their slice; managers
 *      see the team.
 *
 * The metric's `drilldown` config (declared on `MetricDefinition`) selects
 * the mirror table + a scope predicate. The FilterContract narrows further.
 *
 * Phase 2B MVP scope: every `reporting.deals`-source drill-down is wired.
 * Calls / meetings / leads sources fall back to an empty result with a
 * `notes` field explaining the gap — wiring those is a follow-up once each
 * destination page is built (calls drill-down comes alive with the Calls
 * dashboard, etc.).
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { getMetric } from "@/lib/metrics/resolver";
import { TOP_LINE_ADMIT_PIPELINES } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

/** Page size cap for drill-downs per the Phase 2 brief. */
export const DRILLDOWN_PAGE_SIZE = 100;

/**
 * Deal scopes with a real predicate in `fetchDealsDrilldown`. A metric whose
 * `drilldown.scope` is a deals source but NOT in this set returns an honest
 * "coming soon" note rather than silently falling through the predicate
 * switch and returning unfiltered deals. (Phase 3's `deals_referred_out`
 * lives here until its predicate is wired — see PHASE_3_SIGNOFF.md.)
 */
const WIRED_DEAL_SCOPES: ReadonlySet<string> = new Set([
  "all_deals",
  "deals_admitted",
  "deals_vob_submitted",
  "deals_closed_lost",
]);

/** Uniform record shape rendered by `DrilldownModal`. */
export interface DrilldownRow {
  [key: string]: string | number | boolean | null;
}

/**
 * Stable cache-key serializer. Mirrors `use-metric.ts` so both hooks share
 * cached responses when the inputs match.
 */
function drilldownCacheKey(range: DateRange, filters: FilterContract): string {
  return [
    range.from,
    range.to,
    filters.pipelines.join(","),
    filters.sources.join(","),
    filters.locs.join(","),
    filters.reps.join(","),
  ].join("|");
}

/**
 * Fetch up to `DRILLDOWN_PAGE_SIZE` deals matching the metric's drill-down
 * scope and the active filters. Common deal columns are returned so the
 * modal can render a uniform table.
 */
async function fetchDealsDrilldown(
  scope:
    | "all_deals"
    | "deals_admitted"
    | "deals_vob_submitted"
    | "deals_closed_lost",
  range: DateRange,
  filters: FilterContract,
): Promise<DrilldownRow[]> {
  let q = supabase
    .from("deals")
    .select(
      "source_deal_id, deal_name, owner_user_id, pipeline, stage_category, " +
        "source_category, level_of_care_requested, admitted_level_of_care, " +
        "vob_submitted, vob_submitted_date, admit_date, closing_date, " +
        "closed_lost_reason, refer_out_type, created_at",
      { count: "exact" },
    )
    .limit(DRILLDOWN_PAGE_SIZE);

  // Date attribution + scope predicate
  switch (scope) {
    case "all_deals":
      q = q.gte("created_at", `${range.from}T00:00:00Z`)
        .lte("created_at", `${range.to}T23:59:59Z`)
        .order("created_at", { ascending: false });
      break;
    case "deals_admitted":
      // Admit predicate matches the resolver: admit_date OR
      // stage_category='closed_won_admitted'. Date attribution =
      // COALESCE(admit_date, closing_date) but we can't easily express
      // COALESCE in PostgREST; we approximate with two OR'd date ranges.
      q = q
        .eq("stage_category", "closed_won_admitted")
        .or(
          `admit_date.gte.${range.from},admit_date.lte.${range.to},and(admit_date.is.null,closing_date.gte.${range.from},closing_date.lte.${range.to})`,
        )
        .order("admit_date", { ascending: false, nullsFirst: false });
      break;
    case "deals_vob_submitted":
      // VOB predicate: vob_submitted=true OR vob_submitted_date NOT NULL.
      // Date attribution via vob_submitted_date when present.
      q = q
        .or("vob_submitted.eq.true,vob_submitted_date.not.is.null")
        .gte("vob_submitted_date", range.from)
        .lte("vob_submitted_date", range.to)
        .order("vob_submitted_date", { ascending: false });
      break;
    case "deals_closed_lost":
      q = q
        .eq("stage_category", "closed_lost")
        .gte("closing_date", range.from)
        .lte("closing_date", range.to)
        .order("closing_date", { ascending: false });
      break;
  }

  // Categorical filters — pipeline defaults to top-line per the brief.
  const pipelines =
    filters.pipelines.length > 0
      ? filters.pipelines
      : (TOP_LINE_ADMIT_PIPELINES as readonly string[]);
  q = q.in("pipeline", pipelines as string[]);
  if (filters.sources.length > 0) q = q.in("source_category", filters.sources);
  if (filters.locs.length > 0) q = q.in("level_of_care_requested", filters.locs);
  if (filters.reps.length > 0) q = q.in("owner_user_id", filters.reps);

  const { data, error } = await q;
  if (error) throw new Error(`drilldown(deals): ${error.message}`);
  // PostgREST returns columns as untyped — runtime shape matches DrilldownRow
  // (string/number/boolean/null cells) because we only SELECT scalar cols.
  return (data ?? []) as unknown as DrilldownRow[];
}

/**
 * Fetch up to `DRILLDOWN_PAGE_SIZE` calls matching the metric's drill-down
 * scope. The reps filter applies; pipeline / source / LOC are intentional
 * no-ops here — `reporting.calls` rows aren't tied to deals at the cached
 * layer (calls + meetings ETL is independent of the deal pipeline).
 *
 * Joined to `user_identity` so the drill-down table can show the rep's
 * name alongside the raw `owner_user_id` UUID.
 */
async function fetchCallsDrilldown(
  scope: "calls_inbound" | "calls_outbound" | "calls_missed",
  range: DateRange,
  filters: FilterContract,
): Promise<DrilldownRow[]> {
  let q = supabase
    .from("calls")
    .select(
      "source_call_id, owner_user_id, direction, duration_sec, occurred_at, missed",
    )
    .gte("occurred_at", `${range.from}T00:00:00Z`)
    .lte("occurred_at", `${range.to}T23:59:59Z`)
    .order("occurred_at", { ascending: false })
    .limit(DRILLDOWN_PAGE_SIZE);

  switch (scope) {
    case "calls_inbound":
      q = q.eq("direction", "inbound");
      break;
    case "calls_outbound":
      q = q.eq("direction", "outbound");
      break;
    case "calls_missed":
      // `missed` is a boolean on every call row; calls_missed surfaces ONLY
      // the ones flagged true. The headline "missed-call rate" metric is
      // missed/inbound, but the drill-down shows the missed records
      // specifically — most useful for triage.
      q = q.eq("missed", true);
      break;
  }

  if (filters.reps.length > 0) {
    q = q.in("owner_user_id", filters.reps);
  }

  const { data, error } = await q;
  if (error) throw new Error(`drilldown(calls): ${error.message}`);
  return (data ?? []) as unknown as DrilldownRow[];
}

/**
 * Drill-down loader for a metric. Returns the bounded record list and
 * surfaces whether the metric's scope is wired yet (some non-deals scopes
 * — calls / meetings — return an empty list with a `notes` field).
 */
export function useDrilldown(
  metric: string | null,
  range: DateRange,
  filters: FilterContract,
  enabled = true,
) {
  return useQuery<{ rows: DrilldownRow[]; notes: string | null }, Error>({
    queryKey: ["drilldown", metric, drilldownCacheKey(range, filters)],
    enabled: enabled && !!metric,
    queryFn: async () => {
      const def = getMetric(metric!);
      const { source, scope } = def.drilldown;
      if (source === "reporting.deals") {
        if (!WIRED_DEAL_SCOPES.has(scope)) {
          return {
            rows: [],
            notes: `Drill-down for the "${scope}" scope lands in a follow-up.`,
          };
        }
        const rows = await fetchDealsDrilldown(
          scope as Parameters<typeof fetchDealsDrilldown>[0],
          range,
          filters,
        );
        return { rows, notes: null };
      }
      if (source === "reporting.calls") {
        const rows = await fetchCallsDrilldown(
          scope as Parameters<typeof fetchCallsDrilldown>[0],
          range,
          filters,
        );
        return { rows, notes: null };
      }
      return {
        rows: [],
        notes: `Drill-down for ${source} records lands with the matching dashboard page.`,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
