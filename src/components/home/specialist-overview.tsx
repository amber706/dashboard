// SpecialistOverview — the 13-metric headline KPI grid at the top of
// the Admissions home page.
//
// Data: GET /functions/v1/specialist-dashboard (one fan-out call that
// returns every metric in a single payload — see edge function for
// shape).
//
// Layout (top to bottom):
//   Row 1: small tiles · inbound · outbound · missed · callbacks
//          waiting
//   Row 2: medium tiles · admits today (LOC breakdown chip row) ·
//          scheduled next 24h (LOC breakdown chip row)
//   Row 3: 3-column LOC table · open leads MTD · VOBs MTD · admits MTD
//   Row 4: small tiles · open tasks · avg callback time · avg QA score
//          · pipeline open total
//   Row 5: pipeline by stage — horizontal stacked bar
//
// Auto-refreshes every 60s so the wall display stays current without
// the rep having to reload.

import { useCallback, useEffect, useState } from "react";
import {
  PhoneIncoming, PhoneOutgoing, PhoneOff, Phone, CheckCircle2,
  Clock, Award, ListChecks, TrendingUp, RefreshCw, Loader2,
  Calendar as CalendarIcon, Hospital,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SpecialistDashboardResponse {
  ok: boolean;
  generated_at: string;
  call_volume: { inbound_today: number; outbound_today: number; missed_today: number };
  admits: {
    today_by_loc: Record<string, number>;
    today_total: number;
    scheduled_next_24h_by_loc: Record<string, number>;
    scheduled_next_24h_total: number;
    mtd_by_loc: Record<string, number>;
    mtd_total: number;
  };
  leads: { open_mtd_by_loc: Record<string, number>; open_mtd_total: number };
  vobs: { mtd_by_loc: Record<string, number>; mtd_total: number };
  pipeline: { by_stage: Record<string, number>; open_total: number };
  tasks: { open_total: number };
  callbacks: { waiting: number; avg_callback_time_seconds: number | null };
  qa: { avg_score_30d: number | null; n_scored_30d: number };
}

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
function scoreTone(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-500";
  if (n >= 60) return "text-amber-500";
  return "text-rose-500";
}

// Stable palette so the same LOC always renders the same color across
// tiles. Falls back to a neutral grey for new picklist values.
const LOC_TONE: Record<string, string> = {
  "Detox":               "border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-500/5",
  "Residential":         "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5",
  "PHP":                 "border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/5",
  "IOP":                 "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5",
  "OP":                  "border-teal-500/40 text-teal-700 dark:text-teal-300 bg-teal-500/5",
  "Sober Living":        "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5",
  "(unspecified)":       "border-muted-foreground/30 text-muted-foreground bg-muted/30",
};
function locTone(loc: string): string {
  return LOC_TONE[loc] ?? "border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/5";
}

export function SpecialistOverview() {
  const [data, setData] = useState<SpecialistDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/specialist-dashboard`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: "{}",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 60s auto-refresh so the headline stays live without manual reload.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="rounded-xl border bg-card px-6 py-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading today's numbers…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-4 text-sm text-rose-600 dark:text-rose-400">
        Couldn't load dashboard — {error ?? "unknown error"}.
        <Button size="sm" variant="ghost" onClick={load} className="ml-2 h-7 text-xs">Retry</Button>
      </div>
    );
  }

  const cv = data.call_volume;
  const updated = new Date(data.generated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today at a glance</div>
        <div className="text-[10px] text-muted-foreground ml-auto inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          updated {updated}
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="h-6 px-2 gap-1 text-[11px]">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Row 1 — call volume tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi icon={<PhoneIncoming className="w-4 h-4 text-blue-500" />}    label="Inbound today"   value={cv.inbound_today} />
        <Kpi icon={<PhoneOutgoing className="w-4 h-4 text-violet-500" />}  label="Outbound today"  value={cv.outbound_today} />
        <Kpi icon={<PhoneOff className="w-4 h-4 text-rose-500" />}         label="Missed today"    value={cv.missed_today} tone={cv.missed_today > 0 ? "warn" : undefined} />
        <Kpi icon={<Phone className="w-4 h-4 text-amber-500" />}           label="Callbacks waiting" value={data.callbacks.waiting} tone={data.callbacks.waiting > 0 ? "warn" : undefined} />
      </div>

      {/* Row 2 — admits today + scheduled next 24h */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <BigKpi
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          label="Admits today"
          total={data.admits.today_total}
          byLoc={data.admits.today_by_loc}
          subtitle="Stage = Admitted · Admit Date = today (Phoenix)"
        />
        <BigKpi
          icon={<CalendarIcon className="w-5 h-5 text-blue-500" />}
          label="Scheduled next 24h"
          total={data.admits.scheduled_next_24h_total}
          byLoc={data.admits.scheduled_next_24h_by_loc}
          subtitle="Potential Admit Date inside the next 24h"
        />
      </div>

      {/* Row 3 — MTD by LOC table (open leads / VOBs / admits) */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
              <Hospital className="w-3.5 h-3.5" /> Month to date · by level of care
            </div>
            <div className="text-[10px] text-muted-foreground">
              Open leads: {data.leads.open_mtd_total} · VOBs: {data.vobs.mtd_total} · Admits: {data.admits.mtd_total}
            </div>
          </div>
          <LocTriple
            openLeads={data.leads.open_mtd_by_loc}
            vobs={data.vobs.mtd_by_loc}
            admits={data.admits.mtd_by_loc}
          />
        </CardContent>
      </Card>

      {/* Row 4 — operational + QA tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi icon={<ListChecks className="w-4 h-4 text-violet-500" />}    label="Open tasks"          value={data.tasks.open_total} />
        <Kpi icon={<Clock className="w-4 h-4 text-amber-500" />}          label="Avg callback time"   value={fmtDuration(data.callbacks.avg_callback_time_seconds)} />
        <Kpi
          icon={<Award className={`w-4 h-4 ${scoreTone(data.qa.avg_score_30d)}`} />}
          label="Avg QA score (30d)"
          value={data.qa.avg_score_30d != null ? data.qa.avg_score_30d.toFixed(1) : "—"}
          sub={data.qa.n_scored_30d > 0 ? `${data.qa.n_scored_30d} scored` : undefined}
        />
        <Kpi icon={<TrendingUp className="w-4 h-4 text-blue-500" />}      label="Pipeline open"       value={data.pipeline.open_total} />
      </div>

      {/* Row 5 — pipeline by stage horizontal bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sales pipeline · by stage</div>
            <div className="text-[10px] text-muted-foreground">{data.pipeline.open_total} open deals (active in last 60d)</div>
          </div>
          <StageBars byStage={data.pipeline.by_stage} />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function Kpi({ icon, label, value, sub, tone }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "warn";
}) {
  const ring = tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : "";
  return (
    <Card className={`border ${ring}`}>
      <CardContent className="pt-3 pb-3 px-3.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="text-2xl font-semibold tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BigKpi({ icon, label, total, byLoc, subtitle }: {
  icon: React.ReactNode;
  label: string;
  total: number;
  byLoc: Record<string, number>;
  subtitle?: string;
}) {
  const locs = Object.entries(byLoc).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <div className="text-sm font-semibold">{label}</div>
          <div className="ml-auto text-2xl font-semibold tabular-nums">{total}</div>
        </div>
        {subtitle && <div className="text-[10px] text-muted-foreground mb-2">{subtitle}</div>}
        {locs.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No records in this window.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {locs.map(([loc, n]) => (
              <Badge key={loc} variant="outline" className={`text-[10px] gap-1.5 ${locTone(loc)}`}>
                <span>{loc}</span>
                <span className="tabular-nums font-semibold">{n}</span>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Per-LOC roll-up table — one row per LOC, three count columns.
function LocTriple({ openLeads, vobs, admits }: {
  openLeads: Record<string, number>;
  vobs: Record<string, number>;
  admits: Record<string, number>;
}) {
  // Union of all LOCs seen in any of the three sources.
  const allLocs = Array.from(new Set([
    ...Object.keys(openLeads),
    ...Object.keys(vobs),
    ...Object.keys(admits),
  ]));
  // Sort by total volume across all three columns so the busiest rows
  // sit at the top.
  allLocs.sort((a, b) => {
    const totalB = (openLeads[b] ?? 0) + (vobs[b] ?? 0) + (admits[b] ?? 0);
    const totalA = (openLeads[a] ?? 0) + (vobs[a] ?? 0) + (admits[a] ?? 0);
    return totalB - totalA;
  });

  if (allLocs.length === 0) {
    return <div className="text-[11px] text-muted-foreground italic">No activity month to date.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="text-left py-1.5 pr-3">Level of care</th>
            <th className="text-right py-1.5 px-3">Open leads</th>
            <th className="text-right py-1.5 px-3">VOBs</th>
            <th className="text-right py-1.5 pl-3">Admits</th>
          </tr>
        </thead>
        <tbody>
          {allLocs.map((loc) => (
            <tr key={loc} className="border-t">
              <td className="py-1.5 pr-3">
                <Badge variant="outline" className={`text-[10px] ${locTone(loc)}`}>{loc}</Badge>
              </td>
              <td className="py-1.5 px-3 text-right tabular-nums">{openLeads[loc] ?? 0}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{vobs[loc] ?? 0}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">{admits[loc] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Pipeline-by-stage — horizontal bars sorted by count desc. Width is
// proportional to the largest stage so visual scanning is easy.
function StageBars({ byStage }: { byStage: Record<string, number> }) {
  const rows = Object.entries(byStage).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) {
    return <div className="text-[11px] text-muted-foreground italic">No open deals in the active window.</div>;
  }
  const max = rows[0][1];
  return (
    <div className="space-y-1.5">
      {rows.map(([stage, n]) => {
        const pct = Math.round((n / max) * 100);
        return (
          <div key={stage} className="grid grid-cols-[160px_1fr_40px] gap-2 items-center">
            <div className="text-[12px] truncate" title={stage}>{stage}</div>
            <div className="h-5 rounded bg-muted/50 overflow-hidden">
              <div
                className="h-full bg-primary/70"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-right tabular-nums">{n}</div>
          </div>
        );
      })}
    </div>
  );
}
