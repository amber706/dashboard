import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, AlertTriangle, Shield, Calendar, Inbox, Route, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Scenario {
  id: string;
  title: string;
  description: string | null;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis_tagged: boolean;
  involves_minors: boolean;
  programs: string[] | null;
  skill_tags: string[] | null;
}

const difficultyColor: Record<Scenario["difficulty"], string> = {
  entry: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  intermediate: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  advanced: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

interface Assignment {
  id: string;
  scenario_id: string | null;
  due_at: string | null;
  status: "assigned" | "in_progress" | "completed" | "overdue";
  notes: string | null;
  source_path_id?: string | null;
  scenario: { id: string; title: string; difficulty: string; is_crisis_tagged: boolean } | null;
}

interface TrainingPath {
  id: string;
  title: string;
  description: string | null;
  scenario_ids: string[];
}

interface PathProgress {
  path: TrainingPath;
  total: number;
  completed: number;
  in_progress: number;
  next_scenario_id: string | null;
  next_scenario_title: string | null;
}

export default function TrainingScenarios() {
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pathProgress, setPathProgress] = useState<PathProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [scRes, asRes, pathsRes] = await Promise.all([
        supabase
          .from("training_scenarios")
          .select("id, title, description, difficulty, is_crisis_tagged, involves_minors, programs, skill_tags")
          .eq("status", "published")
          .order("difficulty", { ascending: true }),
        user?.id
          ? supabase
              .from("training_assignments")
              .select(`
                id, scenario_id, due_at, status, notes, source_path_id,
                scenario:training_scenarios(id, title, difficulty, is_crisis_tagged)
              `)
              .eq("specialist_id", user.id)
              .order("assigned_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("training_paths")
          .select("id, title, description, scenario_ids")
          .eq("is_published", true)
          .order("title"),
      ]);
      if (cancelled) return;
      if (scRes.error) setError(scRes.error.message);
      else setScenarios((scRes.data ?? []) as Scenario[]);
      const allAssignments = (asRes.data ?? []) as unknown as Assignment[];
      // Show only open assignments in the "assigned to you" rail; the full
      // list is used to compute path progress below.
      setAssignments(allAssignments.filter((a) => ["assigned", "in_progress", "overdue"].includes(a.status)));

      // Compute progress per published path. A path scenario is "complete"
      // for the specialist if any training_assignments row for that
      // specialist + scenario has status='completed'.
      const completedScenarioIds = new Set(
        allAssignments.filter((a) => a.status === "completed" && a.scenario_id).map((a) => a.scenario_id!),
      );
      const inProgressScenarioIds = new Set(
        allAssignments.filter((a) => a.status === "in_progress" && a.scenario_id).map((a) => a.scenario_id!),
      );
      const scenarioMap = new Map<string, { id: string; title: string }>();
      for (const sc of (scRes.data ?? []) as Scenario[]) scenarioMap.set(sc.id, { id: sc.id, title: sc.title });

      const progress: PathProgress[] = ((pathsRes.data ?? []) as TrainingPath[]).map((p) => {
        let completed = 0; let inProgress = 0;
        let nextId: string | null = null;
        for (const sId of p.scenario_ids) {
          if (completedScenarioIds.has(sId)) completed++;
          else if (inProgressScenarioIds.has(sId)) {
            inProgress++;
            if (!nextId) nextId = sId;
          } else if (!nextId) {
            nextId = sId;
          }
        }
        return {
          path: p,
          total: p.scenario_ids.length,
          completed,
          in_progress: inProgress,
          next_scenario_id: nextId,
          next_scenario_title: nextId ? scenarioMap.get(nextId)?.title ?? null : null,
        };
      });
      setPathProgress(progress);

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Training Scenarios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Practice intake calls against AI-driven caller personas. Pick a scenario to start a session.
        </p>
      </div>

      {loading && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading scenarios…
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && scenarios.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">No published scenarios yet.</CardContent>
        </Card>
      )}

      {pathProgress.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Route className="w-4 h-4" /> Training paths ({pathProgress.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {pathProgress.map(({ path, total, completed, in_progress, next_scenario_id, next_scenario_title }) => {
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              const isDone = completed === total && total > 0;
              return (
                <Card key={path.id} className={isDone ? "border-emerald-500/30" : ""}>
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                          <span className="truncate">{path.title}</span>
                        </div>
                        {path.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{path.description}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{completed}/{total}</Badge>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full ${isDone ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {!isDone && next_scenario_id && next_scenario_title && (
                      <Link href={`/training/${next_scenario_id}`} className="block">
                        <div className="text-xs flex items-center justify-between gap-2 pt-1">
                          <span className="text-muted-foreground truncate">
                            Next: {next_scenario_title}
                          </span>
                          <span className="text-blue-600 dark:text-blue-400 shrink-0">Start →</span>
                        </div>
                      </Link>
                    )}
                    {in_progress > 0 && !isDone && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400">
                        {in_progress} in progress
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {assignments.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Inbox className="w-4 h-4" /> Assigned to you ({assignments.length})
          </h2>
          <div className="space-y-2">
            {assignments.map((a) => (
              a.scenario ? (
                <Link key={a.id} href={`/training/${a.scenario.id}`} className="block">
                  <Card className="hover:bg-accent/50 transition-colors cursor-pointer border-l-4 border-l-amber-500">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{a.scenario.title}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                            <Badge variant="secondary" className="text-xs">{a.status.replace("_", " ")}</Badge>
                            <Badge variant="secondary" className="text-xs">{a.scenario.difficulty}</Badge>
                            {a.scenario.is_crisis_tagged && (
                              <Badge variant="outline" className="gap-1 text-xs"><AlertTriangle className="w-3 h-3" /> crisis</Badge>
                            )}
                            {a.due_at && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Due {new Date(a.due_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {a.notes && (
                            <p className="text-sm text-muted-foreground mt-1.5">"{a.notes}"</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ) : null
            ))}
          </div>
        </div>
      )}

      {assignments.length > 0 && (
        <h2 className="text-sm font-semibold text-muted-foreground pt-4">Full library</h2>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {scenarios.map((s) => (
          <Link key={s.id} href={`/training/${s.id}`} className="block">
            <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{s.title}</CardTitle>
                  <Badge className={difficultyColor[s.difficulty]} variant="secondary">
                    {s.difficulty}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {s.description && <p className="text-muted-foreground">{s.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {s.is_crisis_tagged && (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="w-3 h-3" /> crisis
                    </Badge>
                  )}
                  {s.involves_minors && (
                    <Badge variant="outline" className="gap-1">
                      <Shield className="w-3 h-3" /> minor
                    </Badge>
                  )}
                  {(s.programs ?? []).map((p) => (
                    <Badge key={p} variant="outline">{p}</Badge>
                  ))}
                </div>
                {s.skill_tags && s.skill_tags.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Skills: {s.skill_tags.join(", ")}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
