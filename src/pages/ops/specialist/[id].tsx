import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft, Loader2, User as UserIcon, Phone, Clock, ChevronRight,
  TrendingUp, TrendingDown, Award, AlertTriangle, ShieldAlert, Trophy,
  GraduationCap, Activity, MessageSquare, Sparkles, RefreshCw,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuditView } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SpecialistProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean;
  created_at: string;
}

interface ScoredCall {
  id: string;
  call_session_id: string;
  composite_score: number | null;
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
  call: {
    id: string;
    caller_name: string | null;
    caller_phone_normalized: string | null;
    started_at: string | null;
    talk_seconds: number | null;
    manager_notes: string | null;
  } | null;
}

interface AssignmentRow {
  id: string;
  due_at: string | null;
  status: string;
  assigned_at: string;
  scenario: { title: string; difficulty: string | null } | null;
}

interface AttributedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  outcome_category: "won" | "lost" | "in_progress" | null;
  outcome_set_at: string | null;
  stage: string | null;
  first_touch_call: { started_at: string | null } | null;
}

const RUBRIC_CATEGORIES: Array<{ key: keyof ScoredCall; label: string }> = [
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
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export default function SpecialistDeepDive() {
  const params = useParams();
  const specialistId = (params as any).id ?? "";
  useAuditView("specialist", specialistId, { surface: "specialist_deep_dive" });

  const [profile, setProfile] = useState<SpecialistProfile | null>(null);
  const [scores, setScores] = useState<ScoredCall[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [outcomes, setOutcomes] = useState<AttributedLead[]>([]);
  const [dispositions, setDispositions] = useState<Array<{ disposition: string; count: number }>>([]);
  const [undispositionedCount, setUndispositionedCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!specialistId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [profileRes, scoresRes, assignmentsRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, role, is_active, created_at").eq("id", specialistId).maybeSingle(),
        supabase
          .from("call_scores")
          .select(`
            id, call_session_id, composite_score, needs_supervisor_review,
            qualification_completeness, rapport_and_empathy, objection_handling, urgency_handling,
            next_step_clarity, script_adherence, compliance, booking_or_transfer, overall_quality,
            compliance_flags, coaching_takeaways, created_at,
            call:call_sessions!inner(id, caller_name, caller_phone_normalized, started_at, talk_seconds, specialist_id, manager_notes)
          `)
          .eq("call.specialist_id", specialistId)
          .gte("created_at", since90)
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("training_assignments")
          .select(`id, due_at, status, assigned_at,
            scenario:training_scenarios(title, difficulty)`)
          .eq("specialist_id", specialistId)
          .order("assigned_at", { ascending: false })
          .limit(30),
      ]);
      if (cancelled) return;
      if (profileRes.error || !profileRes.data) {
        setError(profileRes.error?.message ?? "Specialist not found");
        setLoading(false);
        return;
      }
      setProfile(profileRes.data as SpecialistProfile);

      const scoreRows = ((scoresRes.data ?? []) as any[]).map((r) => ({
        ...r,
        call: r.call ? (Array.isArray(r.call) ? r.call[0] : r.call) : null,
      })) as ScoredCall[];
      setScores(scoreRows);

      setAssignments(((assignmentsRes.data ?? []) as any[]).map((a) => ({
        ...a,
        scenario: Array.isArray(a.scenario) ? a.scenario[0] : a.scenario,
      })) as AssignmentRow[]);

      // Disposition mix (30d) — how this specialist wraps up calls.
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [dispRes, undispRes] = await Promise.all([
        supabase
          .from("call_sessions")
          .select("specialist_disposition")
          .eq("specialist_id", specialistId)
          .not("specialist_disposition", "is", null)
          .gte("disposition_set_at", since30),
        supabase
          .from("call_sessions")
          .select("id", { count: "exact", head: true })
          .eq("specialist_id", specialistId)
          .eq("status", "answered")
          .is("specialist_disposition", null)
          .gte("started_at", since30),
      ]);
      const dispCounts = new Map<string, number>();
      for (const r of (dispRes.data ?? []) as any[]) {
        dispCounts.set(r.specialist_disposition, (dispCounts.get(r.specialist_disposition) ?? 0) + 1);
      }
      if (!cancelled) {
        setDispositions([...dispCounts.entries()].map(([disposition, count]) => ({ disposition, count })).sort((a, b) => b.count - a.count));
        setUndispositionedCount(undispRes.count ?? 0);
      }

      // Outcomes attributed to this specialist (last_touch_call_id is one of their calls)
      const callIds = scoreRows.map((s) => s.call?.id).filter(Boolean) as string[];
      if (callIds.length > 0) {
        const { data: leads } = await supabase
          .from("leads")
          .select(`id, first_name, last_name, outcome_category, outcome_set_at, stage,
            first_touch_call:call_sessions!leads_first_touch_call_id_fkey(started_at)`)
          .in("last_touch_call_id", callIds)
          .order("outcome_set_at", { ascending: false, nullsFirst: false })
          .limit(50);
        if (!cancelled) setOutcomes(((leads ?? []) as any[]).map((l) => ({
          ...l,
          first_touch_call: Array.isArray(l.first_touch_call) ? l.first_touch_call[0] : l.first_touch_call,
        })) as AttributedLead[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [specialistId]);

  const stats = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last7 = scores.filter((s) => new Date(s.created_at).getTime() > sevenDaysAgo);
    const last30 = scores.filter((s) => new Date(s.created_at).getTime() > thirtyDaysAgo);
    const prior7 = scores.filter((s) => {
      const t = new Date(s.created_at).getTime();
      return t <= sevenDaysAgo && t > sevenDaysAgo - 7 * 24 * 60 * 60 * 1000;
    });

    const avg = (rows: ScoredCall[], key: keyof ScoredCall): number | null => {
      const vals = rows.map((r) => r[key]).filter((n): n is number => typeof n === "number");
      if (vals.length === 0) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const avg7 = avg(last7, "composite_score");
    const avg30 = avg(last30, "composite_score");
    const avgPrior7 = avg(prior7, "composite_score");
    const trend = (avg7 != null && avgPrior7 != null) ? avg7 - avgPrior7 : null;

    const byCat = RUBRIC_CATEGORIES.map((c) => ({ key: String(c.key), label: c.label, avg: avg(last30, c.key) }))
      .filter((c) => c.avg != null) as Array<{ key: string; label: string; avg: number }>;
    byCat.sort((a, b) => a.avg - b.avg);

    const trendData = [...scores]
      .reverse()
      .map((s) => ({ date: fmtDate(s.created_at), score: s.composite_score }))
      .filter((p) => p.score != null);

    const flagged = scores.filter((s) =>
      s.needs_supervisor_review || (s.compliance_flags && s.compliance_flags.length > 0),
    ).slice(0, 12);

    const wins = [...last30]
      .filter((s) => (s.composite_score ?? 0) >= 85)
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0))
      .slice(0, 5);

    // Compliance flag frequency by flag type — what's the recurring pattern?
    const flagCounts = new Map<string, number>();
    for (const s of last30) {
      for (const f of (s.compliance_flags ?? []) as any[]) {
        const key = f?.flag ?? "Unspecified";
        flagCounts.set(key, (flagCounts.get(key) ?? 0) + 1);
      }
    }
    const topFlags = Array.from(flagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([flag, count]) => ({ flag, count }));

    const wonCount = outcomes.filter((l) => l.outcome_category === "won").length;
    const lostCount = outcomes.filter((l) => l.outcome_category === "lost").length;
    const inProgressCount = outcomes.filter((l) => l.outcome_category === "in_progress").length;
    const conversionRate = (wonCount + lostCount) > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

    // Speed-to-admit: avg days between first contact and outcome_set_at,
    // for won leads only. Skip leads missing either timestamp.
    const wonWithBoth = outcomes.filter((l) =>
      l.outcome_category === "won" && l.outcome_set_at && l.first_touch_call?.started_at,
    );
    const avgDaysToAdmit = wonWithBoth.length > 0
      ? Math.round(wonWithBoth.reduce((acc, l) => {
          const days = (new Date(l.outcome_set_at!).getTime() - new Date(l.first_touch_call!.started_at!).getTime()) / (1000 * 60 * 60 * 24);
          return acc + days;
        }, 0) / wonWithBoth.length * 10) / 10
      : null;

    return {
      callsCount7: last7.length,
      callsCount30: last30.length,
      avg7, avg30, trend,
      worst: byCat[0] ?? null,
      best: byCat[byCat.length - 1] ?? null,
      byCat,
      trendData, flagged, wins, topFlags,
      wonCount, lostCount, inProgressCount, conversionRate, avgDaysToAdmit,
      avgDaysToAdmitN: wonWithBoth.length,
    };
  }, [scores, outcomes]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading specialist…
        </CardContent></Card>
      </div>
    );
  }
  if (error || !profile) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">{error ?? "Specialist not found"}</p>
            <Link href="/ops/team"><Button variant="outline" size="sm">Back to team</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = profile.full_name ?? profile.email ?? "Unknown";
  const openAssignments = assignments.filter((a) => a.status === "assigned" || a.status === "in_progress");
  const completedAssignments = assignments.filter((a) => a.status === "completed");

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <Link href="/ops/team" className="text-xs text-muted-foreground hover:underline flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> All team
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserIcon className="w-6 h-6" /> {displayName}
          </h1>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] capitalize">{profile.role ?? "specialist"}</Badge>
            {!profile.is_active && <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">inactive</Badge>}
            {profile.email && <span>· {profile.email}</span>}
            <span>· joined {fmtDate(profile.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/ops/training-assignments?specialist=${profile.id}`}>
            <Button size="sm" variant="outline" className="gap-1"><GraduationCap className="w-3.5 h-3.5" /> Assign training</Button>
          </Link>
        </div>
      </div>

      {/* AI 1:1 prep — synthesizes recent signal into 4-6 talking points
          a manager can scan in 30 seconds before the weekly 1:1. */}
      <OneOnOnePrep specialistId={profile.id} />

      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Calls (7d)" value={stats.callsCount7} sub={`${stats.callsCount30} in 30d`} />
        <Tile
          label="Avg score (7d)"
          value={stats.avg7 ?? "—"}
          valueClass={scoreColor(stats.avg7)}
          sub={stats.trend != null ? `${stats.trend > 0 ? "+" : ""}${stats.trend} vs prior 7d` : undefined}
          trend={stats.trend != null ? (stats.trend >= 0 ? "up" : "down") : undefined}
        />
        <Tile
          label="Strongest"
          value={stats.best?.label ?? "—"}
          valueClass="text-emerald-700 dark:text-emerald-400 text-base"
          sub={stats.best?.avg != null ? `avg ${stats.best.avg}` : undefined}
        />
        <Tile
          label="Most to gain"
          value={stats.worst?.label ?? "—"}
          valueClass="text-rose-700 dark:text-rose-400 text-base"
          sub={stats.worst?.avg != null ? `avg ${stats.worst.avg}` : undefined}
        />
        <Tile
          label="Conversion (last touch)"
          value={stats.conversionRate == null ? "—" : `${stats.conversionRate}%`}
          sub={`${stats.wonCount} won · ${stats.lostCount} lost`}
        />
        <Tile
          label="Avg days to admit"
          value={stats.avgDaysToAdmit ?? "—"}
          sub={stats.avgDaysToAdmitN > 0 ? `n=${stats.avgDaysToAdmitN}` : undefined}
        />
      </div>

      {/* Trend chart */}
      {stats.trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" /> Composite score trend
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

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Rubric breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="w-4 h-4" /> Rubric breakdown (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byCat.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No scored calls in the last 30 days.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.byCat.map((c) => (
                  <div key={c.key} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{c.label}</span>
                    <div className="w-32 bg-muted/40 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full ${c.avg >= 80 ? "bg-emerald-500" : c.avg >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${c.avg}%` }}
                      />
                    </div>
                    <span className={`tabular-nums w-8 text-right text-xs font-medium ${scoreColor(c.avg)}`}>{c.avg}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recurring compliance flag patterns */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" /> Recurring compliance issues (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No compliance flags. Clean.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.topFlags.map((f) => (
                  <div key={f.flag} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{f.flag}</span>
                    <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">
                      {f.count}×
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Disposition mix (30d) */}
      {(dispositions.length > 0 || undispositionedCount > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Disposition mix (30d)</span>
              {undispositionedCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">
                  {undispositionedCount} unwrapped
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dispositions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No dispositions set in the last 30 days.</p>
            ) : (() => {
              const total = dispositions.reduce((s, d) => s + d.count, 0);
              const tones: Record<string, string> = {
                interested_followup: "bg-emerald-500",
                booked_intake: "bg-emerald-500",
                transferred: "bg-emerald-500",
                qualified_pending_vob: "bg-blue-500",
                voicemail_left: "bg-blue-500",
                no_answer: "bg-blue-500",
                needs_callback: "bg-amber-500",
                not_qualified: "bg-rose-500",
                wrong_number: "bg-rose-500",
                do_not_call: "bg-rose-500",
                other: "bg-slate-500",
              };
              const labels: Record<string, string> = {
                interested_followup: "Interested",
                booked_intake: "Booked",
                transferred: "Transferred",
                qualified_pending_vob: "Pending VOB",
                voicemail_left: "VM left",
                no_answer: "No answer",
                needs_callback: "Needs cb",
                not_qualified: "Not qualified",
                wrong_number: "Wrong #",
                do_not_call: "DNC",
                other: "Other",
              };
              return (
                <>
                  <div className="flex h-6 rounded overflow-hidden border">
                    {dispositions.map((d) => {
                      const pct = (d.count / total) * 100;
                      return (
                        <div
                          key={d.disposition}
                          className={`${tones[d.disposition] ?? "bg-slate-500"} text-white text-[10px] flex items-center justify-center overflow-hidden whitespace-nowrap`}
                          style={{ width: `${pct}%` }}
                          title={`${labels[d.disposition] ?? d.disposition}: ${d.count} (${pct.toFixed(1)}%)`}
                        >
                          {pct >= 10 ? `${labels[d.disposition] ?? d.disposition}` : ""}
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-3 text-xs">
                    {dispositions.map((d) => (
                      <div key={d.disposition} className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${tones[d.disposition] ?? "bg-slate-500"}`} />
                        <span className="flex-1 truncate">{labels[d.disposition] ?? d.disposition}</span>
                        <span className="tabular-nums text-muted-foreground">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Flagged calls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Recent flagged calls</span>
              <Badge variant="outline" className="text-[10px]">{stats.flagged.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nothing flagged in the last 90 days.</p>
            ) : (
              <div className="space-y-2">
                {stats.flagged.map((s) => (
                  <Link key={s.id} href={s.call?.id ? `/live/${s.call.id}` : "#"} className="block">
                    <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold tabular-nums ${scoreColor(s.composite_score)}`}>{s.composite_score ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{s.call?.caller_name ?? s.call?.caller_phone_normalized ?? "Unknown"}</span>
                          <span className="text-xs text-muted-foreground">· {fmtTime(s.call?.started_at ?? s.created_at)}</span>
                          {s.call?.manager_notes && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 gap-1">
                              <MessageSquare className="w-2.5 h-2.5" /> coached
                            </Badge>
                          )}
                        </div>
                        {(s.compliance_flags?.length ?? 0) > 0 && (
                          <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                            {(s.compliance_flags as any[])[0]?.flag ?? "Compliance flag"}
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

        {/* Recent wins */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Trophy className="w-4 h-4 text-emerald-500" /> Recent wins</span>
              <Badge variant="outline" className="text-[10px]">{stats.wins.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.wins.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No standout calls in the last 30 days.</p>
            ) : (
              <div className="space-y-2">
                {stats.wins.map((w) => (
                  <Link key={w.id} href={w.call?.id ? `/live/${w.call.id}` : "#"} className="block">
                    <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3">
                      <span className={`text-xl font-semibold tabular-nums ${scoreColor(w.composite_score)}`}>{w.composite_score ?? "—"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{w.call?.caller_name ?? w.call?.caller_phone_normalized ?? "Unknown caller"}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" /> {fmtTime(w.call?.started_at ?? w.created_at)}
                          {w.coaching_takeaways?.what_went_well?.[0] && (
                            <span className="truncate">— {w.coaching_takeaways.what_went_well[0]}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Open assignments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4" /> Open training</span>
              <Badge variant="outline" className="text-[10px]">{openAssignments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No open assignments. Inbox zero.</p>
            ) : (
              <div className="space-y-1.5">
                {openAssignments.map((a) => (
                  <div key={a.id} className="border-l-4 border-l-amber-500 border rounded-md p-2 text-sm">
                    <div className="font-medium">{a.scenario?.title ?? "(removed)"}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      {a.scenario?.difficulty && <Badge variant="secondary" className="text-[10px]">{a.scenario.difficulty}</Badge>}
                      {a.due_at && <span>Due {fmtDate(a.due_at)}</span>}
                      <span className="capitalize">{a.status.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed assignments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4" /> Completed training</span>
              <Badge variant="outline" className="text-[10px]">{completedAssignments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {completedAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No completed assignments yet.</p>
            ) : (
              <div className="space-y-1 text-sm">
                {completedAssignments.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 border-b py-1">
                    <span className="flex-1 truncate">{a.scenario?.title ?? "(removed)"}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(a.assigned_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, valueClass, trend }: {
  label: string;
  value: string | number;
  sub?: string;
  valueClass?: string;
  trend?: "up" | "down";
}) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${valueClass ?? ""}`}>{value}</div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-500" />}
          {trend === "down" && <TrendingDown className="w-3 h-3 text-rose-500" />}
          {sub}
        </div>
      )}
    </div>
  );
}


interface TalkingPoint {
  category: "win" | "concern" | "coaching" | "next";
  headline: string;
  detail: string;
  data_ref?: string;
}

const CATEGORY_TONE: Record<string, string> = {
  win: "border-emerald-500/40 bg-emerald-500/5",
  concern: "border-rose-500/40 bg-rose-500/5",
  coaching: "border-amber-500/40 bg-amber-500/5",
  next: "border-blue-500/40 bg-blue-500/5",
};
const CATEGORY_LABEL: Record<string, string> = {
  win: "Win",
  concern: "Concern",
  coaching: "Coaching focus",
  next: "Next step",
};
const CATEGORY_DOT: Record<string, string> = {
  win: "bg-emerald-500",
  concern: "bg-rose-500",
  coaching: "bg-amber-500",
  next: "bg-blue-500",
};

// AI-generated talking points for a 1:1 meeting. Calls generate-1on1-prep
// on demand (no cache yet — Claude is fast enough that a fresh take per
// click is fine, and the data changes between meetings anyway).
function OneOnOnePrep({ specialistId }: { specialistId: string }) {
  const [points, setPoints] = useState<TalkingPoint[] | null>(null);
  // The Cornerstone "Performance and Strategy Review" sections — the
  // formal team 1:1 format. Generated alongside talking_points by
  // generate-1on1-prep. Each entry: { key, title, body }.
  const [formatSections, setFormatSections] = useState<Array<{ key: string; title: string; body: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-1on1-prep`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ specialist_id: specialistId, period_days: 14 }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "generation failed");
      setPoints(json.talking_points ?? []);
      setFormatSections(json.format_sections ?? []);
      setGeneratedAt(json.generated_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-blue-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" />
            1:1 prep
            <span className="text-xs text-muted-foreground font-normal">last 14 days</span>
          </span>
          <Button size="sm" variant={points ? "outline" : "default"} onClick={generate} disabled={loading} className="gap-1.5 h-8">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : points ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? "Generating…" : points ? "Re-generate" : "Generate talking points"}
          </Button>
        </CardTitle>
      </CardHeader>
      {(points || error) && (
        <CardContent>
          {error && <div className="text-sm text-destructive">{error}</div>}
          {points && points.length === 0 && (
            <div className="text-sm text-muted-foreground">Not enough data yet to suggest talking points.</div>
          )}
          {points && points.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {points.map((p, i) => (
                  <div key={i} className={`border rounded-md p-3 ${CATEGORY_TONE[p.category] ?? ""}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOT[p.category] ?? "bg-zinc-500"}`} />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{CATEGORY_LABEL[p.category] ?? p.category}</span>
                    </div>
                    <div className="text-sm font-medium mb-1">{p.headline}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{p.detail}</div>
                    {p.data_ref && (
                      <div className="text-[10px] text-muted-foreground/80 mt-1.5 italic">
                        {p.data_ref}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Cornerstone Performance & Strategy Review — the formal
                  1:1 format the team uses. Pre-filled where data is
                  available; flagged with [NEEDS DATA: …] where Zoho
                  conversion data isn't wired in yet. Manager edits these
                  in the meeting; this is a starting point. */}
              {formatSections && formatSections.length > 0 && (
                <div className="mt-5 pt-5 border-t border-blue-500/20 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Performance & Strategy Review</span>
                    <span className="text-[10px] text-muted-foreground">Cornerstone 1:1 format</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {formatSections.map((s) => (
                      <div key={s.key} className="border rounded-md p-3 bg-muted/20">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                          {s.title}
                        </div>
                        <div className="text-xs whitespace-pre-wrap leading-relaxed">{s.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {generatedAt && (
                <div className="text-[10px] text-muted-foreground mt-3 text-right">
                  Generated {new Date(generatedAt).toLocaleString()}
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
