// Training paths.
//
// A path is an ordered list of scenarios. Where individual scenarios
// drill a single skill, a path takes a specialist through a curriculum
// — Beginner → Intermediate → Advanced for new hires, or a tuned
// "you struggle with court-ordered DUI calls, here are 4 reps in
// sequence" path for skill-specific remediation.
//
// Manager flow:
//   1. Create a path (title + description + ordered scenarios)
//   2. Publish to make it visible to specialists on /training
//   3. Bulk-assign the whole path to a specialist with one click
//
// Progress is derived from training_assignments — when a specialist
// completes every scenario in the path, the path is "complete" for
// that specialist. No separate progress table.

import { useEffect, useState, useCallback } from "react";
import {
  Route, Loader2, Plus, Edit3, Save, Trash2, X, GripVertical,
  Send, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/dashboard/PageShell";
import { logAudit } from "@/lib/audit";

interface Scenario {
  id: string;
  title: string;
  difficulty: string | null;
  status: string;
}

interface Specialist {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface TrainingPath {
  id: string;
  title: string;
  description: string | null;
  scenario_ids: string[];
  target_roles: string[] | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export default function OpsTrainingPaths() {
  const { user } = useAuth();
  const [paths, setPaths] = useState<TrainingPath[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrainingPath | "new" | null>(null);
  const [assignTarget, setAssignTarget] = useState<TrainingPath | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [pathsRes, scenariosRes, specsRes] = await Promise.all([
      supabase.from("training_paths").select("*").order("created_at", { ascending: false }),
      supabase.from("training_scenarios").select("id, title, difficulty, status").eq("status", "published").order("title"),
      supabase.from("profiles").select("id, full_name, email").eq("is_active", true).in("role", ["specialist", "manager"]).order("full_name"),
    ]);
    if (pathsRes.error) setError(pathsRes.error.message);
    else setPaths((pathsRes.data ?? []) as TrainingPath[]);
    setScenarios((scenariosRes.data ?? []) as Scenario[]);
    setSpecialists(((specsRes.data ?? []) as Specialist[]).filter((s) => s.full_name));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      number="04"
      eyebrow="CURRICULUM"
      title="Training paths"
      subtitle="Ordered curricula. Stack scenarios into a path — onboarding, remediation, advanced — then assign the whole thing in one click."
      maxWidth={1200}
      actions={
        <Button size="sm" onClick={() => setEditing("new")} className="gap-1.5 h-9">
          <Plus className="w-3.5 h-3.5" /> New path
        </Button>
      }
    >
      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading paths…
        </CardContent></Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && paths.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
            <Route className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>No training paths yet. Click "New path" to start.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {paths.map((p) => (
          <PathRow
            key={p.id}
            path={p}
            scenarios={scenarios}
            onEdit={() => setEditing(p)}
            onAssign={() => setAssignTarget(p)}
            onChanged={load}
          />
        ))}
      </div>

      {editing && (
        <PathEditor
          path={editing === "new" ? null : editing}
          scenarios={scenarios}
          currentUserId={user?.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {assignTarget && (
        <AssignPathDialog
          path={assignTarget}
          specialists={specialists}
          currentUserId={user?.id ?? null}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => { setAssignTarget(null); load(); }}
        />
      )}
    </PageShell>
  );
}

function PathRow({
  path, scenarios, onEdit, onAssign, onChanged,
}: {
  path: TrainingPath;
  scenarios: Scenario[];
  onEdit: () => void;
  onAssign: () => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(false);
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  const ordered = path.scenario_ids
    .map((id) => scenarioMap.get(id))
    .filter((s): s is Scenario => Boolean(s));
  // scenarios that no longer exist (deleted/rejected) — surface as warnings
  const missing = path.scenario_ids.length - ordered.length;

  async function togglePublish() {
    setWorking(true);
    const { error } = await supabase
      .from("training_paths")
      .update({ is_published: !path.is_published })
      .eq("id", path.id);
    setWorking(false);
    if (!error) {
      logAudit("training_paths.publish_toggle", { path_id: path.id, published: !path.is_published });
      onChanged();
    }
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-3" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="text-base flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {expanded ? <ChevronDown className="w-4 h-4 mt-0.5" /> : <ChevronRight className="w-4 h-4 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{path.title}</span>
                <Badge variant={path.is_published ? "default" : "outline"} className="text-[10px]">
                  {path.is_published ? "Published" : "Draft"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{path.scenario_ids.length} scenarios</Badge>
                {missing > 0 && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                    <AlertCircle className="w-3 h-3" /> {missing} unpublished
                  </Badge>
                )}
              </div>
              {path.description && (
                <p className="text-xs text-muted-foreground mt-1 font-normal line-clamp-2">{path.description}</p>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={togglePublish} disabled={working} className="h-8 gap-1">
              {working ? <Loader2 className="w-3 h-3 animate-spin" /> : path.is_published ? <X className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              {path.is_published ? "Unpublish" : "Publish"}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit} className="h-8 gap-1">
              <Edit3 className="w-3 h-3" /> Edit
            </Button>
            {path.is_published && (
              <Button size="sm" onClick={onAssign} className="h-8 gap-1">
                <Send className="w-3 h-3" /> Assign
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1.5">
            {ordered.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 text-sm border-l-2 border-muted pl-3 py-1">
                <span className="text-xs text-muted-foreground tabular-nums w-6">{i + 1}.</span>
                <span className="flex-1 truncate">{s.title}</span>
                {s.difficulty && <Badge variant="outline" className="text-[10px]">{s.difficulty}</Badge>}
              </div>
            ))}
            {ordered.length === 0 && (
              <div className="text-sm text-muted-foreground">No scenarios in this path yet — click Edit to add some.</div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function PathEditor({
  path, scenarios, currentUserId, onClose, onSaved,
}: {
  path: TrainingPath | null;
  scenarios: Scenario[];
  currentUserId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(path?.title ?? "");
  const [description, setDescription] = useState(path?.description ?? "");
  const [orderedIds, setOrderedIds] = useState<string[]>(path?.scenario_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  const orderedScenarios = orderedIds
    .map((id) => scenarioMap.get(id))
    .filter((s): s is Scenario => Boolean(s));
  const availableScenarios = scenarios.filter((s) => !orderedIds.includes(s.id));

  function addScenario(id: string) {
    if (orderedIds.includes(id)) return;
    setOrderedIds([...orderedIds, id]);
  }
  function removeAt(i: number) {
    setOrderedIds(orderedIds.filter((_, idx) => idx !== i));
  }
  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...orderedIds];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setOrderedIds(next);
  }
  function moveDown(i: number) {
    if (i === orderedIds.length - 1) return;
    const next = [...orderedIds];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setOrderedIds(next);
  }

  async function save() {
    if (!title.trim()) { setErr("Title is required."); return; }
    if (orderedIds.length === 0) { setErr("Add at least one scenario."); return; }
    setSaving(true); setErr(null);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      scenario_ids: orderedIds,
    };
    const { error } = path?.id
      ? await supabase.from("training_paths").update(payload).eq("id", path.id)
      : await supabase.from("training_paths").insert({ ...payload, created_by: currentUserId, is_published: false });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    logAudit(path?.id ? "training_paths.update" : "training_paths.create", { path_id: path?.id });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{path ? "Edit training path" : "New training path"}</DialogTitle>
          <DialogDescription>
            Stack published scenarios into an ordered curriculum.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New hire onboarding" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this path covers and who it's for" />
          </div>

          <div className="space-y-1.5">
            <Label>Scenarios in order ({orderedIds.length})</Label>
            <div className="border rounded-md divide-y">
              {orderedScenarios.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">No scenarios yet — pick from the list below.</div>
              )}
              {orderedScenarios.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 p-2 text-sm">
                  <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground tabular-nums w-6">{i + 1}.</span>
                  <span className="flex-1 truncate">{s.title}</span>
                  {s.difficulty && <Badge variant="outline" className="text-[10px]">{s.difficulty}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => moveUp(i)} disabled={i === 0} className="h-7 px-2 text-xs">↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => moveDown(i)} disabled={i === orderedIds.length - 1} className="h-7 px-2 text-xs">↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => removeAt(i)} className="h-7 px-2 text-xs">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Available scenarios ({availableScenarios.length})</Label>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {availableScenarios.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">All published scenarios are in this path.</div>
              )}
              {availableScenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => addScenario(s.id)}
                  className="w-full text-left flex items-center gap-2 p-2 text-sm hover:bg-accent/50 transition-colors border-b last:border-b-0"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{s.title}</span>
                  {s.difficulty && <Badge variant="outline" className="text-[10px]">{s.difficulty}</Badge>}
                </button>
              ))}
            </div>
          </div>

          {err && <div className="text-sm text-destructive">{err}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignPathDialog({
  path, specialists, currentUserId, onClose, onAssigned,
}: {
  path: TrainingPath;
  specialists: Specialist[];
  currentUserId: string | null;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function assign() {
    if (selected.size === 0) { setErr("Pick at least one specialist."); return; }
    if (path.scenario_ids.length === 0) { setErr("This path has no scenarios."); return; }
    setWorking(true); setErr(null);
    // One row per (specialist, scenario) — but only for specialists who don't
    // already have an open assignment for that scenario, so we don't pile up
    // duplicate work on people who've started one of the path's scenarios.
    const specIds = Array.from(selected);
    const { data: existing } = await supabase
      .from("training_assignments")
      .select("specialist_id, scenario_id")
      .in("specialist_id", specIds)
      .in("scenario_id", path.scenario_ids)
      .in("status", ["assigned", "in_progress"]);
    const existingKey = new Set(((existing ?? []) as Array<{ specialist_id: string; scenario_id: string }>).map((r) => `${r.specialist_id}:${r.scenario_id}`));

    const rows: Array<Record<string, unknown>> = [];
    for (const spec of specIds) {
      for (const sc of path.scenario_ids) {
        if (existingKey.has(`${spec}:${sc}`)) continue;
        rows.push({
          specialist_id: spec,
          scenario_id: sc,
          assigned_by: currentUserId,
          status: "assigned",
          source: "training_path",
          source_path_id: path.id,
          notes: note.trim() ? `${path.title}: ${note.trim()}` : `Assigned via "${path.title}" path`,
        });
      }
    }

    if (rows.length === 0) {
      setErr("All selected specialists already have these scenarios assigned or in progress.");
      setWorking(false);
      return;
    }

    // training_assignments may not have source_path_id — strip it if the
    // insert fails. Ideally a migration adds it but we degrade gracefully.
    let { error } = await supabase.from("training_assignments").insert(rows);
    if (error && /column.*source_path_id/i.test(error.message)) {
      const stripped = rows.map((r) => {
        const { source_path_id, ...rest } = r;
        void source_path_id;
        return rest;
      });
      ({ error } = await supabase.from("training_assignments").insert(stripped));
    }

    setWorking(false);
    if (error) {
      setErr(error.message);
      return;
    }
    logAudit("training_paths.assign", { path_id: path.id, specialists: specIds.length, rows_created: rows.length });
    setCreated(rows.length);
    setTimeout(() => onAssigned(), 600);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign "{path.title}"</DialogTitle>
          <DialogDescription>
            {path.scenario_ids.length} scenarios will be assigned to each selected specialist. Existing in-progress assignments are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Specialists</Label>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {specialists.map((s) => (
                <label key={s.id} className="flex items-center gap-2 p-2 text-sm hover:bg-accent/50 cursor-pointer border-b last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="rounded"
                  />
                  <span className="flex-1">{s.full_name ?? s.email}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">{selected.size} selected</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="path-note">Note (optional, attached to each assignment)</Label>
            <Textarea id="path-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why this path, by when, etc." />
          </div>

          {err && <div className="text-sm text-destructive">{err}</div>}
          {created != null && (
            <div className="text-sm text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Created {created} assignment{created === 1 ? "" : "s"}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
          <Button onClick={assign} disabled={working || selected.size === 0} className="gap-1.5">
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Assign path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
