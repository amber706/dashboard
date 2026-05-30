// useOpLeadsConversionSplit — converted vs not-converted leads breakdown.
//
// Backed by reporting_op_leads_conversion_split(p_start, p_end) which reads
// reporting.leads.is_converted (sourced from Zoho Analytics "Is Converted"
// column). Rows where is_converted is NULL appear under "unknown" — those
// are leads pulled before the Analytics report exposed the field; a sync
// re-pull is needed for full coverage.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";

export interface LeadsConversionSplit {
  total_leads: number;
  converted: number;
  not_converted: number;
  unknown: number;
  conversion_rate: number | null;
}

export function useOpLeadsConversionSplit(range: DateRange) {
  return useQuery({
    queryKey: ["op-leads-conversion-split", range.from, range.to],
    queryFn: async (): Promise<LeadsConversionSplit> => {
      const { data, error } = await supabase.rpc(
        "reporting_op_leads_conversion_split",
        { p_start: range.from, p_end: range.to },
      );
      if (error) throw new Error(`reporting_op_leads_conversion_split: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as LeadsConversionSplit | null;
      return (
        row ?? {
          total_leads: 0,
          converted: 0,
          not_converted: 0,
          unknown: 0,
          conversion_rate: null,
        }
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}
