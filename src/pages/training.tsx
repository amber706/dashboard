import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, AlertTriangle, Shield, Calendar, Inbox } from "lucide-react";
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
  scenario: { id: string; title: string; difficulty: string; is_crisis_tagged: boolean } | null;
}

export default function TrainingScenarios() {
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [scRes, asRes] = await Promise.all([
        supabase
          .from("training_scenarios")
          .select("id, title, description, difficulty, is_crisis_tagged, involves_minors, programs, skill_tags")
          .eq("status", "published")
          .order("difficulty", { ascending: true }),
        user?.id
          ? supabase
              .from("training_assignments")
              .select(`
                id, scenario_id, due_at, status, notes,
                scenario:training_scenarios(id, title, difficulty, is_crisis_tagged)
              `)
              .eq("specialist_id", user.id)
              .in("status", ["assigned", "in_progress", "overdue"])
              .order("assigned_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      if (scRes.error) setError(scRes.error.message);
      else setScenarios((scRes.data ?? []) as Scenario[]);
      if (asRes.data) setAssignments(asRes.data as unknown as Assignment[]);
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
