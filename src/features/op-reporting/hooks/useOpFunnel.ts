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
import { filtersActive, filterArgs, filterCacheKey } from "./filterArgs";

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
  return useQuery({
    queryKey: ["op-funnel-daily", range.from, range.to, filterCacheKey(filters)],
    queryFn: async (): Promise<OpFunnelData> => {
      const { data, error } = filtersActive(filters)
        ? await supabase.rpc("reporting_op_funnel_daily_filtered", {
            p_start: range.from,
            p_end: range.to,
            ...filterArgs(filters),
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
