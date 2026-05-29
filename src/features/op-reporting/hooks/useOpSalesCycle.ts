// useOpSalesCycle — sales + placement cycle days from the op_*_cycle tables.
//
// Both rollups are computed off `deals.closing_date - deals.lead_created_time`.
// Lead_Created_Time is a Zoho field that's only populated when a workflow
// copies the Lead's Created Time onto the Deal at conversion — see
// OPEN_QUESTIONS #37. Until that workflow ships, both tables are empty.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { SourceCategory, LevelOfCare } from "@/lib/metrics/definitions";

export interface SalesCycleRow {
  date: string;
  source_category: SourceCategory | null;
  level_of_care_admitted: LevelOfCare | null;
  avg_days: number | null;
  p50_days: number | null;
  p90_days: number | null;
  sample_size: number;
}

export interface PlacementCycleRow {
  date: string;
  source_category: SourceCategory | null;
  refer_out_type: string | null;
  avg_days: number | null;
  p50_days: number | null;
  p90_days: number | null;
  sample_size: number;
}

export interface CoverageRow {
  total_deals: number;
  with_lead_created_time: number;
  coverage_share: number | null;
}

export function useOpSalesCycle(range: DateRange) {
  return useQuery({
    queryKey: ["op-sales-cycle", range.from, range.to],
    queryFn: async () => {
      const [sales, placement, coverage] = await Promise.all([
        supabase.rpc("reporting_op_sales_cycle_daily", { p_start: range.from, p_end: range.to }),
        supabase.rpc("reporting_op_placement_cycle_daily", { p_start: range.from, p_end: range.to }),
        supabase.rpc("reporting_op_lead_created_time_coverage"),
      ]);
      if (sales.error) throw new Error(`reporting_op_sales_cycle_daily: ${sales.error.message}`);
      if (placement.error) throw new Error(`reporting_op_placement_cycle_daily: ${placement.error.message}`);
      if (coverage.error) throw new Error(`reporting_op_lead_created_time_coverage: ${coverage.error.message}`);
      return {
        sales: (sales.data ?? []) as SalesCycleRow[],
        placement: (placement.data ?? []) as PlacementCycleRow[],
        coverage: ((coverage.data ?? [{}])[0] ?? null) as CoverageRow | null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
