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

async function fetchFunnel(range: DateRange): Promise<FunnelAnalysis> {
  const cohortMonth = range.from.slice(0, 7);

  const [pipelineRes, cohortLeadsRes, cohortAdmitsRes, admittedRes, stuckRes, agingRes] =
    await Promise.all([
      fact().from("fact_pipeline").select(
        "stage_key, is_stuck, is_closed, close_reason, insurance_type_raw, days_in_current_stage",
      )
        .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
      fact().from("fact_pipeline").select("*", { count: "exact", head: true })
        .eq("cohort_month", cohortMonth),
      fact().from("fact_pipeline").select("*", { count: "exact", head: true })
        .eq("cohort_month", cohortMonth).eq("is_won", true),
      fact().from("fact_pipeline").select("lead_created_time, admit_date")
        .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`)
        .eq("is_won", true),
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

  const pipeline = pipelineRes.data ?? [];
  const counts = new Map<string, number>();
  let stuckTotal = 0;
  let missingInsurance = 0;
  const closeReasons = new Map<string, number>();
  for (const r of pipeline) {
    if (r.stage_key) counts.set(r.stage_key, (counts.get(r.stage_key) ?? 0) + 1);
    if (r.is_stuck) stuckTotal += 1;
    if (r.stage_key !== "closed_admitted" && r.stage_key !== "closed_lost" && !r.insurance_type_raw) {
      missingInsurance += 1;
    }
    if (r.stage_key === "closed_lost" && r.close_reason) {
      closeReasons.set(r.close_reason, (closeReasons.get(r.close_reason) ?? 0) + 1);
    }
  }

  const stages = STAGES.map((s) => ({ stageKey: s.key, label: s.label, count: counts.get(s.key) ?? 0 }));
  stages.push({ stageKey: "stuck", label: "Stuck", count: stuckTotal, isStuck: true } as never);

  const conversions: { from: string; to: string; pct: number | null }[] = [];
  for (let i = 0; i < STAGES.length - 1; i++) {
    const a = counts.get(STAGES[i].key) ?? 0;
    const b = counts.get(STAGES[i + 1].key) ?? 0;
    conversions.push({ from: STAGES[i].key, to: STAGES[i + 1].key, pct: a > 0 ? b / a : null });
  }

  const days: number[] = [];
  for (const r of admittedRes.data ?? []) {
    if (!r.lead_created_time || !r.admit_date) continue;
    const d = (new Date(r.admit_date).getTime() - new Date(r.lead_created_time).getTime()) / 86_400_000;
    if (Number.isFinite(d)) days.push(Math.floor(d));
  }
  days.sort((a, b) => a - b);
  const medianDays = days.length > 0 ? days[Math.floor(days.length / 2)] : null;

  const cohortLeads  = cohortLeadsRes.count ?? 0;
  const cohortAdmits = cohortAdmitsRes.count ?? 0;
  const leadToAdmit  = cohortLeads > 0 ? cohortAdmits / cohortLeads : null;

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
    counts: { missingInsurance, stuckTotal },
  };
}

export function useFunnelAnalysis(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "funnel", range.from, range.to],
    queryFn: () => fetchFunnel(range),
    staleTime: 5 * 60_000,
  });
}
