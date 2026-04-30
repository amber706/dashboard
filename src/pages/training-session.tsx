import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Loader2, Send, AlertTriangle, Shield, Square, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Scenario {
  id: string;
  title: string;
  description: string | null;
  difficulty: "entry" | "intermediate" | "advanced";
  is_crisis_tagged: boolean;
  involves_minors: boolean;
  programs: string[] | null;
  persona: any;
  context: any;
}

interface Message {
  role: "specialist" | "caller";
  content: string;
}

interface ScoreResult {
  qualification_completeness: number;
  rapport_and_empathy: number;
  objection_handling: number;
  urgency_handling: number;
  next_step_clarity: number;
  script_adherence: number;
  compliance: number;
  booking_or_transfer: number;
  overall_quality: number;
  composite_score: number;
  caller_sentiment: string;
  quality_signals: Array<{ type: string; severity: string; context: string }>;
  compliance_flags: Array<{ flag: string; description: string; transcript_ref: string }>;
  coaching_takeaways: { what_went_well: string[]; what_to_try: string[] };
  caller_felt_heard: boolean;
  debrief: string;
}

export default function TrainingSession() {
  const [, params] = useRoute<{ id: string }>("/training/:id");
  const scenarioId = params?.id;

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadingScenario, setLoadingScenario] = useState(true);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);

  async function endAndScore() {
    if (!scenarioId || messages.length === 0 || scoring) return;
    setScoring(true);
    setScoreError(null);
    try {
      const { data, error } = await supabase.functions.invoke("score-training-session", {
        body: { scenario_id: scenarioId, history: messages },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "score-training-session failed");
      setScore(data as ScoreResult);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoring(false);
    }
  }

  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("training_scenarios")
        .select("id, title, description, difficulty, is_crisis_tagged, involves_minors, programs, persona, context")
        .eq("id", scenarioId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setScenarioError(error.message);
      else if (!data) setScenarioError("Scenario not found");
      else setScenario(data as Scenario);
      setLoadingScenario(false);
    })();
    return () => { cancelled = true; };
  }, [scenarioId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function sendTurn() {
    const text = draft.trim();
    if (!text || thinking || !scenarioId) return;
    setTurnError(null);
    const newSpecialist: Message = { role: "specialist", content: text };
    const historyForCall = [...messages];
    setMessages((m) => [...m, newSpecialist]);
    setDraft("");
    setThinking(true);

    try {
      const { data, error } = await supabase.functions.invoke("roleplay-turn", {
        body: {
          scenario_id: scenarioId,
          history: historyForCall,
          specialist_message: text,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "roleplay-turn failed");
      const callerMessage = String(data.caller_message ?? "");
      setMessages((m) => [...m, { role: "caller", content: callerMessage }]);
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : String(e));
      // Roll back the optimistic specialist add so they can retry
      setMessages((m) => m.slice(0, -1));
      setDraft(text);
    } finally {
      setThinking(false);
    }
  }

  if (loadingScenario) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scenario…
        </CardContent></Card>
      </div>
    );
  }

  if (scenarioError || !scenario) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Link href="/training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to scenarios
        </Link>
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">
          {scenarioError ?? "Scenario not found"}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Link href="/training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to scenarios
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{scenario.title}</CardTitle>
              {scenario.description && (
                <p className="text-sm text-muted-foreground mt-1">{scenario.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{scenario.difficulty}</Badge>
              {scenario.is_crisis_tagged && (
                <Badge variant="outline" className="gap-1"><AlertTriangle className="w-3 h-3" /> crisis</Badge>
              )}
              {scenario.involves_minors && (
                <Badge variant="outline" className="gap-1"><Shield className="w-3 h-3" /> minor</Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div ref={scrollRef} className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground italic text-center py-8">
                Start the conversation. The caller is on the line — open with however you'd answer a real call.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "specialist" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "specialist"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="text-xs opacity-70 mb-0.5">{m.role === "specialist" ? "You" : "Caller"}</div>
                  {m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Caller is thinking…
                </div>
              </div>
            )}
          </div>

          {turnError && (
            <div className="mt-3 text-xs text-destructive">{turnError}</div>
          )}

          {!score && (
            <>
              <div className="mt-4 flex gap-2 items-end">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      sendTurn();
                    }
                  }}
                  placeholder="Type what you'd say to the caller — Cmd+Enter to send"
                  rows={3}
                  className="flex-1 resize-none"
                  disabled={thinking || scoring}
                />
                <Button onClick={sendTurn} disabled={thinking || scoring || !draft.trim()}>
                  {thinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              {messages.length >= 2 && (
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={endAndScore}
                    disabled={scoring || thinking}
                  >
                    {scoring ? (
                      <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Scoring…</>
                    ) : (
                      <><Square className="w-3 h-3 mr-1.5" /> End session and score</>
                    )}
                  </Button>
                </div>
              )}
              {scoreError && <div className="mt-2 text-xs text-destructive text-right">{scoreError}</div>}
            </>
          )}
        </CardContent>
      </Card>

      {score && <Scorecard score={score} />}
    </div>
  );
}

