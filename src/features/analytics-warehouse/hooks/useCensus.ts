import { useQuery } from "@tanstack/react-query";
import { fact, dim, app } from "../api/client";

export interface GaugeRow {
  program_key: string;
  label: string;
  filled: number;
  total: number;
  site: string | null;
  is_virtual: boolean;
}

export interface RiskRow {
  program_key: string;
  label: string;
  available: number;
  projected: number;
  status: "Healthy" | "Below Target" | "Under-Utilized";
}

export interface CensusPayload {
  gauges: GaugeRow[];
  riskTable: RiskRow[];
  trend: Record<string, string | number>[];
  programKeys: string[];
  latestTs: string | null;
}

async function fetchCensus(): Promise<CensusPayload> {
  const [progRes, liveRes, capRes, adcRes, freshRes, recentAdmitsRes] = await Promise.all([
    dim().from("dim_program")
      .select("program_key, display_label, level_of_care, licensed_capacity, is_virtual, site")
      .order("sort_order"),
    fact().from("fact_census").select("program_key, filled, snapshot_date, level_of_care").eq("source_tab", "live_adc"),
    fact().from("fact_census").select("program_key, filled, total_capacity, house, level_of_care").eq("source_tab", "capacity_tracker"),
    fact().from("fact_census").select("month_key, program_key, level_of_care, avg_daily_census")
      .eq("source_tab", "adc_tracking").order("month_key"),
    app().from("data_freshness").select("tab_key, last_ingested_at").eq("is_census", true).order("last_ingested_at", { ascending: false }),
    fact().from("fact_admit").select("program_key, admit_date")
      .gte("admit_date", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
  ]);

  const programs = (progRes.data ?? []).filter((p) => !["dui", "dv", "other"].includes(p.program_key));
  const liveRows = liveRes.data ?? [];
  const capRows  = capRes.data ?? [];
  const adcRows  = adcRes.data ?? [];

  const gauges: GaugeRow[] = programs.map((p) => {
    const live = liveRows.filter((l) => l.program_key === p.program_key);
    const cap  = capRows.filter((c) => c.program_key === p.program_key);
    const filled = live.reduce((s, l) => s + (l.filled ?? 0), 0) || cap.reduce((s, c) => s + (c.filled ?? 0), 0);
    const total  = cap.reduce((s, c) => s + (c.total_capacity ?? 0), 0) || p.licensed_capacity || 0;
    return { program_key: p.program_key, label: p.display_label, filled, total, site: p.site, is_virtual: p.is_virtual };
  });

  const admitPace: Record<string, number> = {};
  for (const r of recentAdmitsRes.data ?? []) {
    const k = r.program_key as string | null;
    if (k) admitPace[k] = (admitPace[k] ?? 0) + 1;
  }
  const riskTable: RiskRow[] = gauges.map((g) => {
    const projected = admitPace[g.program_key] ?? 0;
    const available = Math.max(0, g.total - g.filled);
    const status: RiskRow["status"] =
      projected >= available ? "Healthy"
      : projected >= available * 0.7 ? "Below Target"
      : "Under-Utilized";
    return { program_key: g.program_key, label: g.label, available, projected, status };
  });

  const months = [...new Set(adcRows.map((r) => r.month_key))].filter(Boolean) as string[];
  const programKeys = [...new Set(adcRows.map((r) => r.program_key))];
  const trend = months.sort().map((m) => {
    const out: Record<string, string | number> = {
      month: new Date(`${m}-01`).toLocaleDateString("en-US", { month: "short" }),
    };
    for (const pk of programKeys) {
      const row = adcRows.find((r) => r.month_key === m && r.program_key === pk);
      out[pk] = Number(row?.avg_daily_census ?? 0);
    }
    return out;
  });

  return {
    gauges, riskTable, trend, programKeys,
    latestTs: freshRes.data?.[0]?.last_ingested_at ?? null,
  };
}

export function useCensus() {
  return useQuery({
    queryKey: ["analytics-warehouse", "census"],
    queryFn: fetchCensus,
    staleTime: 5 * 60_000,
  });
}
