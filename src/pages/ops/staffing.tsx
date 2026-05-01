import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Calendar, Loader2, RefreshCw, Users, Phone, AlertTriangle, Download,
  TrendingUp, Sliders,
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
  // Schedule-generator controls. All recompute live.
  const [headcount, setHeadcount] = useState<number>(8);
  const [shiftHours, setShiftHours] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [lunchHours, setLunchHours] = useState<number>(1);
  const [earliestStart, setEarliestStart] = useState<number>(7);     // 7am
  const [latestEnd, setLatestEnd] = useState<number>(20);            // 8pm

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

  // ===== Schedule generator =====
  // Greedy fill: for each person, generate every candidate (start hour,
  // days-off-pair) shift that respects the operating-window + days-per-
  // week constraints, score it by how much under-coverage it absorbs,
  // pick the best, repeat.
  const schedule = useMemo(() => {
    if (slots.length === 0) return null;

    // 1. Demand grid = recommended_staff per slot, rounded.
    const demand: number[][] = slots.map((row) => row.map((s) => s.recommended_staff));
    const remaining: number[][] = demand.map((row) => row.slice());

    // 2. Generate candidate shifts. A shift has a fixed daily start hour
    //    and runs `shiftHours` consecutive hours, including a 1h-ish
    //    lunch in the middle (no coverage during lunch). Working days
    //    are `daysPerWeek` consecutive days starting from a chosen
    //    weekday — the remaining days are off.
    interface Shift {
      key: string;
      start_day: number;        // 0-6, the first working weekday
      start_hour: number;       // 0-23
      end_hour: number;         // exclusive
      lunch_start_hour: number; // 0-23, no coverage during this hour
      working_days: number[];   // weekdays this person works
    }

    const candidates: Shift[] = [];
    const lunchOffset = Math.max(1, Math.floor(shiftHours / 2));   // mid-shift
    for (let startDay = 0; startDay < 7; startDay++) {
      const workingDays: number[] = [];
      for (let i = 0; i < daysPerWeek; i++) workingDays.push((startDay + i) % 7);
      for (let startHour = earliestStart; startHour <= latestEnd - shiftHours; startHour++) {
        const endHour = startHour + shiftHours;
        if (endHour > latestEnd) continue;
        const lunchStart = startHour + lunchOffset;
        candidates.push({
          key: `${startDay}-${startHour}`,
          start_day: startDay,
          start_hour: startHour,
          end_hour: endHour,
          lunch_start_hour: lunchStart,
          working_days: workingDays,
        });
      }
    }

    function shiftCoverageScore(s: Shift): number {
      let score = 0;
      for (const d of s.working_days) {
        for (let h = s.start_hour; h < s.end_hour; h++) {
          if (lunchHours > 0 && h >= s.lunch_start_hour && h < s.lunch_start_hour + lunchHours) continue;
          if (h < 0 || h > 23) continue;
          if (remaining[d][h] > 0) score++;
        }
      }
      return score;
    }

    function applyShift(s: Shift) {
      for (const d of s.working_days) {
        for (let h = s.start_hour; h < s.end_hour; h++) {
          if (lunchHours > 0 && h >= s.lunch_start_hour && h < s.lunch_start_hour + lunchHours) continue;
          if (h < 0 || h > 23) continue;
          if (remaining[d][h] > 0) remaining[d][h]--;
        }
      }
    }

    const assigned: Array<{ specialist: string; shift: Shift }> = [];
    for (let i = 0; i < headcount; i++) {
      let best: Shift | null = null;
      let bestScore = -1;
      for (const c of candidates) {
        const s = shiftCoverageScore(c);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (!best) break;
      // If no slots remain to fill, still assign the person to a sensible
      // default shift (M-F daytime) so headcount on the schedule matches
      // input — avoids a confusing partial roster.
      if (bestScore === 0) {
        const fallback: Shift = candidates.find((c) => c.start_day === 1 && c.start_hour === 9)
          ?? candidates[0];
        assigned.push({ specialist: `Specialist ${i + 1}`, shift: fallback });
        applyShift(fallback);
        continue;
      }
      applyShift(best);
      assigned.push({ specialist: `Specialist ${i + 1}`, shift: best });
    }

    // 3. Compute coverage % = 1 - (remaining demand / total demand).
    let totalDemand = 0, totalRemaining = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        totalDemand += demand[d][h];
        totalRemaining += remaining[d][h];
      }
    }
    const coveragePct = totalDemand > 0 ? Math.round(((totalDemand - totalRemaining) / totalDemand) * 100) : 100;

    // 4. Build a (day, hour) → assigned-people grid for visualizing the
    //    actual staffed schedule against demand.
    const staffed: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const a of assigned) {
      for (const d of a.shift.working_days) {
        for (let h = a.shift.start_hour; h < a.shift.end_hour; h++) {
          if (lunchHours > 0 && h >= a.shift.lunch_start_hour && h < a.shift.lunch_start_hour + lunchHours) continue;
          if (h < 0 || h > 23) continue;
          staffed[d][h]++;
        }
      }
    }

    return { assigned, coveragePct, totalDemand, remainingDemand: totalRemaining, staffed, demand };
  }, [slots, headcount, shiftHours, daysPerWeek, lunchHours, earliestStart, latestEnd]);

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

      {/* Generated schedule — recomputes live as controls change */}
      {!loading && schedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sliders className="w-4 h-4" /> Generated schedule
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Greedy assignment of {headcount} specialist{headcount === 1 ? "" : "s"} to shifts that
              maximally cover the recommended-headcount grid. Tweak the controls and the schedule
              recomputes instantly.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Controls grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <ControlField label="Specialists" value={headcount} min={1} max={50} onChange={setHeadcount} />
              <ControlField label="Shift hours" value={shiftHours} min={4} max={12} onChange={setShiftHours} />
              <ControlField label="Days/week" value={daysPerWeek} min={1} max={7} onChange={setDaysPerWeek} />
              <ControlField label="Lunch (hrs)" value={lunchHours} min={0} max={2} onChange={setLunchHours} />
              <ControlField label="Earliest start" value={earliestStart} min={0} max={23} onChange={setEarliestStart} suffix=":00" />
              <ControlField label="Latest end" value={latestEnd} min={1} max={24} onChange={setLatestEnd} suffix=":00" />
            </div>

            {/* Coverage summary */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t">
              <div>
                <div className="text-xs text-muted-foreground">Coverage of demand</div>
                <div className={`text-2xl font-semibold tabular-nums mt-1 ${schedule.coveragePct >= 90 ? "text-emerald-700 dark:text-emerald-400" : schedule.coveragePct >= 70 ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}`}>
                  {schedule.coveragePct}%
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {schedule.totalDemand - schedule.remainingDemand} of {schedule.totalDemand} demand-slots filled
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total scheduled hours/wk</div>
                <div className="text-2xl font-semibold tabular-nums mt-1">
                  {headcount * (shiftHours - lunchHours) * daysPerWeek}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {(shiftHours - lunchHours) * daysPerWeek}h per specialist
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Unfilled demand</div>
                <div className="text-2xl font-semibold tabular-nums mt-1 text-muted-foreground">
                  {schedule.remainingDemand}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {schedule.remainingDemand === 0 ? "Fully covered" : "Add headcount or extend hours"}
                </div>
              </div>
            </div>

            {/* Per-specialist roster */}
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Specialist</th>
                    <th className="text-left p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Days</th>
                    <th className="text-left p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Shift</th>
                    <th className="text-left p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Lunch</th>
                    <th className="text-right p-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Hours/wk</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {schedule.assigned.map((a, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="p-2 font-medium">{a.specialist}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {a.shift.working_days.map((d) => DAYS[d]).join(", ")}
                      </td>
                      <td className="p-2 text-xs tabular-nums">
                        {String(a.shift.start_hour).padStart(2, "0")}:00 – {String(a.shift.end_hour).padStart(2, "0")}:00
                      </td>
                      <td className="p-2 text-xs text-muted-foreground tabular-nums">
                        {lunchHours > 0
                          ? `${String(a.shift.lunch_start_hour).padStart(2, "0")}:00 – ${String(a.shift.lunch_start_hour + lunchHours).padStart(2, "0")}:00`
                          : "—"}
                      </td>
                      <td className="p-2 text-xs text-right tabular-nums">{(shiftHours - lunchHours) * daysPerWeek}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Staffed-vs-demand heatmap (delta view) */}
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Staffed vs demand (rose = under-staffed, emerald = covered)
              </div>
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
                    {Array.from({ length: 7 }).map((_, d) => (
                      <tr key={d}>
                        <td className="px-2 py-1 font-medium text-muted-foreground sticky left-0 bg-background z-10">{DAYS[d]}</td>
                        {Array.from({ length: 24 }).map((_, h) => {
                          const dem = schedule.demand[d][h];
                          const staffed = schedule.staffed[d][h];
                          if (dem === 0 && staffed === 0) {
                            return <td key={h} className="text-center px-1 py-1.5 rounded text-muted-foreground/30">·</td>;
                          }
                          const gap = dem - staffed;
                          const cls = gap > 0
                            ? "bg-rose-500/40 text-rose-900 dark:text-rose-100"
                            : staffed > 0 && dem === 0
                              ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                              : "bg-emerald-500/25 text-emerald-800 dark:text-emerald-300";
                          return (
                            <td key={h} className={`text-center px-1 py-1.5 rounded tabular-nums ${cls}`}
                              title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00\nDemand: ${dem}\nStaffed: ${staffed}\n${gap > 0 ? `Short ${gap}` : gap < 0 ? `Over by ${-gap}` : "Exact"}`}>
                              {staffed}{dem > 0 ? `/${dem}` : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  logAudit("export", "calls", null, { format: "csv", surface: "staffing_schedule" });
                  downloadCsv(`schedule-${new Date().toISOString().slice(0, 10)}.csv`,
                    schedule.assigned.map((a) => ({
                      specialist: a.specialist,
                      days: a.shift.working_days.map((d) => DAYS[d]).join(", "),
                      shift_start: `${String(a.shift.start_hour).padStart(2, "0")}:00`,
                      shift_end: `${String(a.shift.end_hour).padStart(2, "0")}:00`,
                      lunch: lunchHours > 0
                        ? `${String(a.shift.lunch_start_hour).padStart(2, "0")}:00–${String(a.shift.lunch_start_hour + lunchHours).padStart(2, "0")}:00`
                        : "",
                      hours_per_week: (shiftHours - lunchHours) * daysPerWeek,
                    })), [
                      { key: "specialist", label: "Specialist" },
                      { key: "days", label: "Days" },
                      { key: "shift_start", label: "Shift start" },
                      { key: "shift_end", label: "Shift end" },
                      { key: "lunch", label: "Lunch" },
                      { key: "hours_per_week", label: "Hours/wk" },
                    ]);
                }}
              >
                <Download className="w-3.5 h-3.5" /> Export schedule CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ControlField({ label, value, min, max, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          className="w-full h-9 px-2 border rounded-md bg-background text-sm tabular-nums"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
