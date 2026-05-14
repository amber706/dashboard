import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type { DateRange, PayerRow } from "../api/types";

// Cornerstone tracks 6 payer-type buckets: Commercial, AHCCCS, Cash,
// DUI, DV, Unknown. DUI + DV are court-mandated programs distinct from
// the regular Treatment line of business — they have their own admits,
// their own conversion characteristics, and need to be visible separately
// on every payer chart.
export interface PayerPayload {
  summary: {
    commercial: number;
    ahcccs: number;
    cash: number;
    dui: number;
    dv: number;
    commercialDeltaPts: number;
    ahcccsDeltaPts: number;
    totalAdmits: number;
  };
  vobApproval: {
    perPayer: { payer: string; submitted: number; approved: number; rate: number | null }[];
  };
  trend: PayerRow[];
  channelHeatmap: Record<string, { Commercial: number; AHCCCS: number; Cash: number; DUI: number; DV: number; Unknown: number }>;
}

function shiftYear(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

async function fetchPayer(range: DateRange): Promise<PayerPayload> {
  const now = new Date();
  const priorRange = { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1) };
  const start6 = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);

  const [filteredRes, priorRes, trendRes, vobRes] = await Promise.all([
    fact().from("fact_admit").select("payer_type_group, level_of_care, channel_group")
      .gte("admit_date", range.from).lte("admit_date", range.to),
    fact().from("fact_admit").select("payer_type_group")
      .gte("admit_date", priorRange.from).lte("admit_date", priorRange.to),
    fact().from("fact_admit").select("admit_date, payer_type_group").gte("admit_date", start6),
    fact().from("fact_vob").select("payer_type_group, vob_submitted_date, vob_approved_date")
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`),
  ]);

  const mix = { Commercial: 0, AHCCCS: 0, Cash: 0, DUI: 0, DV: 0, Unknown: 0 };
  for (const r of filteredRes.data ?? []) {
    const p = (r.payer_type_group as keyof typeof mix) ?? "Unknown";
    if (mix[p] !== undefined) mix[p] += 1;
    else mix.Unknown += 1;
  }
  const total = mix.Commercial + mix.AHCCCS + mix.Cash + mix.DUI + mix.DV + mix.Unknown;

  const mixPrior = { Commercial: 0, AHCCCS: 0, Cash: 0 };
  for (const r of priorRes.data ?? []) {
    const p = r.payer_type_group as keyof typeof mixPrior;
    if (p in mixPrior) mixPrior[p] += 1;
  }
  const totalPrior = mixPrior.Commercial + mixPrior.AHCCCS + mixPrior.Cash;

  const bucket: Record<string, PayerRow> = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    bucket[d.toISOString().slice(0, 7)] = {
      month: d.toLocaleDateString("en-US", { month: "short" }),
      commercial: 0, ahcccs: 0, cash: 0, dui: 0, dv: 0, unknown: 0,
    };
  }
  for (const r of trendRes.data ?? []) {
    const mk = String(r.admit_date).slice(0, 7);
    if (!bucket[mk]) continue;
    const p = r.payer_type_group as "Commercial" | "AHCCCS" | "Cash" | "DUI" | "DV" | "Unknown" | null;
    if      (p === "Commercial") bucket[mk].commercial += 1;
    else if (p === "AHCCCS")     bucket[mk].ahcccs += 1;
    else if (p === "Cash")       bucket[mk].cash += 1;
    else if (p === "DUI")        bucket[mk].dui = (bucket[mk].dui ?? 0) + 1;
    else if (p === "DV")         bucket[mk].dv  = (bucket[mk].dv  ?? 0) + 1;
    else                         bucket[mk].unknown = (bucket[mk].unknown ?? 0) + 1;
  }
  const trend = Object.values(bucket);

  const vobByPayer: Record<string, { submitted: number; approved: number }> = {};
  for (const r of vobRes.data ?? []) {
    const p = (r.payer_type_group as string) ?? "Unknown";
    const rec = vobByPayer[p] ??= { submitted: 0, approved: 0 };
    if (r.vob_submitted_date) rec.submitted += 1;
    if (r.vob_approved_date) rec.approved += 1;
  }

  const channelHeatmap: Record<string, { Commercial: number; AHCCCS: number; Cash: number; DUI: number; DV: number; Unknown: number }> = {};
  for (const r of filteredRes.data ?? []) {
    const g = (r.channel_group as string) ?? "Unattributed";
    const p = (r.payer_type_group as "Commercial" | "AHCCCS" | "Cash" | "DUI" | "DV" | "Unknown") ?? "Unknown";
    const rec = channelHeatmap[g] ??= { Commercial: 0, AHCCCS: 0, Cash: 0, DUI: 0, DV: 0, Unknown: 0 };
    rec[p] = (rec[p] ?? 0) + 1;
  }

  const pct = (n: number, d: number) => (d > 0 ? n / d : 0);

  return {
    summary: {
      commercial: pct(mix.Commercial, total),
      ahcccs: pct(mix.AHCCCS, total),
      cash: pct(mix.Cash, total),
      dui: pct(mix.DUI, total),
      dv: pct(mix.DV, total),
      commercialDeltaPts: totalPrior > 0 ? pct(mix.Commercial, total) - pct(mixPrior.Commercial, totalPrior) : 0,
      ahcccsDeltaPts: totalPrior > 0 ? pct(mix.AHCCCS, total) - pct(mixPrior.AHCCCS, totalPrior) : 0,
      totalAdmits: total,
    },
    vobApproval: {
      perPayer: Object.entries(vobByPayer)
        .filter(([p]) => p === "Commercial" || p === "AHCCCS" || p === "Cash")
        .map(([p, v]) => ({ payer: p, submitted: v.submitted, approved: v.approved, rate: v.submitted > 0 ? v.approved / v.submitted : null }))
        .sort((a, b) => b.submitted - a.submitted),
    },
    trend,
    channelHeatmap,
  };
}

export function usePayer(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "payer", range.from, range.to],
    queryFn: () => fetchPayer(range),
    staleTime: 5 * 60_000,
  });
}
