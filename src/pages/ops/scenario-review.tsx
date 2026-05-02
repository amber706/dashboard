import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  GraduationCap, Loader2, CheckCircle2, XCircle, Edit3, ChevronDown, ChevronRight,
  AlertTriangle, Shield, Phone, FileText, Plus, X as XIcon, Sparkles, Save,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type ScenarioStatus = "draft" | "pending_review" | "published" | "retired";

interface Scenario {
  id: string;
  title: string;
  description: string | null;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis_tagged: boolean;
  involves_minors: boolean;
  programs: string[] | null;
  skill_tags: string[] | null;
  persona: any;
  context: any;
  objections: any;
  success_criteria: any;
  system_prompt: string;
  status: ScenarioStatus;
  seeded_from_call_id: string | null;
  manager_review_status: string | null;
  manager_reviewed_at: string | null;
  created_at: string;
}

const statusClass: Record<ScenarioStatus, string> = {
  draft: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  pending_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  retired: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const difficultyClass: Record<string, string> = {
  entry: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  intermediate: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  advanced: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ScenarioReview() {
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScenarioStatus | "all">("pending_review");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let q = supabase
      .from("training_scenarios")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setScenarios((data ?? []) as Scenario[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageShell
      number="03"
      eyebrow="LIBRARY"
      title="Scenario review"
      subtitle="AI-seeded scenarios from real calls AND manager-authored scenarios. Review, edit, and publish (or reject) before specialists practice against them."
      maxWidth={1200}
      actions={
        <Button onClick={() => setComposing(true)} className="gap-1.5 h-9">
          <Plus className="w-4 h-4" /> New scenario
        </Button>
      }
    >

      <NewScenarioDialog
        open={composing}
        onOpenChange={setComposing}
        userId={user?.id ?? null}
        onCreated={() => { setComposing(false); load(); setFilter("draft"); }}
      />

      <div className="flex gap-2 flex-wrap">
        {(["pending_review", "published", "draft", "retired", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {loading && <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && scenarios.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">
          No scenarios in this filter. Use the "Seed scenario from this call" button on a live-call view to generate one.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {scenarios.map((s) => (
          <ScenarioRow
            key={s.id}
            scenario={s}
            expanded={expandedId === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
            currentUserId={user?.id ?? null}
            onChanged={load}
          />
        ))}
      </div>
    </PageShell>
  );
}

function ScenarioRow({
  scenario, expanded, onToggle, currentUserId, onChanged,
}: {
  scenario: Scenario; expanded: boolean; onToggle: () => void;
  currentUserId: string | null; onChanged: () => void;
}) {
  const [title, setTitle] = useState(scenario.title);
  const [systemPrompt, setSystemPrompt] = useState(scenario.system_prompt);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<"publish" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function publish() {
    setWorking("publish"); setActionError(null);
    const { error } = await supabase
      .from("training_scenarios")
      .update({
        status: "published",
        title: title.trim() || scenario.title,
        system_prompt: systemPrompt.trim() || scenario.system_prompt,
        manager_review_status: "approved",
        manager_reviewed_by: currentUserId,
        manager_reviewed_at: new Date().toISOString(),
      })
      .eq("id", scenario.id);
    setWorking(null);
    if (error) setActionError(error.message);
    else onChanged();
  }

  async function reject() {
    setWorking("reject"); setActionError(null);
    const { error } = await supabase
      .from("training_scenarios")
      .update({
        status: "retired",
        manager_review_status: "changes_requested",
        manager_reviewed_by: currentUserId,
        manager_reviewed_at: new Date().toISOString(),
      })
      .eq("id", scenario.id);
    setWorking(null);
    if (error) setActionError(error.message);
    else onChanged();
  }

  return (
    <Card className={scenario.status === "pending_review" ? "border-l-4 border-l-amber-500" : ""}>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <Badge className={statusClass[scenario.status]} variant="secondary">{scenario.status.replace(/_/g, " ")}</Badge>
              <Badge className={difficultyClass[scenario.difficulty] ?? ""} variant="secondary">{scenario.difficulty}</Badge>
              {scenario.is_crisis_tagged && (
                <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" /> crisis</Badge>
              )}
              {scenario.involves_minors && (
                <Badge variant="outline" className="gap-1"><Shield className="w-3 h-3" /> minor</Badge>
              )}
              {scenario.seeded_from_call_id && (
                <Badge variant="outline" className="gap-1 text-[10px]"><Phone className="w-3 h-3" /> seeded from call</Badge>
              )}
              <span className="text-xs text-muted-foreground">{fmtTime(scenario.created_at)}</span>
            </div>
            <div className="font-medium">{scenario.title}</div>
            {scenario.description && (
              <p className="text-sm text-muted-foreground">{scenario.description}</p>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {scenario.persona && (
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Persona</div>
                <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-2">{JSON.stringify(scenario.persona, null, 2)}</pre>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Context</div>
                <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-2">{JSON.stringify(scenario.context, null, 2)}</pre>
              </div>
            </div>
          )}

          {scenario.success_criteria && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Success criteria</div>
              <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-2">{JSON.stringify(scenario.success_criteria, null, 2)}</pre>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center justify-between">
              <span>System prompt (drives the LLM caller)</span>
              {scenario.status === "pending_review" && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditing(!editing)}>
                  <Edit3 className="w-3 h-3 mr-1" /> {editing ? "Stop editing" : "Edit"}
                </Button>
              )}
            </div>
            {editing ? (
              <div className="space-y-2">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scenario title" className="text-sm" />
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={10}
                  className="text-sm font-mono"
                />
              </div>
            ) : (
              <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-2 max-h-64 overflow-y-auto">{systemPrompt}</pre>
            )}
          </div>

          {actionError && <div className="text-xs text-destructive">{actionError}</div>}

          {scenario.status === "pending_review" && (
            <div className="flex justify-between pt-1">
              {scenario.seeded_from_call_id && (
                <Link href={`/live/${scenario.seeded_from_call_id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <FileText className="w-3 h-3" /> View source call
                </Link>
              )}
              <div className="flex gap-2 ml-auto">
                <Button size="sm" variant="outline" onClick={reject} disabled={working !== null}>
                  {working === "reject" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <XCircle className="w-3 h-3 mr-1.5" />}
                  Reject
                </Button>
                <Button size="sm" onClick={publish} disabled={working !== null}>
                  {working === "publish" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
                  {editing ? "Save & publish" : "Publish as-is"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// Composes a deterministic system prompt from the structured fields so
// the manager doesn't have to write LLM prompt engineering from scratch.
// They can override in the textarea before saving.
function composeSystemPrompt(input: {
  title: string;
  persona: { name: string; age: string; situation: string };
  context: { presenting: string; insurance: string; urgency: string; relationship: string };
  objections: string;
  successCriteria: string;
  difficulty: string;
  isCrisis: boolean;
  involvesMinors: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`You are roleplaying a caller for an admissions specialist training scenario.`);
  lines.push(`Scenario: ${input.title || "Untitled"}.`);
  lines.push(`Difficulty: ${input.difficulty}.`);
  if (input.isCrisis) lines.push(`This scenario involves a crisis situation. Stay realistic but the specialist should escalate appropriately.`);
  if (input.involvesMinors) lines.push(`This scenario involves a minor. The specialist should follow minor-intake protocols.`);
  lines.push("");
  lines.push("CALLER PERSONA:");
  if (input.persona.name) lines.push(`- Name: ${input.persona.name}`);
  if (input.persona.age) lines.push(`- Age: ${input.persona.age}`);
  if (input.persona.situation) lines.push(`- Situation: ${input.persona.situation}`);
  if (input.context.relationship) lines.push(`- Calling for: ${input.context.relationship}`);
  if (input.context.presenting) lines.push(`- Presenting issue: ${input.context.presenting}`);
  if (input.context.insurance) lines.push(`- Insurance: ${input.context.insurance}`);
  if (input.context.urgency) lines.push(`- Urgency: ${input.context.urgency}`);
  lines.push("");
  if (input.objections.trim()) {
    lines.push("OBJECTIONS YOU WILL RAISE (vary your wording, don't list them mechanically):");
    for (const o of input.objections.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      lines.push(`- ${o}`);
    }
    lines.push("");
  }
  if (input.successCriteria.trim()) {
    lines.push("SUCCESS CRITERIA (the specialist should hit these — you don't volunteer them):");
    for (const s of input.successCriteria.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }
  lines.push("BEHAVIOR:");
  lines.push("- Speak naturally, the way a real caller would. Short sentences. Emotion appropriate to the situation.");
  lines.push("- Don't hand the specialist easy answers. Make them ask.");
  lines.push("- If they handle an objection well, soften. If they handle it poorly, push back.");
  lines.push("- Stay in character as the caller throughout. Don't break role to coach the specialist.");
  return lines.join("\n");
}

interface NewScenarioForm {
  title: string;
  description: string;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis: boolean;
  involves_minors: boolean;
  programs: string;        // comma-sep
  skill_tags: string;      // comma-sep
  persona_name: string;
  persona_age: string;
  persona_situation: string;
  context_presenting: string;
  context_insurance: string;
  context_urgency: string;
  context_relationship: string;
  objections: string;       // newline-sep
  success_criteria: string; // newline-sep
  system_prompt: string;
}

const EMPTY_FORM: NewScenarioForm = {
  title: "",
  description: "",
  difficulty: "intermediate",
  is_crisis: false,
  involves_minors: false,
  programs: "",
  skill_tags: "",
  persona_name: "",
  persona_age: "",
  persona_situation: "",
  context_presenting: "",
  context_insurance: "",
  context_urgency: "",
  context_relationship: "self",
  objections: "",
  success_criteria: "",
  system_prompt: "",
};

function NewScenarioDialog({ open, onOpenChange, userId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<NewScenarioForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function regeneratePrompt() {
    const prompt = composeSystemPrompt({
      title: form.title,
      persona: { name: form.persona_name, age: form.persona_age, situation: form.persona_situation },
      context: { presenting: form.context_presenting, insurance: form.context_insurance, urgency: form.context_urgency, relationship: form.context_relationship },
      objections: form.objections,
      successCriteria: form.success_criteria,
      difficulty: form.difficulty,
      isCrisis: form.is_crisis,
      involvesMinors: form.involves_minors,
    });
    setForm({ ...form, system_prompt: prompt });
  }

  async function save(publish: boolean) {
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!form.system_prompt.trim()) { setError("System prompt is required — click 'Regenerate from fields' or write one"); return; }
    setSaving(true);
    setError(null);
    const row = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      difficulty: form.difficulty,
      is_crisis_tagged: form.is_crisis,
      involves_minors: form.involves_minors,
      programs: form.programs.trim() ? form.programs.split(",").map((s) => s.trim()).filter(Boolean) : null,
      skill_tags: form.skill_tags.trim() ? form.skill_tags.split(",").map((s) => s.trim()).filter(Boolean) : null,
      persona: {
        name: form.persona_name || null,
        age: form.persona_age || null,
        situation: form.persona_situation || null,
      },
      context: {
        presenting: form.context_presenting || null,
        insurance: form.context_insurance || null,
        urgency: form.context_urgency || null,
        relationship_to_patient: form.context_relationship || null,
      },
      objections: form.objections.trim() ? form.objections.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [],
      success_criteria: form.success_criteria.trim() ? form.success_criteria.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [],
      system_prompt: form.system_prompt,
      system_prompt_version: 1,
      status: publish ? "published" : "draft",
      created_by: userId,
    };
    const { error: err } = await supabase.from("training_scenarios").insert(row);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setForm(EMPTY_FORM);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setForm(EMPTY_FORM); setError(null); } onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New training scenario</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <FieldGroup label="Title">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Anxious mom calling about her teen son" autoFocus />
            </FieldGroup>
            <FieldGroup label="Difficulty">
              <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as any })} className="h-9 px-2 rounded-md border bg-background text-sm w-full">
                <option value="entry">Entry</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </FieldGroup>
          </div>

          <FieldGroup label="Description (optional, shown on the training list)">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One-line summary for specialists." />
          </FieldGroup>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_crisis} onChange={(e) => setForm({ ...form, is_crisis: e.target.checked })} />
              Crisis-tagged
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.involves_minors} onChange={(e) => setForm({ ...form, involves_minors: e.target.checked })} />
              Involves a minor
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <FieldGroup label="Programs (comma-sep, e.g. inpatient, iop)">
              <Input value={form.programs} onChange={(e) => setForm({ ...form, programs: e.target.value })} />
            </FieldGroup>
            <FieldGroup label="Skill tags (comma-sep, e.g. rapport, objection_handling)">
              <Input value={form.skill_tags} onChange={(e) => setForm({ ...form, skill_tags: e.target.value })} placeholder="rapport, objection_handling, urgency" />
            </FieldGroup>
          </div>

          <Card className="bg-muted/20">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Caller persona</div>
              <div className="grid md:grid-cols-3 gap-3">
                <FieldGroup label="Name (or alias)"><Input value={form.persona_name} onChange={(e) => setForm({ ...form, persona_name: e.target.value })} /></FieldGroup>
                <FieldGroup label="Age"><Input value={form.persona_age} onChange={(e) => setForm({ ...form, persona_age: e.target.value })} placeholder="e.g. 32 or unknown" /></FieldGroup>
                <FieldGroup label="Calling for">
                  <select value={form.context_relationship} onChange={(e) => setForm({ ...form, context_relationship: e.target.value })} className="h-9 px-2 rounded-md border bg-background text-sm w-full">
                    <option value="self">Self</option>
                    <option value="spouse">Spouse</option>
                    <option value="parent">Parent (their child)</option>
                    <option value="child">Child (their parent)</option>
                    <option value="sibling">Sibling</option>
                    <option value="friend">Friend</option>
                    <option value="other">Other</option>
                  </select>
                </FieldGroup>
              </div>
              <FieldGroup label="Situation (1-3 sentences)">
                <Textarea value={form.persona_situation} onChange={(e) => setForm({ ...form, persona_situation: e.target.value })} className="min-h-[60px] text-sm" placeholder="e.g. Calling at 9pm after a relapse. Lost their job last month. Feels like they're out of options." />
              </FieldGroup>
              <div className="grid md:grid-cols-3 gap-3">
                <FieldGroup label="Presenting issue"><Input value={form.context_presenting} onChange={(e) => setForm({ ...form, context_presenting: e.target.value })} placeholder="alcohol + benzos" /></FieldGroup>
                <FieldGroup label="Insurance"><Input value={form.context_insurance} onChange={(e) => setForm({ ...form, context_insurance: e.target.value })} placeholder="AHCCCS / Mercy Care" /></FieldGroup>
                <FieldGroup label="Urgency"><Input value={form.context_urgency} onChange={(e) => setForm({ ...form, context_urgency: e.target.value })} placeholder="high / medium / low" /></FieldGroup>
              </div>
            </CardContent>
          </Card>

          <FieldGroup label="Objections (one per line — what the caller will push back with)">
            <Textarea value={form.objections} onChange={(e) => setForm({ ...form, objections: e.target.value })} className="min-h-[80px] text-sm" placeholder={"I can't afford anything\nI don't have time to leave work\nI tried treatment before and it didn't work"} />
          </FieldGroup>

          <FieldGroup label="Success criteria (one per line — what the specialist should accomplish)">
            <Textarea value={form.success_criteria} onChange={(e) => setForm({ ...form, success_criteria: e.target.value })} className="min-h-[80px] text-sm" placeholder={"Captured callback number\nVerified insurance type\nScheduled VOB call within 24h\nBuilt enough rapport that caller agrees to a callback"} />
          </FieldGroup>

          <Card className="bg-muted/20">
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> System prompt
                </div>
                <Button size="sm" variant="outline" onClick={regeneratePrompt} className="h-7 gap-1 text-xs">
                  Regenerate from fields
                </Button>
              </div>
              <Textarea value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} className="min-h-[180px] font-mono text-xs" placeholder="Click 'Regenerate from fields' to compose this from the structured fields above, then edit as needed." />
              <p className="text-[11px] text-muted-foreground">
                This is what the AI caller actually sees. The fields above feed the regenerator;
                you can also write or paste a prompt directly.
              </p>
            </CardContent>
          </Card>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save as draft
          </Button>
          <Button onClick={() => save(true)} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Publish now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
