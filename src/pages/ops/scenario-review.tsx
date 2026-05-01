import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  GraduationCap, Loader2, CheckCircle2, XCircle, Edit3, ChevronDown, ChevronRight,
  AlertTriangle, Shield, Phone, FileText,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GraduationCap className="w-6 h-6" /> Scenario review
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-seeded training scenarios from real calls. Review, edit, and publish (or reject) before specialists practice against them.
        </p>
      </div>

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
    </div>
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
