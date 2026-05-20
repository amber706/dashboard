// useChartView — aggregation hook backing the /analytics/chart-view
// page. Pulls fact_pipeline / fact_vob / fact_admit in parallel and
// rolls each up into nine breakdowns:
//
//   leads  × { by source, by source×payer, by source×LOC }
//   vobs   × { by source, by source×payer, by source×LOC }
//   admits × { by source, by source×payer, by source×LOC }
//
// "Source" = fact_*.channel_group (5 buckets: SEO, BD Referral, PPC,
// Directory, Unattributed). Payer + LOC come straight off each fact
// table — no extra joins.
//
// Pipeline filter narrows to a payer_type_group bucket so the same
// page can be flipped between Commercial vs AHCCCS without reloading.

import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type { DateRange } from "../api/types";

export type PipelineFilter = "all" | "commercial" | "ahcccs";

export interface Slice {
  label: string;
  count: number;
}
export interface NestedRow {
  source: string;
  byKey: Record<string, number>; // payer or LOC → count
  total: number;
}

export interface ChartViewPayload {
  totals: { leads: number; vobs: number; admits: number };
  leadsBySource: Slice[];
  leadsBySourceByPayer: NestedRow[];
  leadsBySourceByLoc: NestedRow[];
  vobsBySource: Slice[];
  vobsBySourceByPayer: NestedRow[];
  vobsBySourceByLoc: NestedRow[];
  admitsBySource: Slice[];
  admitsBySourceByPayer: NestedRow[];
  admitsBySourceByLoc: NestedRow[];
  // Distinct dimension keys observed in the data (for legend / column ordering).
  payerKeys: string[];
  locKeys: string[];
  sourceKeys: string[];
}

const UNKNOWN_SOURCE = "Unattributed";
const UNKNOWN_PAYER  = "Unknown";
const UNKNOWN_LOC    = "(no LOC)";

// Normalize blanks to canonical labels so the pie slices don't show
// "null" or empty strings.
const src = (v: unknown) => (typeof v === "string" && v.trim()) ? v : UNKNOWN_SOURCE;
const pay = (v: unknown) => (typeof v === "string" && v.trim()) ? v : UNKNOWN_PAYER;
const loc = (v: unknown) => (typeof v === "string" && v.trim()) ? v : UNKNOWN_LOC;

