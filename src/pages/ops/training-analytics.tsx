import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BarChart3, Loader2, TrendingUp, Target, GraduationCap, Award } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SpecialistStat {
  id: string;
  full_name: string | null;
  email: string | null;
  sessions_completed: number;
  avg_composite: number | null;
  avg_real_call_composite: number | null;
  weakest_real_category: string | null;
  weakest_real_score: number | null;
}

interface ScenarioStat {
  id: string;
  title: string;
  difficulty: string;
  total_assignments: number;
  completed_assignments: number;
  avg_session_score: number | null;
}

interface CompanyStats {
  scenarios_published: number;
  scenarios_pending_review: number;
  active_specialists: number;
  sessions_this_week: number;
  avg_session_score_this_week: number | null;
  real_call_avg_composite: number | null;
  real_call_count_30d: number;
}

const RUBRIC_LABELS: Record<string, string> = {
  qualification_completeness: "Qualification",
  rapport_and_empathy: "Rapport",
  objection_handling: "Objection handling",
  urgency_handling: "Urgency",
  next_step_clarity: "Next-step clarity",
  script_adherence: "Script adherence",
  compliance: "Compliance",
  booking_or_transfer: "Booking",
  overall_quality: "Overall",
};

function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export default function TrainingAnalytics() {
  const [specialists, setSpecialists] = useState<SpecialistStat[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioStat[]>([]);
  const [company, setCompany] = useState<CompanyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Company-wide aggregates
        const [
          { count: pubCount },
          { count: pendCount },
          { count: specCount },
          weekSessions,
          weekScores,
          callScoresAll,
          callCount30d,
        ] = await Promise.all([
          supabase.from("training_scenarios").select("id", { count: "exact", head: true }).eq("status", "published"),
          supabase.from("training_scenarios").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true).in("role", ["specialist", "manager"]),
          supabase.from("training_sessions").select("id, started_at, status").gte("started_at", sevenDaysAgo),
          supabase.from("training_session_scores").select("composite_score, created_at").gte("created_at", sevenDaysAgo),
          supabase.from("call_scores").select("composite_score").gte("created_at", thirtyDaysAgo),
          supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
        ]);

        const sessionsThisWeek = weekSessions.data?.filter((s) => s.status === "completed").length ?? 0;
        const weekScoreVals = (weekScores.data ?? []).map((r) => r.composite_score).filter((n): n is number => n != null);
        const avgWeekScore = weekScoreVals.length > 0 ? Math.round(weekScoreVals.reduce((a, b) => a + b, 0) / weekScoreVals.length) : null;
        const callScoreVals = (callScoresAll.data ?? []).map((r) => r.composite_score).filter((n): n is number => n != null);
        const avgCallScore = callScoreVals.length > 0 ? Math.round(callScoreVals.reduce((a, b) => a + b, 0) / callScoreVals.length) : null;

        if (!cancelled) {
          setCompany({
            scenarios_published: pubCount ?? 0,
            scenarios_pending_review: pendCount ?? 0,
            active_specialists: specCount ?? 0,
            sessions_this_week: sessionsThisWeek,
            avg_session_score_this_week: avgWeekScore,
            real_call_avg_composite: avgCallScore,
            real_call_count_30d: callCount30d ?? 0,
          });
        }

        // Per-specialist
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("is_active", true)
          .in("role", ["specialist", "manager"]);

        const specStats: SpecialistStat[] = await Promise.all(
          (profiles ?? []).map(async (p) => {
            const [completedSessions, sessionScores, realCallScores] = await Promise.all([
              supabase
                .from("training_sessions")
                .select("id", { count: "exact", head: true })
                .eq("specialist_id", p.id)
                .eq("status", "completed"),
              supabase
                .from("training_session_scores")
                .select("composite_score, session:training_sessions!inner(specialist_id)")
                .eq("session.specialist_id", p.id),
              // Real-call scores joined to call_sessions filtered by specialist_id
              // (populated by ctm-webhook from CTM agent.name -> profile lookup).
              supabase
                .from("call_scores")
                .select("composite_score, call:call_sessions!inner(specialist_id)")
                .eq("call.specialist_id", p.id),
            ]);
            const sessVals = ((sessionScores.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
            const avgSess = sessVals.length > 0 ? Math.round(sessVals.reduce((a, b) => a + b, 0) / sessVals.length) : null;
            const callVals = ((realCallScores.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
            const avgCall = callVals.length > 0 ? Math.round(callVals.reduce((a, b) => a + b, 0) / callVals.length) : null;

            return {
              id: p.id,
              full_name: p.full_name,
              email: p.email,
              sessions_completed: completedSessions.count ?? 0,
              avg_composite: avgSess,
              avg_real_call_composite: avgCall,
              weakest_real_category: null,
              weakest_real_score: null,
            };
          }),
        );

        if (!cancelled) setSpecialists(specStats);

        // Per-scenario
        const { data: pubScenarios } = await supabase
          .from("training_scenarios")
          .select("id, title, difficulty")
          .eq("status", "published")
          .order("difficulty", { ascending: true });

        const scenarioStats: ScenarioStat[] = await Promise.all(
          (pubScenarios ?? []).map(async (sc) => {
            const [allAssignments, completedAssignments, sessionScoresForScenario] = await Promise.all([
              supabase.from("training_assignments").select("id", { count: "exact", head: true }).eq("scenario_id", sc.id),
              supabase.from("training_assignments").select("id", { count: "exact", head: true }).eq("scenario_id", sc.id).eq("status", "completed"),
              supabase
                .from("training_session_scores")
                .select("composite_score, session:training_sessions!inner(scenario_id)")
                .eq("session.scenario_id", sc.id),
            ]);
            const vals = ((sessionScoresForScenario.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
            const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

            return {
              id: sc.id,
              title: sc.title,
              difficulty: sc.difficulty,
              total_assignments: allAssignments.count ?? 0,
              completed_assignments: completedAssignments.count ?? 0,
              avg_session_score: avg,
            };
          }),
        );

        if (!cancelled) setScenarios(scenarioStats);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="w-6 h-6" /> Training analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Practice activity, scenario effectiveness, and (eventually) real-call lift correlation.
        </p>
      </div>

      {loading && <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…</CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {company && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard href="/training" icon={<GraduationCap className="w-4 h-4" />} label="Scenarios published" value={company.scenarios_published} />
          <StatCard href="/ops/scenario-review" icon={<Target className="w-4 h-4" />} label="Pending review" value={company.scenarios_pending_review} accent={company.scenarios_pending_review > 0 ? "amber" : undefined} />
          <StatCard href="/ops/training-assignments" icon={<Award className="w-4 h-4" />} label="Sessions this week" value={company.sessions_this_week}
            sub={company.avg_session_score_this_week != null ? `avg score ${company.avg_session_score_this_week}` : undefined} />
          <StatCard href="/ops/qa-review" icon={<TrendingUp className="w-4 h-4" />} label="Real-call avg (30d)" value={company.real_call_avg_composite ?? "—"}
            sub={`${company.real_call_count_30d} calls scored`} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-specialist</CardTitle>
        </CardHeader>
        <CardContent>
          {specialists.length === 0 ? (
            <p className="text-sm text-muted-foreground">No specialists yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Specialist</th>
                    <th className="text-right py-2 pr-3">Sessions completed</th>
                    <th className="text-right py-2 pr-3">Avg session score</th>
                    <th className="text-right py-2 pr-3">Avg real-call score</th>
                  </tr>
                </thead>
                <tbody>
                  {specialists.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{s.full_name ?? s.email ?? s.id}</div>
                        {s.email && s.full_name && <div className="text-xs text-muted-foreground">{s.email}</div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.sessions_completed}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(s.avg_composite)}`}>{s.avg_composite ?? "—"}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(s.avg_real_call_composite)}`}>{s.avg_real_call_composite ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-scenario</CardTitle>
          <p className="text-xs text-muted-foreground">Lift correlation against real-call rubric scores will appear here once specialists have completed sessions AND have real-call scores before/after.</p>
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">No published scenarios yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Scenario</th>
                    <th className="text-left py-2 pr-3">Difficulty</th>
                    <th className="text-right py-2 pr-3">Assignments</th>
                    <th className="text-right py-2 pr-3">Completed</th>
                    <th className="text-right py-2 pr-3">Avg session score</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((sc) => (
                    <tr key={sc.id} className="border-t">
                      <td className="py-2 pr-3 font-medium">{sc.title}</td>
                      <td className="py-2 pr-3"><Badge variant="secondary" className="text-xs">{sc.difficulty}</Badge></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{sc.total_assignments}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{sc.completed_assignments}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(sc.avg_session_score)}`}>{sc.avg_session_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent, href }: { icon: React.ReactNode; label: string; value: any; sub?: string; accent?: "amber"; href?: string }) {
  const accentClass = accent === "amber" ? "border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10" : "";
  const card = (
    <Card className={`${accentClass} ${href ? "hover:bg-accent/50 transition-colors cursor-pointer" : ""}`}>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{card}</Link> : card;
}
