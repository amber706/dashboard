import { useQuery } from "@tanstack/react-query";
import { fact, dim } from "../api/client";
import type { DateRange } from "../api/types";

export interface RepScorecard {
  rep_key: string;
  display_name: string;
  role: string | null;
  leads: number;
  vobs: number;
  admits: number;
  convPct: number | null;
  avgDaysToClose: number | null;
  lost: number;
  meetings: number;
  stuckOwned: number;
  stageCounts: Record<string, number>;
}

export interface TeamPerformancePayload {
  reps: RepScorecard[];
  avgConv: number;
  avgStuck: number;
}

async function fetchTeam(range: DateRange): Promise<TeamPerformancePayload> {
  const [repsRes, pipeRes, vobRes, admitRes, meetRes] = await Promise.all([
    dim().from("dim_rep").select("rep_key, rep_display_name, rep_role").eq("is_active", true),
    fact().from("fact_pipeline").select("rep_key, stage_key, is_won, is_closed, is_stuck, lead_created_time, admit_date")
      .gte("lead_created_time", range.from).lte("lead_created_time", `${range.to}T23:59:59`),
    fact().from("fact_vob").select("rep_key")
      .gte("vob_submitted_date", range.from).lte("vob_submitted_date", `${range.to}T23:59:59`),
    fact().from("fact_admit").select("rep_key")
      .gte("admit_date", range.from).lte("admit_date", range.to),
    fact().from("fact_meeting").select("rep_key")
      .gte("meeting_date", range.from).lte("meeting_date", `${range.to}T23:59:59`),
  ]);

  const board: Record<string, RepScorecard> = {};
  for (const r of repsRes.data ?? []) {
    board[r.rep_key] = {
      rep_key: r.rep_key, display_name: r.rep_display_name, role: r.rep_role,
      leads: 0, vobs: 0, admits: 0, convPct: null,
      avgDaysToClose: null, lost: 0, meetings: 0, stuckOwned: 0, stageCounts: {},
    };
  }

  const ageDays: Record<string, number[]> = {};
  for (const r of pipeRes.data ?? []) {
    const k = r.rep_key as string | null;
    if (!k || !board[k]) continue;
    board[k].leads += 1;
    if (r.stage_key) board[k].stageCounts[r.stage_key] = (board[k].stageCounts[r.stage_key] ?? 0) + 1;
    if (r.is_stuck) board[k].stuckOwned += 1;
    if (r.is_closed && !r.is_won) board[k].lost += 1;
    if (r.is_won && r.admit_date && r.lead_created_time) {
      const d = (new Date(r.admit_date).getTime() - new Date(r.lead_created_time).getTime()) / 86_400_000;
      if (Number.isFinite(d)) (ageDays[k] ??= []).push(d);
    }
  }
  for (const r of vobRes.data ?? [])   { const k = r.rep_key as string | null; if (k && board[k]) board[k].vobs += 1; }
  for (const r of admitRes.data ?? []) { const k = r.rep_key as string | null; if (k && board[k]) board[k].admits += 1; }
  for (const r of meetRes.data ?? [])  { const k = r.rep_key as string | null; if (k && board[k]) board[k].meetings += 1; }

  for (const k of Object.keys(board)) {
    const b = board[k];
    b.convPct = b.leads > 0 ? b.admits / b.leads : null;
    const d = ageDays[k];
    b.avgDaysToClose = d && d.length > 0 ? Math.round(d.reduce((s, x) => s + x, 0) / d.length) : null;
  }

  const reps = Object.values(board)
    .filter((b) => b.leads + b.admits + b.vobs + b.meetings > 0)
    .sort((a, b) => b.admits - a.admits || (b.convPct ?? 0) - (a.convPct ?? 0));
  const avgConv  = reps.reduce((s, r) => s + (r.convPct ?? 0), 0) / Math.max(1, reps.length);
  const avgStuck = reps.reduce((s, r) => s + r.stuckOwned, 0) / Math.max(1, reps.length);

  return { reps, avgConv, avgStuck };
}

export function useTeamPerformance(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-warehouse", "team", range.from, range.to],
    queryFn: () => fetchTeam(range),
    staleTime: 5 * 60_000,
  });
}
