// useOpRepActivity — per-rep call + meeting totals from op_rep_activity_daily.
//
// Backed by `reporting_op_rep_activity(p_start, p_end)`. Joins user_identity
// so we can show full names; aggregates meetings_by_type across the window.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";

export type RepRole = "admissions_rep" | "bd_rep" | "other";

export interface RepActivityRow {
  owner_user_id: string | null;
  full_name: string | null;
  role_derived: RepRole | null;
  inbound_calls: number;
  outbound_calls: number;
  missed_calls: number;
  calls_over_2min: number;
  meetings_count: number;
  meetings_by_type: Record<string, number> | null;
  active_days: number;
}

export interface RepActivityData {
  rows: RepActivityRow[];
  unattributed: RepActivityRow | null;
  totals: {
    inbound_calls: number;
    outbound_calls: number;
    missed_calls: number;
    calls_over_2min: number;
    meetings_count: number;
  };
}

function emptyTotals() {
  return {
    inbound_calls: 0,
    outbound_calls: 0,
    missed_calls: 0,
    calls_over_2min: 0,
    meetings_count: 0,
  };
}

export function useOpRepActivity(range: DateRange) {
  return useQuery({
    queryKey: ["op-rep-activity", range.from, range.to],
    queryFn: async (): Promise<RepActivityData> => {
      const { data, error } = await supabase.rpc("reporting_op_rep_activity", {
        p_start: range.from,
        p_end: range.to,
      });
      if (error) throw new Error(`reporting_op_rep_activity: ${error.message}`);
      const all = (data ?? []) as RepActivityRow[];
      const unattributed = all.find((r) => r.owner_user_id == null) ?? null;
      const rows = all.filter((r) => r.owner_user_id != null);
      const totals = all.reduce((acc, r) => {
        acc.inbound_calls += r.inbound_calls;
        acc.outbound_calls += r.outbound_calls;
        acc.missed_calls += r.missed_calls;
        acc.calls_over_2min += r.calls_over_2min;
        acc.meetings_count += r.meetings_count;
        return acc;
      }, emptyTotals());
      return { rows, unattributed, totals };
    },
    staleTime: 5 * 60 * 1000,
  });
}
