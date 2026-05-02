import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Award, AlertTriangle, GraduationCap,
  Phone, Loader2, Trophy, Clock, ChevronRight, Activity, Sparkles,
  PhoneOff, Voicemail, PhoneCall, ShieldCheck,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CallScoreRow {
  id: string;
  call_session_id: string;
  composite_score: number | null;
  caller_sentiment: string | null;
  needs_supervisor_review: boolean;
  qualification_completeness: number | null;
  rapport_and_empathy: number | null;
  objection_handling: number | null;
  urgency_handling: number | null;
  next_step_clarity: number | null;
  script_adherence: number | null;
  compliance: number | null;
  booking_or_transfer: number | null;
  overall_quality: number | null;
  compliance_flags: any[] | null;
  coaching_takeaways: { what_went_well?: string[]; what_to_try?: string[] } | null;
  created_at: string;
  call: { id: string; ctm_call_id: string; caller_name: string | null; caller_phone_normalized: string | null; started_at: string | null; talk_seconds: number | null; manager_notes: string | null } | null;
}

interface AssignmentRow {
  id: string;
  scenario_id: string;
  due_at: string | null;
  status: string;
  notes: string | null;
  scenario: { id: string; title: string; difficulty: string } | null;
}

interface TrainingScoreRow {
  id: string;
  composite_score: number | null;
  created_at: string;
  session: { scenario: { title: string } | null } | null;
}

interface AttributedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  outcome_category: "won" | "lost" | "in_progress" | null;
  outcome_set_at: string | null;
  stage: string | null;
  first_touch_call: { started_at: string | null } | null;
}

interface PendingCallback {
  id: string;
  status: string;                       // call_sessions.status — missed/abandoned/voicemail
  caller_name: string | null;
  caller_phone_normalized: string | null;
  started_at: string | null;
  lead_id: string | null;
  lead: { id: string; first_name: string | null; last_name: string | null; outcome_category: string | null } | null;
  ownership: "lead_owner" | "original_specialist";
}

interface OutreachOwed {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  outbound_count: number;
}

interface VobOwed {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  insurance_provider: string | null;
  urgency: string | null;
  vob_status: "pending" | "in_progress";
}

