import { useQuery } from "@tanstack/react-query";
import { fact, dim } from "../api/client";
import type { DateRange } from "../api/types";

export interface ChannelRow {
  channel_group: string;
  channel_subgroup: string;
  display: string;
  leads: number;
  vobs: number;
  admits: number;
  convPct: number | null;
  vobPct: number | null;
}

export interface LandingRow {
  url: string;
  leads: number;
  admits: number;
  convPct: number | null;
}

export interface ChannelPayload {
  table: ChannelRow[];
  landing: LandingRow[];
  missing: { pct: number; count: number };
  heatmap: Record<string, { High: number; Med: number; Low: number }>;
}

async function fetchChannel(range: DateRange): Promise<ChannelPayload> {
  const [dimRes, pipeRes, admitRes, vobRes, landingRes, missingRes, qualityRes] = await Promise.all([
    dim().from("dim_source").select("channel_subgroup, channel_group, display_label"),
    fact().from("fact_pipeline").select("channel_group, channel_subgroup, is_won, stage_key")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
    fact().from("fact_admit").select("channel_group, channel_subgroup, landing_url, admit_date")
      .gte("admit_date", range.from).lte("admit_date", range.to),
    fact().from("fact_vob").select("channel_subgroup")
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`),
    fact().from("fact_pipeline").select("landing_url, is_won")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .not("landing_url", "is", null),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to)
      .eq("channel_group", "Unattributed"),
    fact().from("fact_pipeline").select("channel_subgroup, lead_quality_rating, is_won")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .not("lead_quality_rating", "is", null),
  ]);

  const dimLabel = new Map<string, { group: string; label: string }>();
  for (const d of dimRes.data ?? []) {
    dimLabel.set(d.channel_subgroup, { group: d.channel_group, label: d.display_label });
  }

  const bySub: Record<string, ChannelRow> = {};
  const ensureRow = (sub: string): ChannelRow => {
    if (!bySub[sub]) {
      const m = dimLabel.get(sub) ?? { group: "Unknown", label: sub };
      bySub[sub] = {
        channel_group: m.group, channel_subgroup: sub, display: m.label,
        leads: 0, vobs: 0, admits: 0, convPct: null, vobPct: null,
      };
    }
    return bySub[sub];
  };
  for (const r of pipeRes.data ?? [])  ensureRow((r.channel_subgroup as string) ?? "unattributed").leads += 1;
  for (const r of vobRes.data  ?? [])  ensureRow((r.channel_subgroup as string) ?? "unattributed").vobs += 1;
  for (const r of admitRes.data ?? []) ensureRow((r.channel_subgroup as string) ?? "unattributed").admits += 1;

  const table = Object.values(bySub).map((r) => ({
    ...r,
    convPct: r.leads > 0 ? r.admits / r.leads : null,
    vobPct:  r.leads > 0 ? r.vobs   / r.leads : null,
  })).sort((a, b) => b.admits - a.admits);

  // Landing URL
  const landingAgg = new Map<string, { leads: number; admits: number }>();
  for (const r of landingRes.data ?? []) {
    const url = String(r.landing_url ?? "").trim();
    if (!url) continue;
    const prev = landingAgg.get(url) ?? { leads: 0, admits: 0 };
    prev.leads += 1;
    if (r.is_won) prev.admits += 1;
    landingAgg.set(url, prev);
  }
  const landing = [...landingAgg.entries()]
    .map(([url, v]) => ({ url, leads: v.leads, admits: v.admits, convPct: v.leads > 0 ? v.admits / v.leads : null }))
    .sort((a, b) => b.admits - a.admits).slice(0, 10);

  const totalAdmits = table.reduce((s, r) => s + r.admits, 0);
  const missingTracking = missingRes.count ?? 0;
  const missingPct = totalAdmits > 0 ? missingTracking / totalAdmits : 0;

  // Heatmap channel × quality
  const topChannels = table.slice(0, 6).map((r) => ({ subgroup: r.channel_subgroup, label: r.display }));
  type Tier = "High" | "Med" | "Low";
  const pairCounts: Record<string, Record<Tier, { leads: number; admits: number }>> = {};
  for (const tc of topChannels) {
    pairCounts[tc.subgroup] = { High: { leads: 0, admits: 0 }, Med: { leads: 0, admits: 0 }, Low: { leads: 0, admits: 0 } };
  }
  for (const r of qualityRes.data ?? []) {
    const sub = r.channel_subgroup as string | null;
    if (!sub || !pairCounts[sub]) continue;
    const rawTier = r.lead_quality_rating as string;
    const tier: Tier | null = rawTier === "High" ? "High" : rawTier === "Medium" ? "Med" : rawTier === "Low" ? "Low" : null;
    if (!tier) continue;
    pairCounts[sub][tier].leads += 1;
    if (r.is_won) pairCounts[sub][tier].admits += 1;
  }
  const heatmap: Record<string, { High: number; Med: number; Low: number }> = {};
  for (const tc of topChannels) {
    const b = pairCounts[tc.subgroup];
    heatmap[tc.label] = {
      High: b.High.leads > 0 ? b.High.admits / b.High.leads : 0,
      Med:  b.Med.leads  > 0 ? b.Med.admits  / b.Med.leads  : 0,
      Low:  b.Low.leads  > 0 ? b.Low.admits  / b.Low.leads  : 0,
    };
  }

  return { table, landing, missing: { pct: missingPct, count: missingTracking }, heatmap };
}

export function useChannel(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "channel", range.from, range.to],
    queryFn: () => fetchChannel(range),
    staleTime: 5 * 60_000,
  });
}
