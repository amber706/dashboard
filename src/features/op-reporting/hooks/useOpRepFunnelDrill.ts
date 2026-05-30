// useOpRepFunnelDrill — per-cell drill for /analytics/op-rep-activity
// "Funnel by specialist". Calls reporting_op_rep_funnel_drill which returns
// the deal-level rows underlying a single (rep, metric, window) tuple.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";

export type DrillMetric = "mqls" | "vobs" | "admits" | "closed_lost";

export interface DrillRow {
  source_deal_id: string;
  deal_name: string;
  stage_raw: string;
  date_key: string | null;
  /**
   * For admits, indicates which event the row represents:
   *   - "Admit"          — treatment / DV admit (admit_date or closed_won_admitted)
   *   - "Screening sold" — DUI screening sale (anchored on screening_closed_date)
   *   - "Course sold"    — DUI course sale (anchored on closing_date)
   *   - null             — MQL / VOB / Closed Lost rows (one event per deal)
   * Lets the UI label why a single DUI deal can appear twice in the drill.
   */
  event_label: string | null;
}

/**
 * Build a deep-link to a Zoho CRM Deal. Zoho redirects this generic URL to
 * the org-scoped one when the user is logged in.
 */
export function zohoDealUrl(sourceDealId: string): string {
  return `https://crm.zoho.com/crm/tab/Potentials/${sourceDealId}`;
}

interface DrillArgs {
  userId: string | null;
  metric: DrillMetric | null;
  range: DateRange;
}

/**
 * Fires only when both userId + metric are set. Pass nulls to no-op until
 * the user clicks a cell.
 */
export function useOpRepFunnelDrill({ userId, metric, range }: DrillArgs) {
  return useQuery({
    enabled: !!userId && !!metric,
    queryKey: ["op-rep-funnel-drill", userId, metric, range.from, range.to],
    queryFn: async (): Promise<DrillRow[]> => {
      const { data, error } = await supabase.rpc("reporting_op_rep_funnel_drill", {
        p_user_id: userId!,
        p_metric: metric!,
        p_start: range.from,
        p_end: range.to,
      });
      if (error) throw new Error(`reporting_op_rep_funnel_drill: ${error.message}`);
      return (data ?? []) as DrillRow[];
    },
    staleTime: 60 * 1000,
  });
}
