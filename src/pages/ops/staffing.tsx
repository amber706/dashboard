import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Calendar, Loader2, RefreshCw, Users, Phone, AlertTriangle, Download,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-export";
import { logAudit } from "@/lib/audit";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CallRow {
  started_at: string;
  status: string;
  direction: string | null;
}

interface SlotStat {
  day: number;        // 0 = Sunday
  hour: number;       // 0-23
  weeks: number;      // distinct weeks observed (denominator)
  total_calls: number;
  avg_calls: number;
  missed_rate: number;
  recommended_staff: number;
}

export default function OpsStaffing() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);
  // Tuning knobs the manager can play with — live recompute.
  const [callsPerSpecialistPerHour, setCallsPerSpecialistPerHour] = useState<number>(6);
  const [missedRateAlertThreshold, setMissedRateAlertThreshold] = useState<number>(15);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error: err } = await supabase
      .from("call_sessions")
      .select("started_at, status, direction")
      .gte("started_at", since)
      .not("started_at", "is", null);
    if (err) setError(err.message);
    else setRows((data ?? []) as CallRow[]);
    setLoading(false);
    logAudit("view", "calls", null, { surface: "staffing_recommendation", window_days: windowDays });
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);

  // Bucket calls into 168 day-of-week × hour slots.
  const slots = useMemo<SlotStat[][]>(() => {
    const grid: { count: number; missed: number; weeks: Set<string> }[][] = [];
    for (let d = 0; d < 7; d++) {
      grid.push(Array.from({ length: 24 }, () => ({ count: 0, missed: 0, weeks: new Set() })));
    }
    for (const r of rows) {
      if ((r.direction ?? "inbound") !== "inbound") continue;  // staff-needs is inbound-driven
      const dt = new Date(r.started_at);
      const cell = grid[dt.getDay()][dt.getHours()];
      cell.count++;
      if (r.status === "missed" || r.status === "abandoned") cell.missed++;
      // ISO-week-ish key for distinct-week count.
      const wkKey = `${dt.getFullYear()}-${Math.floor((dt.getTime() - new Date(dt.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}`;
      cell.weeks.add(wkKey);
    }
    const out: SlotStat[][] = [];
    for (let d = 0; d < 7; d++) {
      const row: SlotStat[] = [];
      for (let h = 0; h < 24; h++) {
        const c = grid[d][h];
        const weeks = Math.max(c.weeks.size, 1);
        const avg = c.count / weeks;
        const missedRate = c.count > 0 ? (c.missed / c.count) * 100 : 0;
        const recommended = Math.max(0, Math.ceil(avg / callsPerSpecialistPerHour));
        row.push({
          day: d,
          hour: h,
          weeks: c.weeks.size,
          total_calls: c.count,
          avg_calls: avg,
          missed_rate: missedRate,
          recommended_staff: recommended,
        });
      }
      out.push(row);
    }
    return out;
  }, [rows, callsPerSpecialistPerHour]);

  // Totals across the grid for the summary tiles.
  const summary = useMemo(() => {
    let totalCalls = 0;
    let totalMissed = 0;
    let peakAvg = 0;
    let peakSlot: SlotStat | null = null;
    let busyHourCount = 0;            // slots with > 1 avg call
    let highMissSlots: SlotStat[] = [];
    for (const row of slots) {
      for (const s of row) {
        totalCalls += s.total_calls;
        if (s.avg_calls > 1) busyHourCount++;
        if (s.avg_calls > peakAvg) { peakAvg = s.avg_calls; peakSlot = s; }
        if (s.missed_rate >= missedRateAlertThreshold && s.total_calls >= 3) {
          highMissSlots.push(s);
        }
      }
    }
    for (const r of rows) {
      if ((r.direction ?? "inbound") === "inbound" && (r.status === "missed" || r.status === "abandoned")) totalMissed++;
    }
    highMissSlots.sort((a, b) => b.missed_rate - a.missed_rate);
    return { totalCalls, totalMissed, peakAvg, peakSlot, busyHourCount, highMissSlots: highMissSlots.slice(0, 8) };
  }, [slots, rows, missedRateAlertThreshold]);

  // Coloring: deeper = more calls. Cap at peakAvg for the gradient.
  function cellClass(avg: number): string {
    if (avg < 0.25) return "bg-muted/20 text-muted-foreground/40";
    const ratio = summary.peakAvg > 0 ? avg / summary.peakAvg : 0;
    if (ratio < 0.25) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    if (ratio < 0.5) return "bg-emerald-500/30 text-emerald-800 dark:text-emerald-300";
    if (ratio < 0.75) return "bg-amber-500/40 text-amber-900 dark:text-amber-200";
    return "bg-rose-500/50 text-rose-900 dark:text-rose-100 font-semibold";
  }

  function exportCsv() {
    const flat = slots.flat().map((s) => ({
      day: DAYS[s.day],
      hour: `${String(s.hour).padStart(2, "0")}:00`,
      avg_inbound_calls: s.avg_calls.toFixed(2),
      total_calls_observed: s.total_calls,
      weeks_observed: s.weeks,
      missed_rate_pct: s.missed_rate.toFixed(1),
      recommended_staff: s.recommended_staff,
    }));
    logAudit("export", "calls", null, { format: "csv", surface: "staffing_recommendation", window_days: windowDays });
    downloadCsv(`staffing-${new Date().toISOString().slice(0, 10)}.csv`, flat, [
      { key: "day", label: "Day" },
      { key: "hour", label: "Hour" },
      { key: "avg_inbound_calls", label: "Avg inbound calls/wk" },
      { key: "total_calls_observed", label: "Total calls (window)" },
      { key: "weeks_observed", label: "Weeks observed" },
      { key: "missed_rate_pct", label: "Missed rate %" },
      { key: "recommended_staff", label: "Recommended staff" },
    ]);
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calendar className="w-6 h-6" /> Staffing schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recommended specialist coverage by day-of-week and hour, derived from inbound-call patterns
            in the chosen window. Tune the assumptions on the right; the heatmap and recommendations
            recompute live.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Top tiles + tuning */}
      <div className="grid md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground">Window</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{windowDays}d</div>
          <div className="flex gap-1 mt-2">
            {[14, 30, 60, 90].map((d) => (
              <Button key={d} size="sm" variant={windowDays === d ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setWindowDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Inbound calls observed</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{summary.totalCalls}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{summary.totalMissed} missed</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Peak slot</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {summary.peakSlot ? `${summary.peakAvg.toFixed(1)}/wk` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {summary.peakSlot ? `${DAYS[summary.peakSlot.day]} ${String(summary.peakSlot.hour).padStart(2, "0")}:00` : ""}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Calls / specialist / hr</div>
          <input
            type="number"
            min={1}
            max={20}
            value={callsPerSpecialistPerHour}
            onChange={(e) => setCallsPerSpecialistPerHour(Math.max(1, Math.min(20, Number(e.target.value) || 6)))}
            className="text-2xl font-semibold tabular-nums mt-1 w-20 h-9 px-2 border rounded-md bg-background"
          />
          <div className="text-[11px] text-muted-foreground mt-0.5">tune the assumption</div>
        </CardContent></Card>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Crunching call patterns…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {!loading && !error && rows.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          No call data in this window. Pick a longer window or wait for more calls to land.
        </CardContent></Card>
      )}

      {/* Heatmap */}
      {!loading && rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended staff per hour</CardTitle>
            <p className="text-xs text-muted-foreground">
              Each cell shows recommended specialist headcount for that day/hour, derived as
              ceil(avg-inbound-calls-per-week / {callsPerSpecialistPerHour}). Color reflects relative call volume.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0.5">
                <thead>
                  <tr>
                    <th className="text-left px-1 py-1 text-muted-foreground sticky left-0 bg-background z-10">Day</th>
                    {Array.from({ length: 24 }).map((_, h) => (
                      <th key={h} className="text-center px-1 py-1 text-[10px] text-muted-foreground tabular-nums">
                        {String(h).padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((row, d) => (
                    <tr key={d}>
                      <td className="px-2 py-1 font-medium text-muted-foreground sticky left-0 bg-background z-10">{DAYS[d]}</td>
                      {row.map((s) => (
                        <td
                          key={s.hour}
                          title={`${DAYS[d]} ${String(s.hour).padStart(2, "0")}:00\nAvg ${s.avg_calls.toFixed(1)} inbound/wk · ${s.total_calls} total in ${s.weeks}w\nMissed rate ${s.missed_rate.toFixed(0)}%\nRecommend ${s.recommended_staff} specialist${s.recommended_staff === 1 ? "" : "s"}`}
                          className={`text-center px-1 py-1.5 rounded tabular-nums ${cellClass(s.avg_calls)}`}
                        >
                          {s.recommended_staff > 0 ? s.recommended_staff : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground flex-wrap">
              <span>Color scale (relative to peak {summary.peakAvg.toFixed(1)}/wk):</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">low</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-800 dark:text-emerald-300">moderate</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/40 text-amber-900 dark:text-amber-200">busy</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/50 text-rose-900 dark:text-rose-100">peak</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Coverage gaps: high miss-rate slots */}
      {!loading && summary.highMissSlots.length > 0 && (
        <Card className="border-l-4 border-l-rose-500">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Coverage gaps (slots missing &gt;{missedRateAlertThreshold}% of calls)
              </span>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Threshold</span>
                <input
                  type="number"
                  min={5}
                  max={80}
                  value={missedRateAlertThreshold}
                  onChange={(e) => setMissedRateAlertThreshold(Math.max(5, Math.min(80, Number(e.target.value) || 15)))}
                  className="w-14 h-7 px-2 border rounded-md bg-background text-sm"
                />%
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {summary.highMissSlots.map((s) => (
                <div key={`${s.day}-${s.hour}`} className="flex items-center gap-3 text-sm">
                  <span className="font-medium w-20">{DAYS[s.day]} {String(s.hour).padStart(2, "0")}:00</span>
                  <span className="text-muted-foreground flex-1">
                    {s.total_calls} call{s.total_calls === 1 ? "" : "s"} in {s.weeks}w · avg {s.avg_calls.toFixed(1)}/wk
                  </span>
                  <span className="text-rose-700 dark:text-rose-400 font-medium tabular-nums">{s.missed_rate.toFixed(0)}% missed</span>
                  <span className="text-xs text-muted-foreground tabular-nums">→ recommend {s.recommended_staff}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 italic">
              These are the hours where missed-call rate is highest. Adding a specialist to the hours
              above is the highest-leverage staffing change you can make.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
