// useOpPayerMix — payer-mix classification from reporting.leads.
//
// Backed by reporting_op_payer_mix(p_start, p_end). The RPC applies the
// CONFIRMED.md #24 insurance-wins precedence + treatment-lead gate
// (LOC ∉ {DUI, DV}) so the buckets mirror isAhcccsLead / isCommercialLead /
// isOtherPayerLead / isDuiLead / isDvLead from definitions.ts.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";

export type PayerBucket =
  | "AHCCCS Lead"
  | "Commercial Lead"
  | "Other Payer Lead"
  | "DUI"
  | "DV"
  | "Unclassified";

export interface PayerMixRow {
  bucket: PayerBucket;
  count: number;
  share: number | null;
}

export interface PayerMixData {
  rows: PayerMixRow[];
  total: number;
  /** Helper view: just the treatment leads (AHCCCS + Commercial + Other Payer + Unclassified) — sums to the
   *  total minus DUI + DV. Useful for the "treatment funnel" denominator separately from DUI/DV. */
  treatment: { ahcccs: number; commercial: number; other_payer: number; unclassified: number };
}

export function useOpPayerMix(range: DateRange) {
  return useQuery({
    queryKey: ["op-payer-mix", range.from, range.to],
    queryFn: async (): Promise<PayerMixData> => {
      const { data, error } = await supabase.rpc("reporting_op_payer_mix", {
        p_start: range.from,
        p_end: range.to,
      });
      if (error) throw new Error(`reporting_op_payer_mix: ${error.message}`);
      const rows = (data ?? []) as PayerMixRow[];
      const total = rows.reduce((acc, r) => acc + r.count, 0);
      const get = (b: PayerBucket) => rows.find((r) => r.bucket === b)?.count ?? 0;
      return {
        rows,
        total,
        treatment: {
          ahcccs: get("AHCCCS Lead"),
          commercial: get("Commercial Lead"),
          other_payer: get("Other Payer Lead"),
          unclassified: get("Unclassified"),
        },
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
