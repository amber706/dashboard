// useOpRepActivity — per-rep call + meeting totals from op_rep_activity_daily.
//
// Backed by `reporting_op_rep_activity(p_start, p_end)` (unfiltered) and
// `reporting_op_rep_activity_filtered(p_start, p_end, p_owner_user_ids)` when
// the rep filter is active. Pipeline / source / LOC filters are intentional
// no-ops here — op_rep_activity_daily is built from calls + meetings and
// doesn't carry those dimensions (see migration 191 header for rationale).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";
import { filterCacheKey } from "./filterArgs";

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

export function useOpRepActivity(range: DateRange, filters?: FilterContract) {
  // Only the `reps` filter applies to rep activity — pipeline / source / LOC
  // aren't dimensions on op_rep_activity_daily. Route to the filtered RPC
  // whenever a rep filter is set; the other filters are silently ignored.
  const repIds = filters && filters.reps.length > 0 ? filters.reps : null;
  return useQuery({
    queryKey: ["op-rep-activity", range.from, range.to, filterCacheKey(filters)],
    queryFn: async (): Promise<RepActivityData> => {
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
