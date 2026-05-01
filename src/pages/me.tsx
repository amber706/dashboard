import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Award, AlertTriangle, GraduationCap,
  Phone, Loader2, Trophy, Clock, ChevronRight, Activity, Sparkles,
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
  call: { id: string; ctm_call_id: string; caller_name: string | null; caller_phone_normalized: string | null; started_at: string | null; talk_seconds: number | null } | null;
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
          call:call_sessions!inner(id, ctm_call_id, caller_name, caller_phone_normalized, started_at, talk_seconds, specialist_id)
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
    };
  }, [scores]);

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
                              <div className="text-xs text-muted-foreground italic mt-0.5">
                                Try: {s.coaching_takeaways.what_to_try[0]}
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
                            <p className="text-xs italic text-muted-foreground mt-0.5">"{a.notes}"</p>
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
                              <span className="italic">— {w.coaching_takeaways.what_went_well[0]}</span>
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
