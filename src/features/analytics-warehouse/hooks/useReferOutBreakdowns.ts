// useReferOutBreakdowns — client wrapper around the
// analytics-refer-out-breakdowns edge function. Powers the 4
// reason/company charts on the Chart View page. Pulled from Zoho
// (warehouse close_reason is null right now).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "../api/types";
import type { PipelineFilter, Slice } from "./useChartView";

export interface ReferOutBreakdownsPayload {
  ok: boolean;
  totals: { refer_outs: number; closed_lost: number };
  closed_lost_by_reason: Slice[];
  referred_out_by_reason: Slice[];
  referred_out_by_policy: Slice[];
  referred_out_by_company: Slice[];
}

async function fetchBreakdowns(range: DateRange, pipeline: PipelineFilter): Promise<ReferOutBreakdownsPayload> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analytics-refer-out-breakdowns`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      start_iso: `${range.from}T00:00:00+00:00`,
      end_iso:   `${range.to}T23:59:59+00:00`,
      pipeline_filter: pipeline,
    }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "refer-out breakdowns load failed");
  return json as ReferOutBreakdownsPayload;
}

export function useReferOutBreakdowns(range: DateRange, pipeline: PipelineFilter) {
  return useQuery({
    queryKey: ["analytics-warehouse", "refer-out-breakdowns", range.from, range.to, pipeline],
    queryFn: () => fetchBreakdowns(range, pipeline),
    staleTime: 5 * 60_000,
  });
}
