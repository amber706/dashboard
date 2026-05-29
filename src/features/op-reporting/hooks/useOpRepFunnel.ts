// useOpRepFunnel — per-rep MQL → Admit attribution.
//
// Joins op_lead_funnel_daily on owner_user_id to get the conversion
// outcome each specialist is responsible for. Pairs with useOpRepActivity
// (calls + meetings) on /analytics/op-rep-activity to close the loop:
// activity in → outcomes out.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { RepRole } from "./useOpRepActivity";

export interface RepFunnelRow {
  owner_user_id: string;
  full_name: string | null;
  role_derived: RepRole | null;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  mql_to_admit: number | null;
}

export function useOpRepFunnel(range: DateRange) {
  return useQuery({
    queryKey: ["op-rep-funnel", range.from, range.to],
    queryFn: async (): Promise<{ rows: RepFunnelRow[] }> => {
      const { data, error } = await supabase.rpc("reporting_op_rep_funnel", {
        p_start: range.from,
        p_end: range.to,
      });
      if (error) throw new Error(`reporting_op_rep_funnel: ${error.message}`);
      return { rows: (data ?? []) as RepFunnelRow[] };
    },
    staleTime: 5 * 60 * 1000,
  });
}
