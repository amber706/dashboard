import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type {
  DateRange, ExecutiveSnapshot, MonthlySeries, PayerRow, StageCount,
} from "../api/types";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "lead_created",    label: "Leads Created" },
  { key: "connected_ftc",   label: "Connected/FTC" },
  { key: "vob_in_progress", label: "VOB In Progress" },
  { key: "vob_approved",    label: "VOB Approved" },
  { key: "admit_scheduled", label: "Admit Scheduled" },
  { key: "closed_admitted", label: "Closed Admitted" },
];

async function fetchExecutiveSnapshot(range: DateRange): Promise<ExecutiveSnapshot> {
  const fromDt = new Date(range.from);
  const toDt   = new Date(range.to);
  const span   = toDt.getTime() - fromDt.getTime();
  const priorFrom = isoDate(new Date(fromDt.getTime() - span - 86_400_000));
  const priorTo   = isoDate(new Date(fromDt.getTime() - 86_400_000));

  const now = new Date();
  const start8 = isoDate(new Date(now.getFullYear(), now.getMonth() - 7, 1));
  const start6 = isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 1));

  // Run independent queries in parallel.
  const [
    leadsRes, leadsPriorRes,
    admitsRes, admitsDigitalRes, admitsBdRes, admitsPriorRes,
    censusRes,
    vobApprovedRes, vobCompletedRes,
    trendRes, stageRes, payerTrendRes,
  ] = await Promise.all([
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .gte("lead_created_time", priorFrom).lte("lead_created_time", `${priorTo}T23:59:59`),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to).eq("is_digital", true),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", range.from).lte("admit_date", range.to).eq("channel_group", "BD Referral"),
    fact().from("fact_admit").select("*", { count: "exact", head: true })
      .gte("admit_date", priorFrom).lte("admit_date", priorTo),
    fact().from("fact_census").select("program_key, filled, level_of_care").eq("source_tab", "live_adc"),
    fact().from("fact_vob").select("*", { count: "exact", head: true })
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`)
      .not("vob_approved_date", "is", null),
    fact().from("fact_vob").select("*", { count: "exact", head: true })
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`)
      .not("vob_completed_date", "is", null),
    fact().from("fact_admit").select("admit_date, channel_group").gte("admit_date", start8),
    fact().from("fact_pipeline").select("stage_key, is_stuck"),
    fact().from("fact_admit").select("admit_date, payer_type_group").gte("admit_date", start6),
  ]);

  // KPI counts.
  const newLeads      = leadsRes.count ?? 0;
  const newLeadsPrior = leadsPriorRes.count ?? 0;
  const admits        = admitsRes.count ?? 0;
  const admitsDigital = admitsDigitalRes.count ?? 0;
  const admitsBd      = admitsBdRes.count ?? 0;
  const admitsPrior   = admitsPriorRes.count ?? 0;
  const vobApproved   = vobApprovedRes.count ?? 0;
  const vobCompleted  = vobCompletedRes.count ?? 0;

  // Census aggregation.
  const census = censusRes.data ?? [];
  const activeCensus  = census.reduce((s, r) => s + (Number(r.filled) || 0), 0);
  const virtualCensus = census
    .filter((r) => String(r.level_of_care ?? "").toUpperCase().startsWith("VIOP"))
    .reduce((s, r) => s + (Number(r.filled) || 0), 0);
  const inPersonCensus = activeCensus - virtualCensus;

  // 8-month admit trend (digital vs BD).
  const trendBucket: Record<string, { digital: number; bd: number }> = {};
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 7 + i, 1);
    trendBucket[d.toISOString().slice(0, 7)] = { digital: 0, bd: 0 };
  }
  const thisMk = now.toISOString().slice(0, 7);
  for (const r of trendRes.data ?? []) {
    const mk = String(r.admit_date).slice(0, 7);
    if (!trendBucket[mk]) continue;
    if (r.channel_group === "BD Referral") trendBucket[mk].bd += 1;
    else trendBucket[mk].digital += 1;
  }
  const trend: MonthlySeries[] = Object.entries(trendBucket).map(([m, v]) => ({
    month: new Date(`${m}-01`).toLocaleDateString("en-US", { month: "short" }),
    digital: v.digital,
    bd: v.bd,
    isCurrent: m === thisMk,
  }));

  // Funnel health.
  const stageMap = new Map<string, number>();
  let stuckTotal = 0;
  for (const r of stageRes.data ?? []) {
    if (r.is_stuck) stuckTotal += 1;
    const key = String(r.stage_key ?? "_unknown");
    stageMap.set(key, (stageMap.get(key) ?? 0) + 1);
  }
  const funnel: StageCount[] = STAGE_ORDER.map((s) => ({
    stageKey: s.key, label: s.label, count: stageMap.get(s.key) ?? 0,
  }));
  funnel.push({ stageKey: "stuck", label: "Stuck", count: stuckTotal, isStuck: true });

  // Payer trend (6mo).
  const payerBucket: Record<string, PayerRow> = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    payerBucket[d.toISOString().slice(0, 7)] = {
      month: d.toLocaleDateString("en-US", { month: "short" }),
      commercial: 0, ahcccs: 0, cash: 0, unknown: 0,
    };
  }
  for (const r of payerTrendRes.data ?? []) {
    const mk = String(r.admit_date).slice(0, 7);
    if (!payerBucket[mk]) continue;
    const p = r.payer_type_group as "Commercial" | "AHCCCS" | "Cash" | "Unknown" | null;
    if (p === "Commercial") payerBucket[mk].commercial += 1;
    else if (p === "AHCCCS") payerBucket[mk].ahcccs += 1;
    else if (p === "Cash")   payerBucket[mk].cash += 1;
    else payerBucket[mk].unknown = (payerBucket[mk].unknown ?? 0) + 1;
  }
  const payerTrend = Object.values(payerBucket);

  // Deltas (period-over-period).
  const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
  const vobRate = vobCompleted > 0 ? vobApproved / vobCompleted : null;

  return {
    range,
    kpis: {
      newLeads: { value: newLeads, delta: delta(newLeads, newLeadsPrior), priorValue: newLeadsPrior },
      admits:   { value: admits,   delta: delta(admits, admitsPrior),     digital: admitsDigital, bd: admitsBd },
      census:   { value: activeCensus, virtual: virtualCensus, inPerson: inPersonCensus },
      vobRate:  { value: vobRate,  approved: vobApproved, completed: vobCompleted },
    },
    trend,
    funnel,
    payerTrend,
  };
}

export function useExecutiveSnapshot(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "executive", range.from, range.to],
    queryFn: () => fetchExecutiveSnapshot(range),
    staleTime: 5 * 60_000,
  });
}
