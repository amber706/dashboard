// useOpFunnelByPipeline — per-pipeline rollup of the funnel cache.
//
// Backed by `reporting_op_funnel_by_pipeline(p_start, p_end)` — the
// pipeline=NULL row holds lead-side counts (leads don't have a pipeline
// yet), so it's separated out as `unattached` in the resolved data.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import {
  PIPELINE,
  TOP_LINE_ADMIT_PIPELINES,
  type Pipeline,
} from "@/lib/metrics/definitions";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";
import { filtersActive, filterArgs, filterCacheKey } from "./filterArgs";

export interface PipelineRollupRow {
  pipeline: Pipeline | null;
  leads_count: number;
  mqls_count: number;
  vobs_count: number;
  admits_count: number;
  closed_lost_count: number;
  referred_out_count: number;
}

const PIPELINE_LABEL: Record<Pipeline, string> = {
  [PIPELINE.CommercialCash]: "Commercial-Cash",
  [PIPELINE.Ahcccs]: "AHCCCS",
  [PIPELINE.Zocdoc]: "ZocDoc",
  [PIPELINE.DuiCash]: "DUI",
  [PIPELINE.DvCash]: "DV",
};

export function labelForPipeline(p: Pipeline | null): string {
  return p == null ? "Unattached (lead-stage)" : PIPELINE_LABEL[p];
}

export function isTopLine(p: Pipeline | null): boolean {
  return p != null && (TOP_LINE_ADMIT_PIPELINES as readonly Pipeline[]).includes(p);
}

export interface ByPipelineData {
  rows: PipelineRollupRow[];
  topLineTotals: Omit<PipelineRollupRow, "pipeline">;
}

function emptyTotals(): Omit<PipelineRollupRow, "pipeline"> {
  return {
    leads_count: 0,
    mqls_count: 0,
    vobs_count: 0,
    admits_count: 0,
    closed_lost_count: 0,
    referred_out_count: 0,
  };
}

export function useOpFunnelByPipeline(range: DateRange, filters?: FilterContract) {
  return useQuery({
    queryKey: ["op-funnel-by-pipeline", range.from, range.to, filterCacheKey(filters)],
    queryFn: async (): Promise<ByPipelineData> => {
      const { data, error } = filtersActive(filters)
        ? await supabase.rpc("reporting_op_funnel_by_pipeline_filtered", {
            p_start: range.from,
            p_end: range.to,
            ...filterArgs(filters),
          })
        : await supabase.rpc("reporting_op_funnel_by_pipeline", {
            p_start: range.from,
            p_end: range.to,
          });
      if (error) throw new Error(`reporting_op_funnel_by_pipeline: ${error.message}`);
      const rows = (data ?? []) as PipelineRollupRow[];
      const topLineTotals = rows.reduce((acc, r) => {
        if (!isTopLine(r.pipeline)) return acc;
        acc.leads_count += r.leads_count;
        acc.mqls_count += r.mqls_count;
        acc.vobs_count += r.vobs_count;
        acc.admits_count += r.admits_count;
        acc.closed_lost_count += r.closed_lost_count;
        acc.referred_out_count += r.referred_out_count;
        return acc;
      }, emptyTotals());
      return { rows, topLineTotals };
    },
    staleTime: 5 * 60 * 1000,
  });
}
