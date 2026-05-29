// useOpFunnelBySource — per-source_category rollup of the funnel cache.
//
// Powers the marketing-channel attribution section on /analytics/op-funnel.
// Reads via reporting_op_funnel_by_source.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import {
  SOURCE_CATEGORY,
  type SourceCategory,
} from "@/lib/metrics/definitions";

export interface SourceRollupRow {
  source_category: SourceCategory | null;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

const SOURCE_LABEL: Record<SourceCategory, string> = {
  [SOURCE_CATEGORY.DigitalMarketing]: "Digital Marketing",
  [SOURCE_CATEGORY.BusinessDevelopment]: "Business Development",
  [SOURCE_CATEGORY.Zocdoc]: "ZocDoc",
};

export function labelForSource(s: SourceCategory | null): string {
  return s == null ? "Unattributed" : SOURCE_LABEL[s];
}

export function useOpFunnelBySource(range: DateRange) {
  return useQuery({
    queryKey: ["op-funnel-by-source", range.from, range.to],
    queryFn: async (): Promise<{ rows: SourceRollupRow[] }> => {
      const { data, error } = await supabase.rpc("reporting_op_funnel_by_source", {
        p_start: range.from,
        p_end: range.to,
      });
      if (error) throw new Error(`reporting_op_funnel_by_source: ${error.message}`);
      return { rows: (data ?? []) as SourceRollupRow[] };
    },
    staleTime: 5 * 60 * 1000,
  });
}
