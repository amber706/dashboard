// useOpDataQuality — surfaces v_unmapped_* / v_orphan_* / v_sync_health /
// v_sync_failures_recent through the manager-gated wrapper RPCs.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DqSummaryRow {
  category: string;
  count: number;
}

export interface SyncHealthRow {
  function_name: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: string | null;
  last_rows_processed: number | null;
  last_rows_failed: number | null;
  last_error_message: string | null;
}

export interface SyncFailureRow {
  source: string;
  failure_type: string;
  n: number;
  last_occurred_at: string | null;
  sample_raw_value: string | null;
  sample_error: string | null;
}

export function useOpDataQuality() {
  return useQuery({
    queryKey: ["op-data-quality"],
    queryFn: async () => {
      const [summary, health, failures] = await Promise.all([
        supabase.rpc("reporting_op_data_quality_summary"),
        supabase.rpc("reporting_op_sync_health"),
        supabase.rpc("reporting_op_sync_failures_recent"),
      ]);
      if (summary.error) throw new Error(`reporting_op_data_quality_summary: ${summary.error.message}`);
      if (health.error) throw new Error(`reporting_op_sync_health: ${health.error.message}`);
      if (failures.error) throw new Error(`reporting_op_sync_failures_recent: ${failures.error.message}`);
      return {
        summary: (summary.data ?? []) as DqSummaryRow[],
        health: (health.data ?? []) as SyncHealthRow[],
        failures: (failures.data ?? []) as SyncFailureRow[],
      };
    },
    staleTime: 60 * 1000, // 1 minute — this is the diagnostics page, freshness matters
  });
}
