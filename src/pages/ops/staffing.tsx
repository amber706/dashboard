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
import { erlangCStaff } from "@/lib/erlang";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TZ = "America/Phoenix";   // Arizona — no DST, always MST/UTC-7

// Bucket a UTC timestamp into the Arizona-local day-of-week + hour.
function phoenixDayHour(d: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: dayMap[weekday] ?? 0, hour: hour === 24 ? 0 : hour };
}

// Format an hour-of-day (0-23) as "8 AM" / "12 PM" etc.
function fmt12(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// Compact two-char header for the heatmap grid (saves horizontal space).
function fmt12Short(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}

interface CallRow {
  started_at: string;
  status: string;
  direction: string | null;
  talk_seconds: number | null;
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

type RangePreset = "mtd" | "30d" | "90d" | "6m" | "9m" | "12m" | "custom";

function presetSince(p: RangePreset, customSince: string | null): Date | null {
  const now = new Date();
  switch (p) {
    case "mtd":  return new Date(now.getFullYear(), now.getMonth(), 1);
    case "30d":  return new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    case "90d":  return new Date(now.getTime() - 90 * 24 * 3600 * 1000);
    case "6m":   return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "9m":   return new Date(now.getFullYear(), now.getMonth() - 9, now.getDate());
    case "12m":  return new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    case "custom": return customSince ? new Date(customSince) : null;
  }
}

function presetUntil(p: RangePreset, customUntil: string | null): Date {
  if (p === "custom" && customUntil) return new Date(customUntil + "T23:59:59.999Z");
  return new Date();
}

const PRESET_LABEL: Record<RangePreset, string> = {
  mtd: "MTD", "30d": "30d", "90d": "90d", "6m": "6mo", "9m": "9mo", "12m": "12mo", custom: "Custom",
};

export default function OpsStaffing() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [customSince, setCustomSince] = useState<string>("");        // yyyy-mm-dd
  const [customUntil, setCustomUntil] = useState<string>("");
  const since = useMemo(() => presetSince(rangePreset, customSince), [rangePreset, customSince]);
  const until = useMemo(() => presetUntil(rangePreset, customUntil), [rangePreset, customUntil]);
  // Tuning knobs the manager can play with — live recompute.
  const [callsPerSpecialistPerHour, setCallsPerSpecialistPerHour] = useState<number>(6);
  const [missedRateAlertThreshold, setMissedRateAlertThreshold] = useState<number>(15);
  // Erlang C inputs — defaults match common call-center workforce-management
  // settings. AHT is computed from the loaded data when available.
  const [useErlang, setUseErlang] = useState<boolean>(true);
  const [slaTargetPct, setSlaTargetPct] = useState<number>(80);     // % calls answered within slaSeconds
  const [slaSeconds, setSlaSeconds] = useState<number>(20);
  const [shrinkagePct, setShrinkagePct] = useState<number>(30);     // breaks, training, meetings
  const [ahtOverrideSeconds, setAhtOverrideSeconds] = useState<number | null>(null);
  // Schedule-generator controls. The headcount is the primary variable;
  // everything else has sensible defaults for "8am-8pm, 7 days/week"
  // coverage and lives behind an Assumptions disclosure.
  const [headcount, setHeadcount] = useState<number>(8);
  const [shiftHours, setShiftHours] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [lunchHours, setLunchHours] = useState<number>(1);
  const [earliestStart, setEarliestStart] = useState<number>(8);     // 8am — operating window default
  const [latestEnd, setLatestEnd] = useState<number>(20);            // 8pm
  const [showAssumptions, setShowAssumptions] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!since) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("call_sessions")
      .select("started_at, status, direction, talk_seconds")
      .gte("started_at", since.toISOString())
      .lte("started_at", until.toISOString())
      .not("started_at", "is", null);
    if (err) setError(err.message);
    else setRows((data ?? []) as CallRow[]);
    setLoading(false);
    logAudit("view", "calls", null, { surface: "staffing_recommendation", range: rangePreset, since: since.toISOString(), until: until.toISOString() });
  }, [since, until, rangePreset]);

  useEffect(() => { load(); }, [load]);

  // Average handle time pulled from completed inbound calls in the window.
  // 30s minimum floor (a busy signal at 5s shouldn't pull AHT to zero).
  const ahtSeconds = useMemo(() => {
    if (ahtOverrideSeconds != null) return ahtOverrideSeconds;
    const tt = rows
      .filter((r) => (r.direction ?? "inbound") === "inbound" && r.status === "completed" && (r.talk_seconds ?? 0) > 0)
      .map((r) => r.talk_seconds as number);
    if (tt.length === 0) return 240;     // sensible default: 4 minutes
    const avg = tt.reduce((a, b) => a + b, 0) / tt.length;
    return Math.max(30, Math.round(avg));
  }, [rows, ahtOverrideSeconds]);

  // Bucket calls into 168 day-of-week × hour slots.
  const slots = useMemo<SlotStat[][]>(() => {
    const grid: { count: number; missed: number; weeks: Set<string> }[][] = [];
    for (let d = 0; d < 7; d++) {
      grid.push(Array.from({ length: 24 }, () => ({ count: 0, missed: 0, weeks: new Set() })));
    }
    for (const r of rows) {
      if ((r.direction ?? "inbound") !== "inbound") continue;  // staff-needs is inbound-driven
      const dt = new Date(r.started_at);
      const { day, hour } = phoenixDayHour(dt);
      const cell = grid[day][hour];
      cell.count++;
      if (r.status === "missed" || r.status === "abandoned") cell.missed++;
      // Week key in Arizona time so a call right after midnight UTC on
      // Sunday doesn't bucket into the wrong week.
      const wkKey = `${dt.getUTCFullYear()}-${Math.floor((dt.getTime() - new Date(dt.getUTCFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}`;
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
        let recommended: number;
        if (useErlang && avg > 0) {
          // Erlang C: avg calls/wk / 1 = calls/hour for this slot (each
          // (day,hour) bucket is one hour). Shrinkage is applied at the
          // schedule layer, not here, so the heatmap shows productive
          // headcount needed (agents on calls), not scheduled headcount.
          const r = erlangCStaff({
            callsPerHour: avg,
            ahtSeconds,
            slaTarget: slaTargetPct / 100,
            slaSeconds,
            shrinkage: 0,
          });
          recommended = r.minAgents;
        } else {
          recommended = Math.max(0, Math.ceil(avg / callsPerSpecialistPerHour));
        }
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
  }, [rows, callsPerSpecialistPerHour, useErlang, ahtSeconds, slaTargetPct, slaSeconds]);

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

  // Min-headcount-for-full-coverage: total demand-hours/week ÷ per-person
  // productive hours, floored by peak concurrent demand, then grossed up
  // for shrinkage (breaks/training/meetings = hours scheduled but not on
  // the phone) when Erlang mode is active. Answers "if I want to hit my
  // SLA target across the operating window with these per-person
  // constraints, what's my scheduled headcount?"
  const minHeadcountFullCoverage = useMemo(() => {
    if (slots.length === 0) return null;
    let totalDemandHours = 0;
    let peakConcurrent = 0;
    for (const row of slots) {
      for (const s of row) {
        if (s.hour < earliestStart || s.hour >= latestEnd) continue;
        totalDemandHours += s.recommended_staff;
        if (s.recommended_staff > peakConcurrent) peakConcurrent = s.recommended_staff;
      }
    }
    const perPersonHours = (shiftHours - lunchHours) * daysPerWeek;
    if (perPersonHours <= 0) return null;
    const fromTotal = Math.ceil(totalDemandHours / perPersonHours);
    const productiveFloor = Math.max(peakConcurrent, fromTotal);
    if (!useErlang || shrinkagePct <= 0) return productiveFloor;
    // Gross up for shrinkage: scheduled = productive / (1 - shrinkage).
    return Math.ceil(productiveFloor / Math.max(0.01, 1 - shrinkagePct / 100));
  }, [slots, earliestStart, latestEnd, shiftHours, lunchHours, daysPerWeek, useErlang, shrinkagePct]);

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
    logAudit("export", "calls", null, { format: "csv", surface: "staffing_recommendation", range: rangePreset, since: since?.toISOString(), until: until.toISOString() });
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

      {/* Date range selector — quick presets + custom */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">Call data window <span className="opacity-60">· Arizona time (MST)</span></div>
              <div className="text-sm font-medium mt-0.5">
                {since ? since.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "—"}
                {" → "}
                {until.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["mtd", "30d", "90d", "6m", "9m", "12m", "custom"] as const).map((p) => (
                <Button key={p} size="sm" variant={rangePreset === p ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setRangePreset(p)}>
                  {PRESET_LABEL[p]}
                </Button>
              ))}
            </div>
          </div>
          {rangePreset === "custom" && (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} className="h-8 px-2 border rounded-md bg-background text-sm" />
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="h-8 px-2 border rounded-md bg-background text-sm" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats: calls observed, peak slot, calls/specialist/hr assumption */}
      <div className="grid md:grid-cols-3 gap-3">
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
            {summary.peakSlot ? `${DAYS[summary.peakSlot.day]} ${fmt12(summary.peakSlot.hour)}` : ""}
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

      {/* Staffing model controls */}
      {!loading && rows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-3 flex-wrap">
              <span>Staffing model</span>
              <div className="flex items-center gap-1 text-xs">
                <Button size="sm" variant={useErlang ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setUseErlang(true)}>
                  Erlang C (recommended)
                </Button>
                <Button size="sm" variant={!useErlang ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setUseErlang(false)}>
                  Simple
                </Button>
              </div>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {useErlang
                ? "Industry-standard queueing model. Accounts for random call arrivals, target service level, and shrinkage."
                : "Flat assumption: avg calls / (calls per specialist per hour). Faster but ignores call clustering and queueing."}
            </p>
          </CardHeader>
          {useErlang && (
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Service level target</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={50} max={99} value={slaTargetPct} onChange={(e) => setSlaTargetPct(Math.max(50, Math.min(99, Number(e.target.value) || 80)))} className="w-16 h-9 px-2 border rounded-md bg-background text-sm tabular-nums" />
                  <span className="text-xs text-muted-foreground">% within</span>
                  <input type="number" min={5} max={120} value={slaSeconds} onChange={(e) => setSlaSeconds(Math.max(5, Math.min(120, Number(e.target.value) || 20)))} className="w-14 h-9 px-2 border rounded-md bg-background text-sm tabular-nums" />
                  <span className="text-xs text-muted-foreground">s</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Shrinkage</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={60} value={shrinkagePct} onChange={(e) => setShrinkagePct(Math.max(0, Math.min(60, Number(e.target.value) || 30)))} className="w-16 h-9 px-2 border rounded-md bg-background text-sm tabular-nums" />
                  <span className="text-xs text-muted-foreground">% off-phone</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">breaks, training, meetings</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Avg handle time</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={30} max={1800} value={ahtSeconds} onChange={(e) => setAhtOverrideSeconds(Math.max(30, Math.min(1800, Number(e.target.value) || ahtSeconds)))} className="w-20 h-9 px-2 border rounded-md bg-background text-sm tabular-nums" />
                  <span className="text-xs text-muted-foreground">sec ({Math.floor(ahtSeconds / 60)}m {ahtSeconds % 60}s)</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {ahtOverrideSeconds == null ? "auto-derived from data" : (
                    <button onClick={() => setAhtOverrideSeconds(null)} className="hover:underline">reset to auto</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Traffic right now</label>
                <div className="text-sm font-medium tabular-nums">{(summary.totalCalls / Math.max(1, slots[0]?.[0]?.weeks || 1)).toFixed(0)} calls/wk</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">in window, inbound</div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Heatmap */}
      {!loading && rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended staff per hour</CardTitle>
            <p className="text-xs text-muted-foreground">
              {useErlang
                ? `Each cell shows the productive headcount needed (agents on calls) to hit ${slaTargetPct}% answered within ${slaSeconds}s at this slot's call rate, given a ${Math.floor(ahtSeconds / 60)}m ${ahtSeconds % 60}s avg handle time. Schedule below grosses up for ${shrinkagePct}% shrinkage.`
                : `Each cell shows recommended specialist headcount, derived as ceil(avg-inbound-calls-per-week / ${callsPerSpecialistPerHour}). Color reflects relative call volume.`}
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
                        {fmt12Short(h)}
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
                          title={`${DAYS[d]} ${fmt12(s.hour)}\nAvg ${s.avg_calls.toFixed(1)} inbound/wk · ${s.total_calls} total in ${s.weeks}w\nMissed rate ${s.missed_rate.toFixed(0)}%\nRecommend ${s.recommended_staff} specialist${s.recommended_staff === 1 ? "" : "s"}`}
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
                  <span className="font-medium w-20">{DAYS[s.day]} {fmt12(s.hour)}</span>
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
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sliders className="w-4 h-4" /> How many specialists do you need?
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Holding the assumptions below constant ({fmt12(earliestStart)}–{fmt12(latestEnd)},
              7 days/week, {shiftHours}h shifts, {daysPerWeek} days per specialist), here's how
              many you need to cover your call demand.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Hero: min for full coverage + headcount input */}
            <div className="grid md:grid-cols-2 gap-3">
              <Card className="bg-emerald-500/5 border-emerald-500/30">
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground">Minimum specialists for full coverage</div>
                  <div className="text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                    {minHeadcountFullCoverage ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Floor based on total weekly demand-hours and the peak concurrent slot.
                  </div>
                  {minHeadcountFullCoverage != null && (
                    <Button size="sm" variant="outline" className="h-7 text-xs mt-2" onClick={() => setHeadcount(minHeadcountFullCoverage)}>
                      Use this number
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="text-xs text-muted-foreground">Try a headcount</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Button size="sm" variant="outline" className="h-9 w-9 p-0" onClick={() => setHeadcount(Math.max(1, headcount - 1))}>−</Button>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={headcount}
                      onChange={(e) => setHeadcount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      className="text-3xl font-semibold tabular-nums w-24 h-12 px-2 border rounded-md bg-background text-center"
                    />
                    <Button size="sm" variant="outline" className="h-9 w-9 p-0" onClick={() => setHeadcount(headcount + 1)}>+</Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Total: {headcount * (shiftHours - lunchHours) * daysPerWeek}h scheduled per week
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Assumptions disclosure */}
            <details className="border rounded-md" open={showAssumptions} onToggle={(e) => setShowAssumptions((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer p-3 text-xs font-semibold uppercase text-muted-foreground hover:bg-accent/40 select-none">
                Assumptions {showAssumptions ? "" : "— click to adjust"}
              </summary>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 p-3 border-t">
                <ControlField label="Shift hours" value={shiftHours} min={4} max={12} onChange={setShiftHours} />
                <ControlField label="Days/specialist" value={daysPerWeek} min={1} max={7} onChange={setDaysPerWeek} />
                <ControlField label="Lunch (hrs)" value={lunchHours} min={0} max={2} onChange={setLunchHours} />
                <HourPickerField label="Earliest start" value={earliestStart} onChange={setEarliestStart} min={0} max={23} />
                <HourPickerField label="Latest end" value={latestEnd} onChange={setLatestEnd} min={1} max={24} />
              </div>
            </details>

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
                        {fmt12(a.shift.start_hour)} – {fmt12(a.shift.end_hour)}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground tabular-nums">
                        {lunchHours > 0
                          ? `${fmt12(a.shift.lunch_start_hour)} – ${fmt12(a.shift.lunch_start_hour + lunchHours)}`
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
                          {fmt12Short(h)}
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
                              title={`${DAYS[d]} ${fmt12(h)}\nDemand: ${dem}\nStaffed: ${staffed}\n${gap > 0 ? `Short ${gap}` : gap < 0 ? `Over by ${-gap}` : "Exact"}`}>
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
                      shift_start: fmt12(a.shift.start_hour),
                      shift_end: fmt12(a.shift.end_hour),
                      lunch: lunchHours > 0
                        ? `${fmt12(a.shift.lunch_start_hour)}–${fmt12(a.shift.lunch_start_hour + lunchHours)}`
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

// Hour-of-day picker rendered as 12-hour AM/PM dropdown.
function HourPickerField({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const options: number[] = [];
  for (let h = min; h <= max; h++) options.push(h);
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-9 px-2 border rounded-md bg-background text-sm"
      >
        {options.map((h) => (
          <option key={h} value={h}>
            {h === 24 ? "12 AM (midnight)" : fmt12(h)}
          </option>
        ))}
      </select>
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
