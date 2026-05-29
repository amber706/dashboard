// useOpReferrals — referral-in (lead-side) + referred-out-closed (deal-side)
// from reporting.op_referrals_daily.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { Pipeline } from "@/lib/metrics/definitions";

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

export function useOpReferrals(range: DateRange) {
  return useQuery({
    queryKey: ["op-referrals", range.from, range.to],
    queryFn: async (): Promise<ReferralsData> => {
      const [dailyRes, breakdownRes] = await Promise.all([
        supabase.rpc("reporting_op_referrals_daily", { p_start: range.from, p_end: range.to }),
        supabase.rpc("reporting_op_referred_out_breakdown", { p_start: range.from, p_end: range.to }),
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
