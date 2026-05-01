import { useEffect, useState, useCallback } from "react";
import { GraduationCap, Loader2, Plus, X, Calendar, User as UserIcon, AlertTriangle, Shield } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface SpecialistOption {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

interface Scenario {
  id: string;
  title: string;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis_tagged: boolean;
  involves_minors: boolean;
}

type AssignmentStatus = "assigned" | "in_progress" | "completed" | "overdue";

interface Assignment {
  id: string;
  specialist_id: string;
  scenario_id: string | null;
  assigned_at: string;
  due_at: string | null;
  status: AssignmentStatus;
  source: "manual" | "auto_suggested";
  completed_at: string | null;
  notes: string | null;
  specialist: { id: string; full_name: string | null; email: string | null } | null;
  scenario: { id: string; title: string; difficulty: string; is_crisis_tagged: boolean } | null;
}

const statusClass: Record<AssignmentStatus, string> = {
  assigned: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  overdue: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const difficultyClass: Record<string, string> = {
  entry: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  intermediate: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  advanced: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function TrainingAssignments() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "all">("all");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [aRes, sRes, scRes] = await Promise.all([
      (() => {
        let q = supabase
          .from("training_assignments")
          .select(`
            id, specialist_id, scenario_id, assigned_at, due_at, status, source,
            completed_at, notes,
            specialist:profiles!training_assignments_specialist_id_fkey(id, full_name, email),
            scenario:training_scenarios(id, title, difficulty, is_crisis_tagged)
          `)
          .order("assigned_at", { ascending: false })
          .limit(100);
        if (statusFilter !== "all") q = q.eq("status", statusFilter);
        return q;
      })(),
      supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("is_active", true)
        .in("role", ["specialist", "manager", "admin"])
        .order("full_name", { ascending: true }),
      supabase
        .from("training_scenarios")
        .select("id, title, difficulty, is_crisis_tagged, involves_minors")
        .eq("status", "published")
        .order("difficulty", { ascending: true }),
    ]);

    if (aRes.error) setError(aRes.error.message);
    else setAssignments((aRes.data ?? []) as unknown as Assignment[]);
    if (sRes.data) setSpecialists(sRes.data as SpecialistOption[]);
    if (scRes.data) setScenarios(scRes.data as Scenario[]);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GraduationCap className="w-6 h-6" />
            Training assignments
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Assign roleplay scenarios to specialists. Assignments show on their Training page until they complete and get scored.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="w-4 h-4 mr-1.5" /> New assignment
        </Button>
      </div>

      {creating && (
        <CreateAssignmentForm
          specialists={specialists}
          scenarios={scenarios}
          assignedBy={user?.id ?? null}
          onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}

      <div className="flex gap-2">
        {(["all", "assigned", "in_progress", "completed", "overdue"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={statusFilter === f ? "default" : "outline"}
            onClick={() => setStatusFilter(f)}
          >
            {f.replace("_", " ")}
          </Button>
        ))}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading assignments…
        </CardContent></Card>
      )}

      {error && (
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {!loading && !error && assignments.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">
          No assignments yet. Click "New assignment" to assign a scenario.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {assignments.map((a) => (
          <Card key={a.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={statusClass[a.status]} variant="secondary">{a.status.replace("_", " ")}</Badge>
                    {a.scenario && (
                      <Badge className={difficultyClass[a.scenario.difficulty] ?? ""} variant="secondary">
                        {a.scenario.difficulty}
                      </Badge>
                    )}
                    {a.scenario?.is_crisis_tagged && (
                      <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" /> crisis</Badge>
                    )}
                  </div>
                  <div className="font-medium">{a.scenario?.title ?? "(scenario removed)"}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      <UserIcon className="w-3 h-3" />
                      {a.specialist?.full_name ?? a.specialist?.email ?? "(unknown)"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Assigned {fmtDate(a.assigned_at)}
                    </span>
                    {a.due_at && (
                      <span className="flex items-center gap-1">
                        Due {fmtDate(a.due_at)}
                      </span>
                    )}
                    {a.completed_at && (
                      <span className="flex items-center gap-1">
                        Completed {fmtDate(a.completed_at)}
                      </span>
                    )}
                    {a.source === "auto_suggested" && (
                      <Badge variant="outline" className="text-[10px]">auto-suggested</Badge>
                    )}
                  </div>
                  {a.notes && (
                    <p className="text-sm text-muted-foreground italic">"{a.notes}"</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateAssignmentForm({
  specialists,
  scenarios,
  assignedBy,
  onCancel,
  onCreated,
}: {
  specialists: SpecialistOption[];
  scenarios: Scenario[];
  assignedBy: string | null;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [specialistIds, setSpecialistIds] = useState<Set<string>>(new Set());
  const [scenarioId, setScenarioId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSpecialist(id: string) {
    setSpecialistIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (specialistIds.size === 0 || !scenarioId) return;
    setSubmitting(true);
    setError(null);
    const rows = [...specialistIds].map((sid) => ({
      specialist_id: sid,
      scenario_id: scenarioId,
      assigned_by: assignedBy,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      notes: notes.trim() || null,
      source: "manual",
      status: "assigned",
    }));
    const { error } = await supabase.from("training_assignments").insert(rows);
    setSubmitting(false);
    if (error) setError(error.message);
    else onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">New training assignment</CardTitle>
          <Button variant="ghost" size="sm" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Specialists ({specialistIds.size} selected)
              </label>
              <div className="flex gap-2 text-[11px]">
                <button type="button" onClick={() => setSpecialistIds(new Set(specialists.map((s) => s.id)))} className="text-primary hover:underline">All</button>
                <button type="button" onClick={() => setSpecialistIds(new Set())} className="text-muted-foreground hover:underline">None</button>
              </div>
            </div>
            <div className="border rounded-md max-h-48 overflow-y-auto">
              {specialists.length === 0 ? (
                <div className="text-xs text-muted-foreground p-3">No specialists found.</div>
              ) : (
                specialists.map((s) => {
                  const checked = specialistIds.has(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/40 cursor-pointer border-b last:border-b-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSpecialist(s.id)}
                        className="accent-primary"
                      />
                      <span className="flex-1 truncate">{s.full_name ?? s.email ?? s.id}</span>
                      <span className="text-[11px] text-muted-foreground">{s.role}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Assign one scenario to multiple specialists at once. One row per specialist will be created.
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Scenario</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              required
              className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm"
            >
              <option value="">Select…</option>
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  [{sc.difficulty}] {sc.title}{sc.is_crisis_tagged ? " (crisis)" : ""}{sc.involves_minors ? " (minor)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Due date (optional)</label>
              <Input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Notes (optional)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., focus on insurance objection handling"
                className="mt-1"
              />
            </div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={submitting || specialistIds.size === 0 || !scenarioId}>
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
              Assign to {specialistIds.size || "—"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