function scoreColor(n: number): string {
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

const RUBRIC_LABELS: Array<[keyof ScoreResult, string]> = [
  ["qualification_completeness", "Qualification"],
  ["rapport_and_empathy", "Rapport & empathy"],
  ["objection_handling", "Objection handling"],
  ["urgency_handling", "Urgency"],
  ["next_step_clarity", "Next-step clarity"],
  ["script_adherence", "Script adherence"],
  ["compliance", "Compliance"],
  ["booking_or_transfer", "Booking / transfer"],
  ["overall_quality", "Overall quality"],
];

function Scorecard({ score }: { score: ScoreResult }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Session debrief</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Caller sentiment by end of call: <span className="font-medium">{score.caller_sentiment}</span>
            </p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-semibold ${scoreColor(score.composite_score)}`}>
              {score.composite_score}
            </div>
            <div className="text-xs text-muted-foreground">composite</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {RUBRIC_LABELS.map(([key, label]) => {
            const v = score[key] as number;
            return (
              <div key={key} className="border rounded-md p-2.5">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`text-lg font-semibold ${scoreColor(v)}`}>{v}</div>
              </div>
            );
          })}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Mentor debrief</h3>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{score.debrief}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> What went well
            </h3>
            <ul className="text-sm space-y-1.5 list-disc list-inside text-muted-foreground">
              {(score.coaching_takeaways?.what_went_well ?? []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <XCircle className="w-4 h-4 text-rose-600" /> What to try next time
            </h3>
            <ul className="text-sm space-y-1.5 list-disc list-inside text-muted-foreground">
              {(score.coaching_takeaways?.what_to_try ?? []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        </div>

        {score.compliance_flags && score.compliance_flags.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4" /> Compliance flags
            </h3>
            <div className="space-y-2">
              {score.compliance_flags.map((f, i) => (
                <div key={i} className="border border-rose-200 dark:border-rose-900 rounded-md p-3 text-sm bg-rose-50 dark:bg-rose-950/20">
                  <div className="font-medium">{f.flag}</div>
                  <div className="text-muted-foreground mt-1">{f.description}</div>
                  {f.transcript_ref && (
                    <div className="text-xs italic mt-1.5 text-muted-foreground">"{f.transcript_ref}"</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {score.quality_signals && score.quality_signals.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">All quality signals ({score.quality_signals.length})</summary>
            <div className="mt-2 space-y-2">
              {score.quality_signals.map((s, i) => (
                <div key={i} className="border rounded-md p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={s.type === "positive" ? "secondary" : "outline"} className="text-xs">{s.type}</Badge>
                    <Badge variant="outline" className="text-xs">{s.severity}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-1.5">{s.context}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="text-xs text-muted-foreground border-t pt-3 flex items-center gap-1.5">
          {score.caller_felt_heard ? (
            <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Caller indicated they felt heard</>
          ) : (
            <><XCircle className="w-3.5 h-3.5 text-amber-600" /> Caller did not clearly indicate they felt heard</>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