const RUBRIC_CATEGORIES: Array<{ key: keyof CallScoreRow; label: string }> = [
  { key: "qualification_completeness", label: "Qualification" },
  { key: "rapport_and_empathy", label: "Rapport" },
  { key: "objection_handling", label: "Objection handling" },
  { key: "urgency_handling", label: "Urgency" },
  { key: "next_step_clarity", label: "Next step" },
  { key: "script_adherence", label: "Script" },
  { key: "compliance", label: "Compliance" },
  { key: "booking_or_transfer", label: "Booking" },
  { key: "overall_quality", label: "Overall" },
];

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export default function MyCoaching() {
  const { user } = useAuth();
  const [scores, setScores] = useState<CallScoreRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [trainingScores, setTrainingScores] = useState<TrainingScoreRow[]>([]);
  const [attributedLeads, setAttributedLeads] = useState<AttributedLead[]>([]);
  const [callbacks, setCallbacks] = useState<PendingCallback[]>([]);
  const [outreachOwed, setOutreachOwed] = useState<OutreachOwed[]>([]);
  const [vobOwed, setVobOwed] = useState<VobOwed[]>([]);
  const [teamConversionRate, setTeamConversionRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [scoresRes, assignmentsRes, trainingScoresRes] = await Promise.all([
      supabase
        .from("call_scores")
        .select(`
          id, call_session_id, composite_score, caller_sentiment, needs_supervisor_review,
          qualification_completeness, rapport_and_empathy, objection_handling, urgency_handling,
          next_step_clarity, script_adherence, compliance, booking_or_transfer, overall_quality,
          compliance_flags, coaching_takeaways, created_at,
          call:call_sessions!inner(id, ctm_call_id, caller_name, caller_phone_normalized, started_at, talk_seconds, specialist_id, manager_notes)
        `)
        .eq("call.specialist_id", user.id)
        .gte("created_at", ninetyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("training_assignments")
        .select(`id, scenario_id, due_at, status, notes,
          scenario:training_scenarios(id, title, difficulty)`)
        .eq("specialist_id", user.id)
        .in("status", ["assigned", "in_progress"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("training_session_scores")
        .select(`id, composite_score, created_at,
          session:training_sessions!inner(specialist_id, scenario:training_scenarios(title))`)
        .eq("session.specialist_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (scoresRes.error) setError(scoresRes.error.message);
    setScores((scoresRes.data ?? []) as unknown as CallScoreRow[]);
    setAssignments((assignmentsRes.data ?? []) as unknown as AssignmentRow[]);
    setTrainingScores((trainingScoresRes.data ?? []) as unknown as TrainingScoreRow[]);

    // Outcome attribution: pull leads where THIS specialist's calls are
    // the last-touch credited call. We have to two-step: first get this
    // user's call IDs, then leads pointing to them.
    const userCallIds = ((scoresRes.data ?? []) as any[])
      .map((r) => r.call?.id)
      .filter(Boolean) as string[];
    if (userCallIds.length > 0) {
      const { data: leads } = await supabase
        .from("leads")
        .select(`id, first_name, last_name, primary_phone_normalized, outcome_category, outcome_set_at, stage,
          first_touch_call:call_sessions!leads_first_touch_call_id_fkey(started_at)`)
        .in("last_touch_call_id", userCallIds)
        .order("outcome_set_at", { ascending: false, nullsFirst: false })
        .limit(100);
      setAttributedLeads(((leads ?? []) as any[]).map((l) => ({
        ...l,
        first_touch_call: Array.isArray(l.first_touch_call) ? l.first_touch_call[0] : l.first_touch_call,
      })) as AttributedLead[]);
    } else {
      setAttributedLeads([]);
    }

    // Pending callbacks owed by THIS specialist. Two sources:
    //   (a) calls where I was the original specialist and the callback is still pending
    //   (b) missed/voicemail calls on a lead I own (regardless of who took the original)
    // Same call can appear in both — dedupe by id, prefer "lead_owner" label.
    const baseCallbackSel = `id, status, caller_name, caller_phone_normalized, started_at, lead_id,
      lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name, outcome_category)`;
    const [origRes, ownedLeadsRes] = await Promise.all([
      supabase
        .from("call_sessions")
        .select(baseCallbackSel)
        .eq("specialist_id", user.id)
        .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback")
        .eq("callback_status", "pending")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from("leads")
        .select("id")
        .eq("owner_id", user.id),
    ]);
    const ownedLeadIds = (ownedLeadsRes.data ?? []).map((l: any) => l.id) as string[];
    const ownedCallsRes = ownedLeadIds.length > 0
      ? await supabase
          .from("call_sessions")
          .select(baseCallbackSel)
          .in("lead_id", ownedLeadIds)
          .in("status", ["missed", "abandoned", "voicemail"])
          .eq("callback_status", "pending")
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(50)
      : { data: [] as any[] };
    const cbMap = new Map<string, PendingCallback>();
    for (const c of (origRes.data ?? []) as any[]) {
      cbMap.set(c.id, { ...c, lead: Array.isArray(c.lead) ? c.lead[0] : c.lead, ownership: "original_specialist" });
    }
    for (const c of (ownedCallsRes.data ?? []) as any[]) {
      cbMap.set(c.id, { ...c, lead: Array.isArray(c.lead) ? c.lead[0] : c.lead, ownership: "lead_owner" });
    }
    setCallbacks(
      Array.from(cbMap.values()).sort((a, b) =>
        (a.started_at ?? "") < (b.started_at ?? "") ? 1 : -1,
      ),
    );

    // Outreach owed: leads I own that are in_progress AND haven't had an
    // outbound call in 3+ days. We pull leads first then fan out for calls.
    const STALE_DAYS = 3;
    const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    const lookback = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: myLeads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, primary_phone_normalized, insurance_provider, urgency, created_at")
      .eq("owner_id", user.id)
      .eq("outcome_category", "in_progress")
      .not("primary_phone_normalized", "is", null)
      .gte("created_at", lookback)
      .limit(100);
    const myLeadIds = (myLeads ?? []).map((l: any) => l.id) as string[];
    if (myLeadIds.length > 0) {
      const { data: leadCalls } = await supabase
        .from("call_sessions")
        .select("lead_id, direction, started_at")
        .in("lead_id", myLeadIds);
      const byLead = new Map<string, { lastIn: string | null; lastOut: string | null; outN: number }>();
      for (const c of (leadCalls ?? []) as any[]) {
        if (!c.lead_id) continue;
        const b = byLead.get(c.lead_id) ?? { lastIn: null, lastOut: null, outN: 0 };
        if (c.direction === "inbound" && (!b.lastIn || (c.started_at && c.started_at > b.lastIn))) b.lastIn = c.started_at;
        if (c.direction === "outbound") {
          b.outN++;
          if (!b.lastOut || (c.started_at && c.started_at > b.lastOut)) b.lastOut = c.started_at;
        }
        byLead.set(c.lead_id, b);
      }
      const owed: OutreachOwed[] = (myLeads ?? [])
        .map((l: any) => {
          const b = byLead.get(l.id) ?? { lastIn: null, lastOut: null, outN: 0 };
          return { ...l, last_inbound_at: b.lastIn, last_outbound_at: b.lastOut, outbound_count: b.outN };
        })
        .filter((l: OutreachOwed) => {
          // Surface only if: had at least one inbound (real lead, not a stub),
          // AND no recent outbound (or never).
          if (!l.last_inbound_at) return false;
          if (l.last_outbound_at && new Date(l.last_outbound_at).getTime() > staleCutoff) return false;
          return true;
        })
        .sort((a: OutreachOwed, b: OutreachOwed) => {
          const aLast = a.last_outbound_at ?? a.last_inbound_at!;
          const bLast = b.last_outbound_at ?? b.last_inbound_at!;
          return aLast < bLast ? -1 : 1;
        });
      setOutreachOwed(owed);
    } else {
      setOutreachOwed([]);
    }

    // VOBs I owe — leads I own where insurance is on file but VOB hasn't
    // been worked yet. Capped at 50 because a normal specialist will never
    // legitimately have more than that pending at once.
    const { data: vobLeads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, primary_phone_normalized, insurance_provider, urgency, vob_status")
      .eq("owner_id", user.id)
      .in("vob_status", ["pending", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(50);
    setVobOwed(((vobLeads ?? []) as any[]).map((l) => ({
      id: l.id,
      first_name: l.first_name,
      last_name: l.last_name,
      primary_phone_normalized: l.primary_phone_normalized,
      insurance_provider: l.insurance_provider,
      urgency: l.urgency,
      vob_status: l.vob_status,
    })));

    // Team-wide conversion rate (last 30d) for benchmarking.
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ count: teamWon }, { count: teamLost }] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true })
        .eq("outcome_category", "won").gte("outcome_set_at", since30),
      supabase.from("leads").select("id", { count: "exact", head: true })
        .eq("outcome_category", "lost").gte("outcome_set_at", since30),
    ]);
    const tWon = teamWon ?? 0, tLost = teamLost ?? 0;
    setTeamConversionRate((tWon + tLost) > 0 ? Math.round((tWon / (tWon + tLost)) * 100) : null);

    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const last30 = scores.filter((s) => {
      const d = new Date(s.created_at);
      return d.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000;
    });
    const last7 = scores.filter((s) => {
      const d = new Date(s.created_at);
      return d.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;
    });
    const avg = (rows: CallScoreRow[], key: keyof CallScoreRow): number | null => {
      const vals = rows.map((r) => r[key]).filter((n): n is number => typeof n === "number");
      if (vals.length === 0) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    // Today's stats: scores from today only.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const today = scores.filter((s) => new Date(s.created_at).getTime() >= startOfDay.getTime());
    const todayCount = today.length;
    const todayAvg = avg(today, "composite_score");
    const todayFlagged = today.filter((s) => s.needs_supervisor_review || (s.compliance_flags && s.compliance_flags.length > 0)).length;

    const avg30 = avg(last30, "composite_score");
    const avg7 = avg(last7, "composite_score");
    const trend = (avg30 != null && avg7 != null) ? avg7 - avg30 : null;

    // Per-rubric averages over last 30d to find best/worst category.
    const byCat = RUBRIC_CATEGORIES.map((c) => ({ key: c.key, label: c.label, avg: avg(last30, c.key) }))
      .filter((c) => c.avg != null) as Array<{ key: string; label: string; avg: number }>;
    byCat.sort((a, b) => a.avg - b.avg);
    const worst = byCat[0] ?? null;
    const best = byCat[byCat.length - 1] ?? null;

    const flagged = scores.filter((s) =>
      s.needs_supervisor_review || (s.compliance_flags && s.compliance_flags.length > 0),
    );

    // Trend chart: composite score per call, oldest to newest.
    const trendData = [...scores]
      .reverse()
      .map((s) => ({
        date: fmtDate(s.created_at),
        score: s.composite_score,
        callId: s.call?.id,
      }))
      .filter((p) => p.score != null);

    // Top wins this month: highest-scored completed calls in last 30d.
    const wins = [...last30]
      .filter((s) => (s.composite_score ?? 0) >= 80)
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0))
      .slice(0, 5);

    // Personal outcome stats (rolling 30d).
    const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentLeads = attributedLeads.filter((l) =>
      l.outcome_set_at && new Date(l.outcome_set_at).getTime() > since30
    );
    const myWon = recentLeads.filter((l) => l.outcome_category === "won").length;
    const myLost = recentLeads.filter((l) => l.outcome_category === "lost").length;
    const myInProgress = recentLeads.filter((l) => l.outcome_category === "in_progress").length;
    const myConversionRate = (myWon + myLost) > 0 ? Math.round((myWon / (myWon + myLost)) * 100) : null;
    const recentWins = attributedLeads.filter((l) => l.outcome_category === "won").slice(0, 5);

    // Speed-to-admit: avg days from first contact to outcome_set_at, won leads only.
    const wonWithBoth = attributedLeads.filter((l) =>
      l.outcome_category === "won" && l.outcome_set_at && l.first_touch_call?.started_at,
    );
    const myAvgDaysToAdmit = wonWithBoth.length > 0
      ? Math.round(wonWithBoth.reduce((acc, l) => {
          const days = (new Date(l.outcome_set_at!).getTime() - new Date(l.first_touch_call!.started_at!).getTime()) / (1000 * 60 * 60 * 24);
          return acc + days;
        }, 0) / wonWithBoth.length * 10) / 10
      : null;

    return {
      callsCount30: last30.length,
      callsCount7: last7.length,
      avg30,
      avg7,
      trend,
      best,
      worst,
      flagged,
      trendData,
      wins,
      myWon, myLost, myInProgress, myConversionRate, recentWins, myAvgDaysToAdmit,
      todayCount, todayAvg, todayFlagged,
    };
  }, [scores, attributedLeads]);

  if (!user) {
    return <div className="max-w-5xl mx-auto p-6"><Card><CardContent className="pt-6 text-sm text-muted-foreground">Please log in.</CardContent></Card></div>;
  }

  const firstName = user.display_name?.split(" ")[0] ?? "there";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Award className="w-6 h-6" /> My coaching
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hey {firstName} — here's how your last 30 days have looked. Personal trends, what to work on, and what you've crushed.
        </p>
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your coaching view…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {!loading && !error && (
        <>
          {/* Today snapshot — quick end-of-shift recap */}
          {stats.todayCount > 0 && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wide">Today</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Calls scored</div>
                    <div className="text-2xl font-semibold tabular-nums mt-0.5">{stats.todayCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Avg score</div>
                    <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${scoreColor(stats.todayAvg)}`}>{stats.todayAvg ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Flagged today</div>
                    <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${stats.todayFlagged > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{stats.todayFlagged}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Open work</div>
                    <div className="text-2xl font-semibold tabular-nums mt-0.5">{callbacks.length + outreachOwed.length + vobOwed.length + assignments.length}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{callbacks.length} cb · {outreachOwed.length} outreach · {vobOwed.length} VOB · {assignments.length} train</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Headline stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Calls (30d)" value={stats.callsCount30} sub={`${stats.callsCount7} this week`} />
            <StatTile
              label="Avg score (30d)"
              value={stats.avg30 ?? "—"}
              valueClass={scoreColor(stats.avg30)}
              sub={
                stats.trend != null
                  ? `${stats.trend > 0 ? "+" : ""}${stats.trend} vs week`
                  : undefined
              }
              trend={stats.trend != null ? (stats.trend >= 0 ? "up" : "down") : undefined}
            />
            <StatTile
              label="Strongest"
              value={stats.best?.label ?? "—"}
              sub={stats.best?.avg != null ? `avg ${stats.best.avg}` : undefined}
              valueClass="text-emerald-700 dark:text-emerald-400 text-base"
            />
            <StatTile
              label="Most to gain"
              value={stats.worst?.label ?? "—"}
              sub={stats.worst?.avg != null ? `avg ${stats.worst.avg}` : undefined}
              valueClass="text-rose-700 dark:text-rose-400 text-base"
            />
          </div>

          {/* Callbacks owed — leads I own + originals I took */}
          {callbacks.length > 0 && (
            <Card className="border-l-4 border-l-amber-500">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><PhoneOff className="w-4 h-4 text-amber-600" /> Callbacks to make</span>
                  <Badge variant="outline" className="text-[10px]">{callbacks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {callbacks.slice(0, 8).map((c) => {
                    const callerLabel = c.caller_name
                      ?? [c.lead?.first_name, c.lead?.last_name].filter(Boolean).join(" ")
                      ?? c.caller_phone_normalized
                      ?? "Unknown";
                    const Icon = c.status === "voicemail" ? Voicemail : PhoneOff;
                    const iconColor = c.status === "voicemail" ? "text-blue-500" : "text-rose-500";
                    const ageMs = c.started_at ? Date.now() - new Date(c.started_at).getTime() : 0;
                    const breached = ageMs > 60 * 60 * 1000;
                    const href = c.lead?.id ? `/leads/${c.lead.id}` : `/live/${c.id}`;
                    return (
                      <Link key={c.id} href={href} className="block">
                        <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-3">
                          <Icon className={`w-4 h-4 ${iconColor} shrink-0 mt-0.5`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{callerLabel}</span>
                              <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                              {c.ownership === "lead_owner" && (
                                <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700 dark:text-blue-400">your lead</Badge>
                              )}
                              {breached && (
                                <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400 gap-1">
                                  <AlertTriangle className="w-3 h-3" /> &gt;1h
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                              {c.caller_phone_normalized && <span><Phone className="w-3 h-3 inline-block" /> {c.caller_phone_normalized}</span>}
                              <span>· {fmtTime(c.started_at)}</span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        </div>
                      </Link>
                    );
                  })}
                  {callbacks.length > 8 && (
                    <div className="text-xs text-muted-foreground text-center pt-1">
                      +{callbacks.length - 8} more
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Outreach owed — leads I own with no recent outbound */}
          {outreachOwed.length > 0 && (
            <Card className="border-l-4 border-l-rose-500">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><PhoneCall className="w-4 h-4 text-rose-600" /> Your leads to call</span>
                  <Badge variant="outline" className="text-[10px]">{outreachOwed.length}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Active leads you own with no outbound contact in the last 3 days.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {outreachOwed.slice(0, 8).map((l) => {
                    const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown";
                    const neverCalled = l.outbound_count === 0;
                    return (
                      <Link key={l.id} href={`/leads/${l.id}`} className="block">
                        <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-3">
                          <PhoneCall className={`w-4 h-4 ${neverCalled ? "text-rose-500" : "text-amber-500"} shrink-0 mt-0.5`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{name}</span>
                              {neverCalled && (
                                <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">never called back</Badge>
                              )}
                              {l.urgency === "high" && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">high urgency</Badge>
                              )}
                              {l.insurance_provider && (
                                <Badge variant="outline" className="text-[10px]">{l.insurance_provider}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                              {l.primary_phone_normalized && <span><Phone className="w-3 h-3 inline-block" /> {l.primary_phone_normalized}</span>}
                              <span>· Last in {fmtDate(l.last_inbound_at)}</span>
                              {l.last_outbound_at && <span>· Last out {fmtDate(l.last_outbound_at)}</span>}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        </div>
                      </Link>
                    );
                  })}
                  {outreachOwed.length > 8 && (
                    <div className="text-xs text-muted-foreground text-center pt-1">
                      +{outreachOwed.length - 8} more
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* VOBs I owe — leads I own with insurance pending verification. */}
          {vobOwed.length > 0 && (
            <Card className="border-l-4 border-l-amber-500">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-600" /> VOBs to verify</span>
                  <Badge variant="outline" className="text-[10px]">{vobOwed.length}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your leads need insurance verification before intake. Call the carrier, capture benefits, mark verified.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {vobOwed.slice(0, 8).map((l) => {
                    const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_phone_normalized || "Unknown";
                    return (
                      <Link key={l.id} href={`/leads/${l.id}`} className="block">
                        <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-3">
                          <ShieldCheck className={`w-4 h-4 ${l.vob_status === "in_progress" ? "text-blue-500" : "text-amber-500"} shrink-0 mt-0.5`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{name}</span>
                              <Badge variant="outline" className={`text-[10px] ${l.vob_status === "in_progress" ? "border-blue-500/40 text-blue-700 dark:text-blue-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400"}`}>
                                {l.vob_status === "in_progress" ? "in progress" : "pending"}
                              </Badge>
                              {l.urgency === "high" && (
                                <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">high urgency</Badge>
                              )}
                              {l.insurance_provider && (
                                <Badge variant="outline" className="text-[10px]">{l.insurance_provider}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                              {l.primary_phone_normalized && <span><Phone className="w-3 h-3 inline-block" /> {l.primary_phone_normalized}</span>}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        </div>
                      </Link>
                    );
                  })}
                  {vobOwed.length > 8 && (
                    <div className="text-xs text-muted-foreground text-center pt-1">
                      +{vobOwed.length - 8} more
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* My outcomes (last-touch attribution) */}
          {(stats.myWon + stats.myLost + stats.myInProgress) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" /> Your closes (30d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <StatTile
                    label="Admitted"
                    value={stats.myWon}
                    valueClass="text-emerald-700 dark:text-emerald-400"
                  />
                  <StatTile
                    label="Churned"
                    value={stats.myLost}
                    valueClass="text-rose-700 dark:text-rose-400"
                  />
                  <StatTile label="Still in progress" value={stats.myInProgress} />
                  <StatTile
                    label="Your conversion"
                    value={stats.myConversionRate == null ? "—" : `${stats.myConversionRate}%`}
                    sub={teamConversionRate != null
                      ? `team ${teamConversionRate}%`
                      : undefined}
                    trend={stats.myConversionRate != null && teamConversionRate != null
                      ? (stats.myConversionRate >= teamConversionRate ? "up" : "down")
                      : undefined}
                  />
                  <StatTile
                    label="Avg days to admit"
                    value={stats.myAvgDaysToAdmit ?? "—"}
                    sub={stats.myAvgDaysToAdmit != null ? `n=${stats.myWon}` : "no admits yet"}
                  />
                </div>
                {stats.recentWins.length > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Recent wins</div>
                    <div className="space-y-1.5">
                      {stats.recentWins.map((w) => (
                        <Link key={w.id} href={`/leads/${w.id}`} className="block">
                          <div className="text-sm hover:bg-accent/50 transition-colors rounded px-2 py-1 -mx-2 flex items-center gap-2">
                            <Trophy className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="flex-1 truncate">
                              {[w.first_name, w.last_name].filter(Boolean).join(" ") || w.primary_phone_normalized || "Unknown"}
                            </span>
                            <span className="text-xs text-muted-foreground">{fmtDate(w.outcome_set_at)}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Trend chart */}
          {stats.trendData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Score trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Two-column: Flagged + Assignments */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Flagged for review */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Flagged for review</span>
                  <Badge variant="outline" className="text-[10px]">{stats.flagged.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats.flagged.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">Nothing flagged. Clean.</p>
                ) : (
                  <div className="space-y-2">
                    {stats.flagged.slice(0, 6).map((s) => (
                      <Link key={s.id} href={s.call?.id ? `/live/${s.call.id}` : "#"} className="block">
                        <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold tabular-nums ${scoreColor(s.composite_score)}`}>{s.composite_score ?? "—"}</span>
                              <span className="text-xs text-muted-foreground">{s.call?.caller_name ?? s.call?.caller_phone_normalized ?? "Unknown"}</span>
                              <span className="text-xs text-muted-foreground">· {fmtTime(s.call?.started_at ?? s.created_at)}</span>
                            </div>
                            {(s.compliance_flags?.length ?? 0) > 0 && (
                              <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                                {(s.compliance_flags as any[])[0]?.flag ?? "Compliance flag"}
                                {(s.compliance_flags?.length ?? 0) > 1 && ` +${s.compliance_flags!.length - 1} more`}
                              </div>
                            )}
                            {s.coaching_takeaways?.what_to_try && s.coaching_takeaways.what_to_try.length > 0 && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Try: {s.coaching_takeaways.what_to_try[0]}
                              </div>
                            )}
                            {s.call?.manager_notes && (
                              <div className="text-xs bg-amber-500/10 border border-amber-500/30 rounded p-1.5 mt-1.5 text-amber-900 dark:text-amber-200">
                                <span className="font-semibold uppercase text-[9px] tracking-wide">From your manager: </span>
                                {s.call.manager_notes}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Training assignments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4" /> Training to do</span>
                  <Badge variant="outline" className="text-[10px]">{assignments.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No open training assignments.</p>
                ) : (
                  <div className="space-y-2">
                    {assignments.slice(0, 6).map((a) => (
                      <Link key={a.id} href={a.scenario_id ? `/training/${a.scenario_id}` : "/training"} className="block">
                        <div className="border-l-4 border-l-amber-500 border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors">
                          <div className="font-medium">{a.scenario?.title ?? "(scenario removed)"}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                            {a.scenario?.difficulty && <Badge variant="secondary" className="text-[10px]">{a.scenario.difficulty}</Badge>}
                            {a.due_at && <span>Due {fmtDate(a.due_at)}</span>}
                            <span className="capitalize">{a.status.replace(/_/g, " ")}</span>
                          </div>
                          {a.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5">"{a.notes}"</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top wins */}
          {stats.wins.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" /> Top wins this month
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.wins.map((w) => (
                    <Link key={w.id} href={w.call?.id ? `/live/${w.call.id}` : "#"} className="block">
                      <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3">
                        <span className={`text-xl font-semibold tabular-nums ${scoreColor(w.composite_score)}`}>{w.composite_score ?? "—"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {w.call?.caller_name ?? w.call?.caller_phone_normalized ?? "Unknown caller"}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <Clock className="w-3 h-3" /> {fmtTime(w.call?.started_at ?? w.created_at)}
                            {w.coaching_takeaways?.what_went_well?.[0] && (
                              <span className="">— {w.coaching_takeaways.what_went_well[0]}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent training session scores */}
          {trainingScores.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Recent practice sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {trainingScores.slice(0, 8).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 text-sm border-b pb-1.5">
                      <span className={`font-semibold tabular-nums w-10 ${scoreColor(t.composite_score)}`}>{t.composite_score ?? "—"}</span>
                      <span className="flex-1 truncate">{t.session?.scenario?.title ?? "Practice scenario"}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(t.created_at)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {scores.length === 0 && (
            <Card>
              <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
                <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No scored calls yet. Once your calls are scored you'll see your trends, flagged calls, and wins here.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, valueClass, trend }: {
  label: string;
  value: string | number;
  sub?: string;
  valueClass?: string;
  trend?: "up" | "down";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 tabular-nums ${valueClass ?? ""}`}>{value}</div>
        {sub && (
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-500" />}
            {trend === "down" && <TrendingDown className="w-3 h-3 text-rose-500" />}
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
