import { useQuery } from "@tanstack/react-query";
import { fact, dim } from "../api/client";
import type { DateRange } from "../api/types";

type PayerBucket = "AHCCCS" | "Commercial" | "Self-Pay" | "DUI" | "DV";

const PAYER_BUCKETS: PayerBucket[] = ["AHCCCS", "Commercial", "Self-Pay", "DUI", "DV"];

const bucketPayer = (group: string | null | undefined, raw: string | null | undefined): PayerBucket => {
  // Prefer the warehouse-canonical payer_type_group (set by the ETL using
  // DUI_or_Treatment + Insurance_Type). Fall back to raw insurance string.
  if (group === "DUI") return "DUI";
  if (group === "DV")  return "DV";
  if (group === "AHCCCS") return "AHCCCS";
  if (group === "Commercial") return "Commercial";
  if (group === "Cash") return "Self-Pay";

  if (!raw) return "Self-Pay";
  const v = raw.toLowerCase();
  if (v.includes("ahcccs") || v.includes("medicaid")) return "AHCCCS";
  if (v.includes("commercial") || v.includes("insurance") || v.includes("private") ||
      v.includes("bcbs") || v.includes("aetna") || v.includes("cigna") || v.includes("united")) return "Commercial";
  return "Self-Pay";
};

export interface RepRow {
  rep_key: string;
  display_name: string;
  role: string | null;
  leads: number;
  vobs: number;
  admits: number;
  byPayer: Record<PayerBucket, { leads: number; vobs: number; admits: number }>;
}

export interface RepMetricsPayload {
  totals: { leads: number; admits: number; rate: number | null };
  admitReps: RepRow[];
  bdReps: RepRow[];
  funnel: { payer: PayerBucket; leads: number; vobs: number; admits: number }[];
}

const newRow = (rep_key: string, display_name: string, role: string | null): RepRow => ({
  rep_key, display_name, role,
  leads: 0, vobs: 0, admits: 0,
  byPayer: {
    AHCCCS:     { leads: 0, vobs: 0, admits: 0 },
    Commercial: { leads: 0, vobs: 0, admits: 0 },
    "Self-Pay": { leads: 0, vobs: 0, admits: 0 },
    DUI:        { leads: 0, vobs: 0, admits: 0 },
    DV:         { leads: 0, vobs: 0, admits: 0 },
  },
});

async function fetchRepMetrics(range: DateRange): Promise<RepMetricsPayload> {
  const [repsRes, pipeRes, vobRes, admitRes] = await Promise.all([
    dim().from("dim_rep").select("rep_key, rep_display_name, rep_role").eq("is_active", true),
    fact().from("fact_pipeline").select("rep_key, bd_rep_key, payer_type_group, insurance_type_raw")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
    fact().from("fact_vob").select("rep_key, bd_rep_key, payer_type_group, insurance_type_raw")
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`),
    fact().from("fact_admit").select("rep_key, bd_rep_key, payer_type_group, insurance_type_raw")
      .gte("admit_date", range.from).lte("admit_date", range.to),
  ]);

  const board: Record<string, RepRow> = {};
  const bdBoard: Record<string, RepRow> = {};
  for (const r of repsRes.data ?? []) {
    board[r.rep_key]   = newRow(r.rep_key, r.rep_display_name, r.rep_role);
    bdBoard[r.rep_key] = newRow(r.rep_key, r.rep_display_name, r.rep_role);
  }

  const funnel: Record<PayerBucket, { payer: PayerBucket; leads: number; vobs: number; admits: number }> = {
    AHCCCS:     { payer: "AHCCCS",     leads: 0, vobs: 0, admits: 0 },
    Commercial: { payer: "Commercial", leads: 0, vobs: 0, admits: 0 },
    "Self-Pay": { payer: "Self-Pay",   leads: 0, vobs: 0, admits: 0 },
    DUI:        { payer: "DUI",        leads: 0, vobs: 0, admits: 0 },
    DV:         { payer: "DV",         leads: 0, vobs: 0, admits: 0 },
  };

  const credit = (metric: "leads" | "vobs" | "admits", rec: Record<string, unknown>) => {
    const p = bucketPayer(rec.payer_type_group as string | null, rec.insurance_type_raw as string | null);
    funnel[p][metric] += 1;
    const ak = rec.rep_key as string | null;
    if (ak && board[ak]) {
      board[ak][metric] += 1;
      board[ak].byPayer[p][metric] += 1;
    }
    const bk = rec.bd_rep_key as string | null;
    if (bk && bdBoard[bk]) {
      bdBoard[bk][metric] += 1;
      bdBoard[bk].byPayer[p][metric] += 1;
    }
  };

  for (const r of pipeRes.data  ?? []) credit("leads",  r as Record<string, unknown>);
  for (const r of vobRes.data   ?? []) credit("vobs",   r as Record<string, unknown>);
  for (const r of admitRes.data ?? []) credit("admits", r as Record<string, unknown>);

  const totalLeads  = pipeRes.data?.length ?? 0;
  const totalAdmits = admitRes.data?.length ?? 0;
  const overallRate = totalLeads > 0 ? totalAdmits / totalLeads : null;

  const admitReps = Object.values(board).filter((b) => b.leads + b.admits + b.vobs > 0)
    .sort((a, b) => b.admits - a.admits);
  const bdReps = Object.values(bdBoard).filter((b) => b.leads + b.admits + b.vobs > 0)
    .sort((a, b) => b.admits - a.admits);

  return {
    totals: { leads: totalLeads, admits: totalAdmits, rate: overallRate },
    admitReps, bdReps,
    funnel: PAYER_BUCKETS.map((k) => funnel[k]),
  };
}

export function useRepMetrics(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "rep-metrics", range.from, range.to],
    queryFn: () => fetchRepMetrics(range),
    staleTime: 5 * 60_000,
  });
}
