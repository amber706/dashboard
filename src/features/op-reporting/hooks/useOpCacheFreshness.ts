// useOpCacheFreshness — last successful reporting-build-op-metrics run.
// Shared by every Op Reporting page header so the viewer can see at a
// glance whether the cache is from this morning or stale.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CacheFreshness {
  last_built_at: string | null;
  rows_written: number | null;
  status: "success" | "partial" | null;
}

export function useOpCacheFreshness() {
  return useQuery({
    queryKey: ["op-cache-freshness"],
    queryFn: async (): Promise<CacheFreshness | null> => {
      const { data, error } = await supabase.rpc("reporting_op_cache_freshness");
      if (error) throw new Error(`reporting_op_cache_freshness: ${error.message}`);
      const rows = (data ?? []) as CacheFreshness[];
      return rows[0] ?? null;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
