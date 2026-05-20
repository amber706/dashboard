// useUnattributedDetail — drill-down for Unattributed on Chart View.
// Pulls fact_pipeline rows where channel_group='Unattributed' in the
// active window and aggregates by owner + tracking-signal coverage,
// plus a sample of the 10 most recent for spot-checking.

import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type { DateRange } from "../api/types";
import type { PipelineFilter } from "./useChartView";

export interface UnattributedOwnerRow {
  owner: string;
  count: number;
  admits: number;
}

export interface UnattributedSample {
  first_name: string | null;
  last_initial: string | null;
  lead_created_time: string | null;
  stage_raw: string | null;
  owner: string | null;
}

export interface UnattributedDetailPayload {
  total: number;
  by_owner: UnattributedOwnerRow[];
  signal_coverage: {
    has_tracking_source: number;
    has_gclid: number;
    has_landing: number;
    has_campaign: number;
    fully_blank: number;
  };
  samples: UnattributedSample[];
}

async function fetchUnattributedDetail(range: DateRange, pipeline: PipelineFilter): Promise<UnattributedDetailPayload> {
  let q = fact().from("fact_pipeline")
    .select("first_name, last_initial, lead_created_time, stage_raw, rep_key, tracking_source, gclid_normalized, landing_url, campaign_name, is_won, payer_type_group")
    .eq("channel_group", "Unattributed")
    .gte("lead_created_time", range.from)
    .lte("lead_created_time", `${range.to}T23:59:59`)
    .range(0, 4999);
  if (pipeline === "commercial") q = q.eq("payer_type_group", "Commercial");
  if (pipeline === "ahcccs")     q = q.eq("payer_type_group", "AHCCCS");

  const { data } = await q;
  const rows = (data ?? []) as Array<{
    first_name: string | null; last_initial: string | null;
    lead_created_time: string | null; stage_raw: string | null;
    rep_key: string | null;
    tracking_source: string | null; gclid_normalized: string | null;
    landing_url: string | null; campaign_name: string | null;
    is_won: boolean | null;
  }>;

  const ownerMap = new Map<string, { count: number; admits: number }>();
  const sig = { has_tracking_source: 0, has_gclid: 0, has_landing: 0, has_campaign: 0, fully_blank: 0 };

  for (const r of rows) {
    const owner = (r.rep_key && r.rep_key.trim()) || "(no owner)";
    const prev = ownerMap.get(owner) ?? { count: 0, admits: 0 };
    prev.count++;
    if (r.is_won) prev.admits++;
    ownerMap.set(owner, prev);

    const ts = !!(r.tracking_source && r.tracking_source.trim());
    const gc = !!(r.gclid_normalized && r.gclid_normalized.trim());
    const lu = !!(r.landing_url && r.landing_url.trim());
    const cn = !!(r.campaign_name && r.campaign_name.trim());
    if (ts) sig.has_tracking_source++;
    if (gc) sig.has_gclid++;
    if (lu) sig.has_landing++;
    if (cn) sig.has_campaign++;
    if (!ts && !gc && !lu && !cn) sig.fully_blank++;
  }

  const by_owner = [...ownerMap.entries()]
    .map(([owner, v]) => ({ owner, count: v.count, admits: v.admits }))
    .sort((a, b) => b.count - a.count);

  const samples = rows
    .slice()
    .sort((a, b) => (b.lead_created_time ?? "").localeCompare(a.lead_created_time ?? ""))
    .slice(0, 10)
    .map((r) => ({
      first_name: r.first_name,
      last_initial: r.last_initial,
      lead_created_time: r.lead_created_time,
      stage_raw: r.stage_raw,
      owner: r.rep_key,
    }));

  return { total: rows.length, by_owner, signal_coverage: sig, samples };
}

export function useUnattributedDetail(range: DateRange, pipeline: PipelineFilter, enabled: boolean) {
  return useQuery({
    queryKey: ["analytics-warehouse", "unattributed-detail", range.from, range.to, pipeline],
    queryFn: () => fetchUnattributedDetail(range, pipeline),
    enabled,
    staleTime: 5 * 60_000,
  });
}
