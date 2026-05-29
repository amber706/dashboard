// useOpFunnel — reads the cached daily funnel rollup from reporting.op_*.
//
// Backed by `public.reporting_op_funnel_daily(p_start, p_end)`, the
// manager/admin-gated RPC added in migration 162. The view we present in
// the UI sums across all dimensions per day; per-pipeline / per-rep slicing
// gets layered in via additional hooks as the dashboard grows.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

export interface OpFunnelDailyRow {
  date: string; // YYYY-MM-DD
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

export interface OpFunnelTotals {
  leads: number;
  mqls: number;
  vobs: number;
  admits: number;
  closed_lost: number;
  referred_out: number;
  /** MQL → Admit ratio across the window (null when zero MQLs). */
  mql_to_admit: number | null;
  /** VOB → Admit ratio (null when zero VOBs). */
  vob_to_admit: number | null;
}

export interface OpFunnelData {
  rows: OpFunnelDailyRow[];
  totals: OpFunnelTotals;
}

function deriveTotals(rows: OpFunnelDailyRow[]): OpFunnelTotals {
  const sum = (k: keyof OpFunnelDailyRow) =>
    rows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0);
  const leads = sum("leads_count");
  const mqls = sum("mqls_count");
  const vobs = sum("vobs_count");
  const admits = sum("admits_count");
  const closed_lost = sum("closed_lost_count");
  const referred_out = sum("referred_out_count");
  return {
    leads,
    mqls,
    vobs,
    admits,
    closed_lost,
    referred_out,
    mql_to_admit: mqls > 0 ? admits / mqls : null,
    vob_to_admit: vobs > 0 ? admits / vobs : null,
  };
}

export function useOpFunnel(range: DateRange, filters?: FilterContract) {
  const hasFilters =
    !!filters &&
    (filters.pipelines.length > 0 || filters.sources.length > 0 || filters.locs.length > 0);

  return useQuery({
    queryKey: [
      "op-funnel-daily",
      range.from,
      range.to,
      filters?.pipelines.join(",") ?? "",
      filters?.sources.join(",") ?? "",
      filters?.locs.join(",") ?? "",
    ],
    queryFn: async (): Promise<OpFunnelData> => {
      // Use the filtered RPC when any selection is active; the unfiltered
      // RPC is the existing 2-arg signature, kept for hot-path simplicity.
      const { data, error } = hasFilters
        ? await supabase.rpc("reporting_op_funnel_daily_filtered", {
            p_start: range.from,
            p_end: range.to,
            p_pipelines: filters!.pipelines.length > 0 ? filters!.pipelines : null,
            p_source_categories: filters!.sources.length > 0 ? filters!.sources : null,
            p_locs: filters!.locs.length > 0 ? filters!.locs : null,
          })
        : await supabase.rpc("reporting_op_funnel_daily", {
            p_start: range.from,
            p_end: range.to,
          });
      if (error) throw new Error(`reporting_op_funnel_daily: ${error.message}`);
      const rows = (data ?? []) as OpFunnelDailyRow[];
      return { rows, totals: deriveTotals(rows) };
    },
    staleTime: 5 * 60 * 1000,
  });
}
