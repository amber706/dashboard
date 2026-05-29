// useOpReferrals — referral-in (lead-side) + referred-out-closed (deal-side)
// from reporting.op_referrals_daily.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { Pipeline } from "@/lib/metrics/definitions";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";
import { filtersActive, filterCacheKey } from "./filterArgs";

export interface ReferralDailyRow {
  date: string;
  bd_referrals_in: number;
  digital_referrals_in: number;
  other_referrals_in: number;
  referred_out_closed_count: number;
}

export interface ReferredOutBreakdownRow {
  refer_out_type: string | null;
  pipeline: Pipeline | null;
  count: number;
}

export interface ReferralsData {
  rows: ReferralDailyRow[];
  breakdown: ReferredOutBreakdownRow[];
  totals: {
    bd_referrals_in: number;
    digital_referrals_in: number;
    other_referrals_in: number;
    total_referrals_in: number;
    referred_out_closed: number;
  };
}

export function useOpReferrals(range: DateRange, filters?: FilterContract) {
  return useQuery({
    queryKey: ["op-referrals", range.from, range.to, filterCacheKey(filters)],
    queryFn: async (): Promise<ReferralsData> => {
      // Referrals only honors pipeline + source filters; LOC isn't a
      // dimension on op_referrals_daily. We pass through the two that apply.
      const referralArgs = {
        p_start: range.from,
        p_end: range.to,
        p_pipelines: filters && filters.pipelines.length > 0 ? filters.pipelines : null,
        p_source_categories: filters && filters.sources.length > 0 ? filters.sources : null,
        p_owner_user_ids: filters && filters.reps.length > 0 ? filters.reps : null,
      };
      // LOC isn't a dim on op_referrals_daily — skip the filtered RPC when
      // only LOC was picked. The other three dims do apply.
      const useFiltered =
        filtersActive(filters) &&
        (filters!.pipelines.length + filters!.sources.length + filters!.reps.length) > 0;
      const [dailyRes, breakdownRes] = await Promise.all([
        useFiltered
          ? supabase.rpc("reporting_op_referrals_daily_filtered", referralArgs)
          : supabase.rpc("reporting_op_referrals_daily", { p_start: range.from, p_end: range.to }),
        useFiltered
          ? supabase.rpc("reporting_op_referred_out_breakdown_filtered", referralArgs)
          : supabase.rpc("reporting_op_referred_out_breakdown", { p_start: range.from, p_end: range.to }),
      ]);
      if (dailyRes.error) throw new Error(`reporting_op_referrals_daily: ${dailyRes.error.message}`);
      if (breakdownRes.error) throw new Error(`reporting_op_referred_out_breakdown: ${breakdownRes.error.message}`);

      const rows = (dailyRes.data ?? []) as ReferralDailyRow[];
      const breakdown = (breakdownRes.data ?? []) as ReferredOutBreakdownRow[];

      const totals = rows.reduce(
        (acc, r) => {
          acc.bd_referrals_in += r.bd_referrals_in;
          acc.digital_referrals_in += r.digital_referrals_in;
          acc.other_referrals_in += r.other_referrals_in;
          acc.referred_out_closed += r.referred_out_closed_count;
          return acc;
        },
        {
          bd_referrals_in: 0,
          digital_referrals_in: 0,
          other_referrals_in: 0,
          total_referrals_in: 0,
          referred_out_closed: 0,
        },
      );
      totals.total_referrals_in = totals.bd_referrals_in + totals.digital_referrals_in + totals.other_referrals_in;

      return { rows, breakdown, totals };
    },
    staleTime: 5 * 60 * 1000,
  });
}
