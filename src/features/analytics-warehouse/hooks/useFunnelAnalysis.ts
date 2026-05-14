import { useQuery } from "@tanstack/react-query";
import { fact } from "../api/client";
import type { DateRange } from "../api/types";

const STAGES: { key: string; label: string }[] = [
  { key: "lead_created",    label: "Lead Created" },
  { key: "connected_ftc",   label: "Connected / FTC" },
  { key: "qualified",       label: "Qualified" },
  { key: "vob_in_progress", label: "VOB In Progress" },
  { key: "vob_approved",    label: "VOB Approved" },
  { key: "admit_scheduled", label: "Admit Scheduled" },
  { key: "closed_admitted", label: "Closed Admitted" },
];

export interface StuckRow {
  pipeline_id: number;
  first_name: string | null;
  last_initial: string | null;
  stage_key: string | null;
  days_in_current_stage: number | null;
  rep_key: string | null;
}

export interface AgingRow extends StuckRow {
  payer_type_group: string | null;
  channel_group: string | null;
  level_of_care: string | null;
  open_age_days: number | null;
}

export interface FunnelAnalysis {
  stages: { stageKey: string; label: string; count: number; isStuck?: boolean }[];
  conversions: { from: string; to: string; pct: number | null }[];
  cohort: { leadToAdmit: number | null; medianDays: number | null; cohortMonth: string };
  stuck: StuckRow[];
  aging: AgingRow[];
  lost: { reason: string; count: number }[];
  counts: { missingInsurance: number; stuckTotal: number };
}

// Lightweight HEAD counter — used in parallel for each stage instead of
// pulling every fact_pipeline row in the window (a 20k-row select would
// drop columns into our 8s statement_timeout window when YTD is selected).
function countInRange(range: DateRange, stageKey: string) {
  return fact().from("fact_pipeline").select("*", { count: "exact", head: true })
    .eq("stage_key", stageKey)
    .gte("lead_created_time", range.from)
    .lte("lead_created_time", `${range.to}T23:59:59`);
}

async function fetchFunnel(range: DateRange): Promise<FunnelAnalysis> {
  const cohortMonth = range.from.slice(0, 7);

  const [
    stageCountResults,
    stuckTotalRes,
    missingInsuranceRes,
    closedLostRes,
    cohortLeadsRes,
    cohortAdmitsRes,
    admittedRes,
    stuckRes,
    agingRes,
  ] = await Promise.all([
    Promise.all(STAGES.map((s) => countInRange(range, s.key))),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .eq("is_stuck", true),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .is("insurance_type_raw", null)
      .eq("is_closed", false),
    fact().from("fact_pipeline").select("close_reason")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .eq("stage_key", "closed_lost")
      .not("close_reason", "is", null)
      .limit(1000),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .eq("cohort_month", cohortMonth),
    fact().from("fact_pipeline").select("*", { count: "exact", head: true })
      .eq("cohort_month", cohortMonth).eq("is_won", true),
    fact().from("fact_admit").select("admit_date, lead_created_time")
      .gte("admit_date", range.from).lte("admit_date", range.to)
      .not("lead_created_time", "is", null)
      .limit(2000),
    fact().from("fact_pipeline").select(
      "pipeline_id, first_name, last_initial, stage_key, days_in_current_stage, rep_key, open_age_days",
    )
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .eq("is_stuck", true)
      .order("days_in_current_stage", { ascending: false, nullsFirst: false })
      .limit(10),
    fact().from("fact_pipeline").select(
      "pipeline_id, first_name, last_initial, stage_key, open_age_days, days_in_current_stage, payer_type_group, channel_group, level_of_care, rep_key",
    )
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
      .eq("is_closed", false)
      .order("days_in_current_stage", { ascending: false, nullsFirst: false })
      .limit(50),
  ]);

  // Surface the first error from any of the queries so the page can show
  // something actionable instead of an indefinite loading state.
  const allResults = [
    ...stageCountResults, stuckTotalRes, missingInsuranceRes, closedLostRes,
    cohortLeadsRes, cohortAdmitsRes, admittedRes, stuckRes, agingRes,
  ];
  const firstError = allResults.find((r) => r.error);
  if (firstError?.error) throw new Error(firstError.error.message);

  const stages = STAGES.map((s, i) => ({
    stageKey: s.key,
    label: s.label,
    count: stageCountResults[i].count ?? 0,
  }));
  stages.push({ stageKey: "stuck", label: "Stuck", count: stuckTotalRes.count ?? 0, isStuck: true });

  const conversions: { from: string; to: string; pct: number | null }[] = [];
  for (let i = 0; i < STAGES.length - 1; i++) {
    const a = stageCountResults[i].count ?? 0;
    const b = stageCountResults[i + 1].count ?? 0;
    conversions.push({ from: STAGES[i].key, to: STAGES[i + 1].key, pct: a > 0 ? b / a : null });
  }

  const days: number[] = [];
  for (const r of admittedRes.data ?? []) {
    if (!r.lead_created_time || !r.admit_date) continue;
    const d = (new Date(r.admit_date).getTime() - new Date(r.lead_created_time).getTime()) / 86_400_000;
    if (Number.isFinite(d) && d >= 0) days.push(Math.floor(d));
  }
  days.sort((a, b) => a - b);
  const medianDays = days.length > 0 ? days[Math.floor(days.length / 2)] : null;

  const cohortLeads  = cohortLeadsRes.count ?? 0;
  const cohortAdmits = cohortAdmitsRes.count ?? 0;
  const leadToAdmit  = cohortLeads > 0 ? cohortAdmits / cohortLeads : null;

  const closeReasons = new Map<string, number>();
  for (const r of closedLostRes.data ?? []) {
    const reason = (r.close_reason as string | null) ?? "Unknown";
    closeReasons.set(reason, (closeReasons.get(reason) ?? 0) + 1);
  }
  const lost = [...closeReasons.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({ reason, count }));

  return {
    stages,
    conversions,
    cohort: { leadToAdmit, medianDays, cohortMonth },
    stuck: (stuckRes.data ?? []) as StuckRow[],
    aging: (agingRes.data ?? []) as AgingRow[],
    lost,
    counts: {
      missingInsurance: missingInsuranceRes.count ?? 0,
      stuckTotal: stuckTotalRes.count ?? 0,
    },
  };
}

export function useFunnelAnalysis(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "funnel", range.from, range.to],
    queryFn: () => fetchFunnel(range),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
