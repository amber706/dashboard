import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BarChart3, Loader2, TrendingUp, Target, GraduationCap, Award } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

interface SpecialistStat {
  id: string;
  full_name: string | null;
  email: string | null;
  sessions_completed: number;
  avg_composite: number | null;
  avg_real_call_composite: number | null;
  // Bottom 2 rubric categories (lowest avg score) over the last 30 days of
  // real calls. Each entry has the rubric key + avg score 0-100. We surface
  // these as "areas of improvement" in the per-specialist table.
  weakest_categories: Array<{ category: string; avg: number }>;
  rubric_sample_n: number;
}

// Rubric columns we score on call_scores. These are the 8 categories that
// power the "areas of improvement" column — we average each per specialist
// over the lookback window and pick the lowest two.
const RUBRIC_KEYS = [
  "qualification_completeness",
  "rapport_and_empathy",
  "objection_handling",
  "urgency_handling",
  "next_step_clarity",
  "script_adherence",
  "compliance",
  "booking_or_transfer",
] as const;
type RubricKey = typeof RUBRIC_KEYS[number];

interface ScenarioStat {
  id: string;
  title: string;
  difficulty: string;
  total_assignments: number;
  completed_assignments: number;
  avg_session_score: number | null;
  // Real-call lift: avg composite score of assignees on real calls 14d AFTER
  // completion minus 14d BEFORE. Null when there isn't enough before/after data.
  real_call_lift: number | null;
  lift_sample_n: number;
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

interface PathStat {
  id: string;
  title: string;
  total_scenarios: number;
  specialists_assigned: number;
  specialists_completed: number;
  avg_completion_pct: number;       // 0-100
  real_call_lift: number | null;    // post-completion vs pre-completion lift
  lift_sample_n: number;
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

// Render a composite score as "73 / 100" so the scale is obvious. The
// denominator is dimmed because the headline is the score itself.
function ScoreOutOf100({ value }: { value: number | null }) {
  if (value == null) return <>—</>;
  return (
    <>
      {value}
      <span className="text-muted-foreground font-normal ml-0.5">/100</span>
    </>
  );
}

export default function TrainingAnalytics() {
  const [specialists, setSpecialists] = useState<SpecialistStat[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioStat[]>([]);
  const [paths, setPaths] = useState<PathStat[]>([]);
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
            real_call_count_30d: callCount30d.count ?? 0,
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
              // Pull all 8 rubric columns so we can compute "areas of
              // improvement" — the lowest-scoring categories per specialist.
              supabase
                .from("call_scores")
                .select(`composite_score, ${RUBRIC_KEYS.join(", ")}, call:call_sessions!inner(specialist_id)`)
                .eq("call.specialist_id", p.id)
                .gte("created_at", thirtyDaysAgo),
            ]);
            const sessVals = ((sessionScores.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
            const avgSess = sessVals.length > 0 ? Math.round(sessVals.reduce((a, b) => a + b, 0) / sessVals.length) : null;
            const callRows = (realCallScores.data ?? []) as any[];
            const callVals = callRows.map((r) => r.composite_score).filter((n: number | null): n is number => typeof n === "number");
            const avgCall = callVals.length > 0 ? Math.round(callVals.reduce((a, b) => a + b, 0) / callVals.length) : null;

            // Compute per-rubric averages, then pick the lowest 2. Skip
            // categories with no data so a single-call specialist doesn't
            // get a "compliance: 50" badge from one outlier.
            const rubricAvgs: Array<{ category: string; avg: number }> = [];
            for (const key of RUBRIC_KEYS) {
              const vals = callRows.map((r) => r[key]).filter((n: number | null): n is number => typeof n === "number");
              if (vals.length < 3) continue; // need at least 3 datapoints
              const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
              rubricAvgs.push({ category: key, avg });
            }
            rubricAvgs.sort((a, b) => a.avg - b.avg);
            const weakest = rubricAvgs.slice(0, 2);

            return {
              id: p.id,
              full_name: p.full_name,
              email: p.email,
              sessions_completed: completedSessions.count ?? 0,
              avg_composite: avgSess,
              avg_real_call_composite: avgCall,
              weakest_categories: weakest,
              rubric_sample_n: callVals.length,
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
            const [allAssignments, completedAssignments, sessionScoresForScenario, completedAssignmentsDetail] = await Promise.all([
              supabase.from("training_assignments").select("id", { count: "exact", head: true }).eq("scenario_id", sc.id),
              supabase.from("training_assignments").select("id", { count: "exact", head: true }).eq("scenario_id", sc.id).eq("status", "completed"),
              supabase
                .from("training_session_scores")
                .select("composite_score, session:training_sessions!inner(scenario_id)")
                .eq("session.scenario_id", sc.id),
              // For lift: who completed this scenario, and when?
              supabase
                .from("training_assignments")
                .select("specialist_id, completed_at")
                .eq("scenario_id", sc.id)
                .eq("status", "completed")
                .not("completed_at", "is", null),
            ]);
            const vals = ((sessionScoresForScenario.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
            const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

            // Real-call lift: for each assignee, average score 14d before completion
            // vs 14d after. Then average per-assignee deltas. Need both windows non-empty.
            const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
            const perAssigneeDeltas: number[] = [];
            for (const a of (completedAssignmentsDetail.data ?? []) as any[]) {
              if (!a.specialist_id || !a.completed_at) continue;
              const cutoff = new Date(a.completed_at).getTime();
              const beforeISO = new Date(cutoff - WINDOW_MS).toISOString();
              const afterISO = new Date(cutoff + WINDOW_MS).toISOString();
              const completedISO = new Date(cutoff).toISOString();
              const [beforeRes, afterRes] = await Promise.all([
                supabase
                  .from("call_scores")
                  .select("composite_score, call:call_sessions!inner(specialist_id, started_at)")
                  .eq("call.specialist_id", a.specialist_id)
                  .gte("call.started_at", beforeISO)
                  .lt("call.started_at", completedISO),
                supabase
                  .from("call_scores")
                  .select("composite_score, call:call_sessions!inner(specialist_id, started_at)")
                  .eq("call.specialist_id", a.specialist_id)
                  .gte("call.started_at", completedISO)
                  .lt("call.started_at", afterISO),
              ]);
              const beforeVals = ((beforeRes.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
              const afterVals = ((afterRes.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
              if (beforeVals.length === 0 || afterVals.length === 0) continue;
              const beforeAvg = beforeVals.reduce((x, y) => x + y, 0) / beforeVals.length;
              const afterAvg = afterVals.reduce((x, y) => x + y, 0) / afterVals.length;
              perAssigneeDeltas.push(afterAvg - beforeAvg);
            }
            const lift = perAssigneeDeltas.length > 0
              ? Math.round(perAssigneeDeltas.reduce((x, y) => x + y, 0) / perAssigneeDeltas.length)
              : null;

            return {
              id: sc.id,
              title: sc.title,
              difficulty: sc.difficulty,
              total_assignments: allAssignments.count ?? 0,
              completed_assignments: completedAssignments.count ?? 0,
              avg_session_score: avg,
              real_call_lift: lift,
              lift_sample_n: perAssigneeDeltas.length,
            };
          }),
        );

        if (!cancelled) setScenarios(scenarioStats);

        // ===== Per-path stats =====
        // For each published path: how many specialists are assigned, how
        // many have completed every scenario in the path, average completion
        // pct, and real-call lift (avg composite 14d after path completion
        // minus 14d before).
        const { data: pathRows } = await supabase
          .from("training_paths")
          .select("id, title, scenario_ids")
          .eq("is_published", true);

        const pathsArr = (pathRows ?? []) as Array<{ id: string; title: string; scenario_ids: string[] }>;
        const pathStats: PathStat[] = [];
        for (const p of pathsArr) {
          // All assignments tied to this path (source_path_id) gives us the
          // assigned-via-path specialists. We also count "implicit" path
          // progress when a specialist has completed every scenario in the
          // path even if individual scenarios weren't assigned via path.
          const { data: pathAssignments } = await supabase
            .from("training_assignments")
            .select("specialist_id, scenario_id, status, completed_at")
            .eq("source_path_id", p.id);

          const specToCompletedScenarios = new Map<string, Set<string>>();
          const specSet = new Set<string>();
          for (const a of (pathAssignments ?? []) as Array<{ specialist_id: string; scenario_id: string; status: string; completed_at: string | null }>) {
            specSet.add(a.specialist_id);
            if (a.status === "completed" && a.scenario_id) {
              const s = specToCompletedScenarios.get(a.specialist_id) ?? new Set<string>();
              s.add(a.scenario_id);
              specToCompletedScenarios.set(a.specialist_id, s);
            }
          }

          const completionPcts: number[] = [];
          let specialistsCompleted = 0;
          for (const sId of specSet) {
            const completedScenarios = specToCompletedScenarios.get(sId) ?? new Set<string>();
            const completedInPath = p.scenario_ids.filter((id) => completedScenarios.has(id)).length;
            const pct = p.scenario_ids.length > 0 ? (completedInPath / p.scenario_ids.length) * 100 : 0;
            completionPcts.push(pct);
            if (completedInPath === p.scenario_ids.length && p.scenario_ids.length > 0) {
              specialistsCompleted++;
            }
          }
          const avgCompletionPct = completionPcts.length > 0
            ? Math.round(completionPcts.reduce((a, b) => a + b, 0) / completionPcts.length)
            : 0;

          // Lift: for each specialist who completed the path, find the most
          // recent completed_at among the path's scenarios as their "path
          // completion date." Then average their composite call_scores 14d
          // before vs 14d after.
          const completionDates = new Map<string, string>();
          for (const a of (pathAssignments ?? []) as Array<{ specialist_id: string; scenario_id: string; status: string; completed_at: string | null }>) {
            if (a.status !== "completed" || !a.completed_at) continue;
            const completedScenarios = specToCompletedScenarios.get(a.specialist_id) ?? new Set<string>();
            const inPath = p.scenario_ids.filter((id) => completedScenarios.has(id)).length;
            if (inPath !== p.scenario_ids.length) continue; // only fully-completed
            const cur = completionDates.get(a.specialist_id);
            if (!cur || a.completed_at > cur) completionDates.set(a.specialist_id, a.completed_at);
          }

          const liftDeltas: number[] = [];
          for (const [sId, dateIso] of completionDates) {
            const t = new Date(dateIso).getTime();
            const beforeLo = new Date(t - 14 * 24 * 60 * 60 * 1000).toISOString();
            const afterHi = new Date(t + 14 * 24 * 60 * 60 * 1000).toISOString();
            const { data: scoreCalls } = await supabase
              .from("call_scores")
              .select("composite_score, created_at, call:call_sessions(specialist_id)")
              .gte("created_at", beforeLo)
              .lte("created_at", afterHi);
            const myCalls = ((scoreCalls ?? []) as any[]).filter((sc) => {
              const c = Array.isArray(sc.call) ? sc.call[0] : sc.call;
              return c?.specialist_id === sId;
            });
            const before = myCalls.filter((sc) => sc.created_at < dateIso).map((sc) => sc.composite_score).filter((n: number | null): n is number => typeof n === "number");
            const after = myCalls.filter((sc) => sc.created_at >= dateIso).map((sc) => sc.composite_score).filter((n: number | null): n is number => typeof n === "number");
            if (before.length === 0 || after.length === 0) continue;
            const beforeAvg = before.reduce((a, b) => a + b, 0) / before.length;
            const afterAvg = after.reduce((a, b) => a + b, 0) / after.length;
            liftDeltas.push(afterAvg - beforeAvg);
          }

          const lift = liftDeltas.length > 0
            ? Math.round(liftDeltas.reduce((a, b) => a + b, 0) / liftDeltas.length)
            : null;

          pathStats.push({
            id: p.id,
            title: p.title,
            total_scenarios: p.scenario_ids.length,
            specialists_assigned: specSet.size,
            specialists_completed: specialistsCompleted,
            avg_completion_pct: avgCompletionPct,
            real_call_lift: lift,
            lift_sample_n: liftDeltas.length,
          });
        }

        if (!cancelled) setPaths(pathStats);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell
      number="02"
      eyebrow="ANALYTICS"
      title="Training analytics"
      subtitle="Practice activity, scenario effectiveness, and real-call lift correlation. All composite scores are 0–100; ≥80 strong, 60–79 developing, <60 needs coaching."
    >

      {loading && <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…</CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {company && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard href="/training" icon={<GraduationCap className="w-4 h-4" />} label="Scenarios published" value={company.scenarios_published} />
          <StatCard href="/ops/scenario-review" icon={<Target className="w-4 h-4" />} label="Pending review" value={company.scenarios_pending_review} accent={company.scenarios_pending_review > 0 ? "amber" : undefined} />
          <StatCard href="/ops/training-assignments" icon={<Award className="w-4 h-4" />} label="Sessions this week" value={company.sessions_this_week}
            sub={company.avg_session_score_this_week != null ? `avg score ${company.avg_session_score_this_week}/100` : undefined} />
          <StatCard href="/ops/qa-review" icon={<TrendingUp className="w-4 h-4" />} label="Real-call avg (30d)" value={company.real_call_avg_composite != null ? `${company.real_call_avg_composite}/100` : "—"}
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
                    <th className="text-left py-2 pr-3 pl-4">Areas of improvement</th>
                  </tr>
                </thead>
                <tbody>
                  {specialists.map((s) => (
                    <tr key={s.id} className="border-t align-top">
                      <td className="py-2 pr-3">
                        <Link href={`/ops/specialist/${s.id}`} className="font-medium hover:underline">{s.full_name ?? s.email ?? s.id}</Link>
                        {s.email && s.full_name && <div className="text-xs text-muted-foreground">{s.email}</div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.sessions_completed}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(s.avg_composite)}`}><ScoreOutOf100 value={s.avg_composite} /></td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(s.avg_real_call_composite)}`}><ScoreOutOf100 value={s.avg_real_call_composite} /></td>
                      <td className="py-2 pr-3 pl-4">
                        {s.weakest_categories.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{s.rubric_sample_n < 3 ? "needs more calls" : "—"}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.weakest_categories.map((w) => (
                              <Badge
                                key={w.category}
                                variant="outline"
                                className={`text-[10px] gap-1 ${w.avg < 60 ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : w.avg < 75 ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "border-muted text-muted-foreground"}`}
                                title={`Avg ${w.avg}/100 across ${s.rubric_sample_n} calls (last 30d)`}
                              >
                                {RUBRIC_LABELS[w.category] ?? w.category}
                                <span className="opacity-70 tabular-nums">{w.avg}</span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
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
          <p className="text-xs text-muted-foreground">
            Real-call lift = avg composite score on calls 14d AFTER completion minus 14d BEFORE, averaged across assignees who have data on both sides. Negative lift suggests the scenario isn't moving the needle (or might even be miscalibrated).
          </p>
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">No published scenarios yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Scenario</th>
                    <th className="text-left py-2 pr-3">Difficulty</th>
                    <th className="text-right py-2 pr-3">Assignments</th>
                    <th className="text-right py-2 pr-3">Completed</th>
                    <th className="text-right py-2 pr-3">Avg session score</th>
                    <th className="text-right py-2 pr-3">Real-call lift</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((sc) => {
                    const liftColor = sc.real_call_lift == null ? "text-muted-foreground"
                      : sc.real_call_lift >= 5 ? "text-emerald-700 dark:text-emerald-400"
                      : sc.real_call_lift >= 0 ? "text-amber-700 dark:text-amber-400"
                      : "text-rose-700 dark:text-rose-400";
                    return (
                      <tr key={sc.id} className="border-t">
                        <td className="py-2 pr-3 font-medium">{sc.title}</td>
                        <td className="py-2 pr-3"><Badge variant="secondary" className="text-xs">{sc.difficulty}</Badge></td>
                        <td className="py-2 pr-3 text-right tabular-nums">{sc.total_assignments}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{sc.completed_assignments}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${scoreColor(sc.avg_session_score)}`}><ScoreOutOf100 value={sc.avg_session_score} /></td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${liftColor}`}>
                          {sc.real_call_lift == null ? <span className="text-xs">insufficient data</span> : (
                            <>
                              {sc.real_call_lift > 0 ? "+" : ""}{sc.real_call_lift}
                              <span className="text-[10px] text-muted-foreground ml-1">n={sc.lift_sample_n}</span>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {paths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-path</CardTitle>
            <p className="text-xs text-muted-foreground">
              Path effectiveness — completion rate across assigned specialists
              and real-call lift after path completion. Path lift is harder
              to read than per-scenario lift (longer time horizons, more
              confounding signals); treat as directional.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3">Path</th>
                    <th className="text-right py-2 pr-3">Scenarios</th>
                    <th className="text-right py-2 pr-3">Assigned</th>
                    <th className="text-right py-2 pr-3">Completed (full path)</th>
                    <th className="text-right py-2 pr-3">Avg completion</th>
                    <th className="text-right py-2 pr-3">Real-call lift</th>
                  </tr>
                </thead>
                <tbody>
                  {paths.map((p) => {
                    const liftColor = p.real_call_lift == null ? "text-muted-foreground"
                      : p.real_call_lift >= 5 ? "text-emerald-700 dark:text-emerald-400"
                      : p.real_call_lift >= 0 ? "text-amber-700 dark:text-amber-400"
                      : "text-rose-700 dark:text-rose-400";
                    return (
                      <tr key={p.id} className="border-t">
                        <td className="py-2 pr-3 font-medium">{p.title}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.total_scenarios}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.specialists_assigned}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.specialists_completed}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.avg_completion_pct}%</td>
                        <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${liftColor}`}>
                          {p.real_call_lift == null ? <span className="text-xs">insufficient data</span> : (
                            <>
                              {p.real_call_lift > 0 ? "+" : ""}{p.real_call_lift}
                              <span className="text-[10px] text-muted-foreground ml-1">n={p.lift_sample_n}</span>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
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
