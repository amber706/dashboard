// useOpFunnelByLoc — per-LOC rollup of the funnel cache.
//
// Powers the "By level of care" section on /analytics/op-funnel. LOCs that
// are also pipelines (DUI, DV) appear in both the by-pipeline AND by-LOC
// breakdowns; that's intentional per the orthogonality matrix in
// METRIC_DEFINITIONS.md §24.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import {
  LEVEL_OF_CARE,
  type LevelOfCare,
} from "@/lib/metrics/definitions";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";
import { filtersActive, filterArgs, filterCacheKey } from "./filterArgs";

export interface LocRollupRow {
  level_of_care: LevelOfCare | null;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

// Display labels for the LOC enum. Numbers (iop5 / iop3 etc.) indicate
// programming intensity — IOP-5 is 5 days/week, IOP-3 is 3 days/week, etc.
const LOC_LABEL: Record<LevelOfCare, string> = {
  [LEVEL_OF_CARE.Detox]: "Detox",
  [LEVEL_OF_CARE.Bhrf]: "BHRF",
  [LEVEL_OF_CARE.Php]: "PHP",
  [LEVEL_OF_CARE.Iop5]: "IOP-5",
  [LEVEL_OF_CARE.Iop3]: "IOP-3",
  [LEVEL_OF_CARE.ViopAdult]: "VIOP Adult",
  [LEVEL_OF_CARE.ViopAdolescent]: "VIOP Adolescent",
  [LEVEL_OF_CARE.Op]: "OP",
  [LEVEL_OF_CARE.Vop]: "VOP",
  [LEVEL_OF_CARE.VopAdult]: "VOP Adult",
  [LEVEL_OF_CARE.VopAdolescent]: "VOP Adolescent",
  [LEVEL_OF_CARE.Dui]: "DUI",
  [LEVEL_OF_CARE.Dv]: "DV",
};

export function labelForLoc(loc: LevelOfCare | null): string {
  return loc == null ? "Unspecified" : LOC_LABEL[loc] ?? loc;
}

export function useOpFunnelByLoc(range: DateRange, filters?: FilterContract) {
  return useQuery({
    queryKey: ["op-funnel-by-loc", range.from, range.to, filterCacheKey(filters)],
    queryFn: async (): Promise<{ rows: LocRollupRow[] }> => {
      const { data, error } = filtersActive(filters)
        ? await supabase.rpc("reporting_op_funnel_by_loc_filtered", {
            p_start: range.from,
            p_end: range.to,
            ...filterArgs(filters),
          })
        : await supabase.rpc("reporting_op_funnel_by_loc", {
            p_start: range.from,
            p_end: range.to,
          });
      if (error) throw new Error(`reporting_op_funnel_by_loc: ${error.message}`);
      return { rows: (data ?? []) as LocRollupRow[] };
    },
    staleTime: 5 * 60 * 1000,
  });
}