function sliceFromMap(m: Map<string, number>): Slice[] {
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function nestedFromRows(rows: Array<{ s: string; k: string }>): { rows: NestedRow[]; keys: string[] } {
  // Group by source, then by inner key (payer or LOC).
  const bySource = new Map<string, Map<string, number>>();
  const keySet = new Set<string>();
  for (const r of rows) {
    if (!bySource.has(r.s)) bySource.set(r.s, new Map());
    const inner = bySource.get(r.s)!;
    inner.set(r.k, (inner.get(r.k) ?? 0) + 1);
    keySet.add(r.k);
  }
  const out: NestedRow[] = [];
  for (const [source, inner] of bySource.entries()) {
    const byKey: Record<string, number> = {};
    let total = 0;
    for (const [k, c] of inner.entries()) { byKey[k] = c; total += c; }
    out.push({ source, byKey, total });
  }
  out.sort((a, b) => b.total - a.total);
  return { rows: out, keys: [...keySet].sort() };
}

async function fetchChartView(range: DateRange, pipeline: PipelineFilter): Promise<ChartViewPayload> {
  // Translate the page-level pipeline filter into the underlying
  // payer_type_group filter on each fact table. "all" means no filter.
  const payerFilter = pipeline === "commercial" ? "Commercial"
    : pipeline === "ahcccs"     ? "AHCCCS"
    : null;

  const applyPayer = <T>(q: T): T => {
    if (!payerFilter) return q;
    // Type assertion needed; the query builder return chain is heavy.
    return (q as any).eq("payer_type_group", payerFilter);
  };

  const [pipeRes, vobRes, admitRes] = await Promise.all([
    applyPayer(
      fact().from("fact_pipeline").select("channel_group, payer_type_group, level_of_care")
        .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
        .range(0, 9999),
    ),
    applyPayer(
      fact().from("fact_vob").select("channel_subgroup, payer_type_group, level_of_care")
        .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`)
        .range(0, 9999),
    ),
    applyPayer(
      fact().from("fact_admit").select("channel_subgroup, payer_type_group, level_of_care")
        .gte("admit_date", range.from).lte("admit_date", range.to)
        .range(0, 9999),
    ),
  ]);

  // fact_vob and fact_admit lack a channel_group column; resolve via
  // dim_source so we can roll up to source category. Pull it once.
  const dimRes = await fact().from("fact_pipeline").select("channel_group, channel_subgroup")
    .not("channel_group", "is", null).limit(2000);
  const subToGroup = new Map<string, string>();
  for (const r of (dimRes.data ?? []) as Array<{ channel_group: string; channel_subgroup: string }>) {
    if (r.channel_subgroup && r.channel_group && !subToGroup.has(r.channel_subgroup)) {
      subToGroup.set(r.channel_subgroup, r.channel_group);
    }
  }
  const groupForSub = (sub: unknown): string => {
    if (typeof sub !== "string" || !sub.trim()) return UNKNOWN_SOURCE;
    return subToGroup.get(sub) ?? UNKNOWN_SOURCE;
  };

  // ── Leads ──
  type Row = { channel_group?: unknown; channel_subgroup?: unknown; payer_type_group?: unknown; level_of_care?: unknown };
  const leads = (pipeRes.data ?? []) as Row[];
  const vobs  = (vobRes.data  ?? []) as Row[];
  const admits = (admitRes.data ?? []) as Row[];

  const leadsBySourceMap = new Map<string, number>();
  const leadsSourcePayer: Array<{ s: string; k: string }> = [];
  const leadsSourceLoc:   Array<{ s: string; k: string }> = [];
  for (const r of leads) {
    const s = src(r.channel_group);
    leadsBySourceMap.set(s, (leadsBySourceMap.get(s) ?? 0) + 1);
    leadsSourcePayer.push({ s, k: pay(r.payer_type_group) });
    leadsSourceLoc.push  ({ s, k: loc(r.level_of_care) });
  }

  // ── VOBs ── (resolve subgroup → group)
  const vobsBySourceMap = new Map<string, number>();
  const vobsSourcePayer: Array<{ s: string; k: string }> = [];
  const vobsSourceLoc:   Array<{ s: string; k: string }> = [];
  for (const r of vobs) {
    const s = groupForSub(r.channel_subgroup);
    vobsBySourceMap.set(s, (vobsBySourceMap.get(s) ?? 0) + 1);
    vobsSourcePayer.push({ s, k: pay(r.payer_type_group) });
    vobsSourceLoc.push  ({ s, k: loc(r.level_of_care) });
  }

  // ── Admits ──
  const admitsBySourceMap = new Map<string, number>();
  const admitsSourcePayer: Array<{ s: string; k: string }> = [];
  const admitsSourceLoc:   Array<{ s: string; k: string }> = [];
  for (const r of admits) {
    const s = groupForSub(r.channel_subgroup);
    admitsBySourceMap.set(s, (admitsBySourceMap.get(s) ?? 0) + 1);
    admitsSourcePayer.push({ s, k: pay(r.payer_type_group) });
    admitsSourceLoc.push  ({ s, k: loc(r.level_of_care) });
  }

  const leadsSP = nestedFromRows(leadsSourcePayer);
  const leadsSL = nestedFromRows(leadsSourceLoc);
  const vobsSP  = nestedFromRows(vobsSourcePayer);
  const vobsSL  = nestedFromRows(vobsSourceLoc);
  const admitsSP = nestedFromRows(admitsSourcePayer);
  const admitsSL = nestedFromRows(admitsSourceLoc);

  // Union the dimension keys across all three fact tables so legends
  // stay stable when flipping pipeline filter.
  const payerKeys = [...new Set([...leadsSP.keys, ...vobsSP.keys, ...admitsSP.keys])].sort();
  const locKeys   = [...new Set([...leadsSL.keys, ...vobsSL.keys, ...admitsSL.keys])].sort();
  const sourceKeys = [...new Set([
    ...leadsBySourceMap.keys(),
    ...vobsBySourceMap.keys(),
    ...admitsBySourceMap.keys(),
  ])].sort();

  return {
    totals: { leads: leads.length, vobs: vobs.length, admits: admits.length },
    leadsBySource: sliceFromMap(leadsBySourceMap),
    leadsBySourceByPayer: leadsSP.rows,
    leadsBySourceByLoc:   leadsSL.rows,
    vobsBySource: sliceFromMap(vobsBySourceMap),
    vobsBySourceByPayer: vobsSP.rows,
    vobsBySourceByLoc:   vobsSL.rows,
    admitsBySource: sliceFromMap(admitsBySourceMap),
    admitsBySourceByPayer: admitsSP.rows,
    admitsBySourceByLoc:   admitsSL.rows,
    payerKeys,
    locKeys,
    sourceKeys,
  };
}

export function useChartView(range: DateRange, pipeline: PipelineFilter) {
  return useQuery({
    queryKey: ["analytics-warehouse", "chart-view", range.from, range.to, pipeline],
    queryFn: () => fetchChartView(range, pipeline),
    staleTime: 5 * 60_000,
  });
}
