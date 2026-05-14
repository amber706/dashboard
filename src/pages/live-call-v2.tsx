import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  ArrowLeft, Loader2, Phone, Clock, Timer, User as UserIcon, Headphones,
  AlertTriangle, MessageSquare, Sparkles, Search, ShieldAlert, GraduationCap, CheckCircle2,
  XCircle, Zap, BookOpen,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuditView } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQueryKb } from "@/lib/workspace-api-stub";
import { PriorConversationsPanel } from "@/components/calls/prior-conversations-panel";

interface Call {
  id: string;
  ctm_call_id: string;
  direction: string;
  status: string;
  caller_phone_normalized: string | null;
  caller_name: string | null;
  started_at: string | null;
  talk_seconds: number | null;
  ctm_raw_payload: any;
  lead_id: string | null;
  manager_notes: string | null;
  manual_score: number | null;
  specialist_disposition: string | null;
  disposition_set_at: string | null;
  disposition_set_by: string | null;
  disposition_notes: string | null;
  // New wrap-up fields (May 2026) — replace the legacy disposition
  // picker with Zoho's Lead_Score_Rating + Lead_Score_Explanation
  // semantics. Values push to the matched Zoho Deal via zoho-writeback.
  lead_score_rating: string | null;
  lead_score_explanation: string | null;
  lead_score_set_at: string | null;
  lead_score_set_by: string | null;
  lead_score_zoho_pushed_at: string | null;
  ai_summary: string | null;
  ai_summary_generated_at: string | null;
  ai_summary_model: string | null;
}

interface Chunk {
  id: string;
  sequence_number: number;
  speaker: string | null;
  content: string;
}

interface Extraction {
  field_name: string;
  extracted_value: string | null;
  confidence: number;
  source_signal: string | null;
  status: string;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  status: string;
  trigger_excerpt: string;
}

interface Score {
  composite_score: number | null;
  caller_sentiment: string | null;
  needs_supervisor_review: boolean | null;
  qualification_completeness: number | null;
  rapport_and_empathy: number | null;
  next_step_clarity: number | null;
  compliance: number | null;
  coaching_takeaways: { what_went_well?: string[]; what_to_try?: string[] } | null;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

function agentName(payload: any): string | null {
  const a = payload?.agent;
  if (!a) return null;
  if (typeof a === "string") return a;
  return a.name ?? a.email ?? null;
}

export default function LiveCallView() {
  const [, params] = useRoute<{ id: string }>("/live/:id");
  const callId = params?.id;
  useAuditView("call_session", callId, { with_transcript: true });

  const [call, setCall] = useState<Call | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);

  const [seedingScenario, setSeedingScenario] = useState(false);
  const [seedResult, setSeedResult] = useState<{ ok: boolean; message: string; scenarioId?: string } | null>(null);

  async function seedScenario() {
    if (!callId) return;
    setSeedingScenario(true); setSeedResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("seed-scenario-from-call", {
        body: { call_session_id: callId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "seed failed");
      const msg = data.already_seeded
        ? `Already seeded as "${data.title}" — review queue`
        : `Created "${data.title}" — pending manager review`;
      setSeedResult({ ok: true, message: msg, scenarioId: data.scenario_id });
    } catch (e) {
      setSeedResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSeedingScenario(false);
    }
  }

  // Initial load + realtime subscription for transcript chunks
  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [callRes, chunkRes, extRes, alertRes, scoreRes] = await Promise.all([
        supabase.from("call_sessions").select("*").eq("id", callId).maybeSingle(),
        supabase.from("transcript_chunks").select("*").eq("call_session_id", callId).order("sequence_number"),
        supabase.from("field_extractions").select("field_name, extracted_value, confidence, source_signal, status").eq("call_session_id", callId).order("confidence", { ascending: false }),
        supabase.from("high_priority_alerts").select("id, alert_type, severity, status, trigger_excerpt").eq("call_session_id", callId),
        supabase.from("call_scores").select("composite_score, caller_sentiment, needs_supervisor_review, qualification_completeness, rapport_and_empathy, next_step_clarity, compliance, coaching_takeaways").eq("call_session_id", callId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (callRes.error) setError(callRes.error.message);
      if (callRes.data) setCall(callRes.data as Call);
      setChunks((chunkRes.data ?? []) as Chunk[]);
      setExtractions((extRes.data ?? []) as Extraction[]);
      setAlerts((alertRes.data ?? []) as Alert[]);
      setScore(scoreRes.data as Score | null);
      setLoading(false);
    })();

    // Realtime: re-fetch chunks whenever new ones land for this call.
    // Keeps the transcript live during the call (CTM fires update events
    // with the full transcript blob; our function replaces chunks).
    const channel = supabase
      .channel(`live-call-${callId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transcript_chunks", filter: `call_session_id=eq.${callId}` },
        async () => {
          const { data } = await supabase
            .from("transcript_chunks")
            .select("*")
            .eq("call_session_id", callId)
            .order("sequence_number");
          if (!cancelled && data) setChunks(data as Chunk[]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "field_extractions", filter: `call_session_id=eq.${callId}` },
        async () => {
          const { data } = await supabase
            .from("field_extractions")
            .select("field_name, extracted_value, confidence, source_signal, status")
            .eq("call_session_id", callId)
            .order("confidence", { ascending: false });
          if (!cancelled && data) setExtractions(data as Extraction[]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "high_priority_alerts", filter: `call_session_id=eq.${callId}` },
        async () => {
          const { data } = await supabase
            .from("high_priority_alerts")
            .select("id, alert_type, severity, status, trigger_excerpt")
            .eq("call_session_id", callId);
          if (!cancelled && data) setAlerts(data as Alert[]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_scores", filter: `call_session_id=eq.${callId}` },
        async () => {
          const { data } = await supabase
            .from("call_scores")
            .select("composite_score, caller_sentiment, needs_supervisor_review, qualification_completeness, rapport_and_empathy, next_step_clarity, compliance, coaching_takeaways")
            .eq("call_session_id", callId)
            .maybeSingle();
          if (!cancelled) setScore(data as Score | null);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [callId]);

  // Auto-scroll transcript when chunks change
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [chunks]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading call…
        </CardContent></Card>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Link href="/ctm-calls" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to call log
        </Link>
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">
          {error ?? "Call not found"}
        </CardContent></Card>
      </div>
    );
  }

  const audio = call.ctm_raw_payload?.audio;
  const agent = agentName(call.ctm_raw_payload);
  const trackingNumber = call.ctm_raw_payload?.tracking_number;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <Link href="/ctm-calls" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to call log
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold">{call.caller_name ?? call.caller_phone_normalized ?? "Unknown caller"}</h1>
                <Badge variant="secondary">{call.direction}</Badge>
                <Badge variant="outline">{call.status}</Badge>
                {call.lead_id && (
                  <Link href={`/leads/${call.lead_id}`} className="text-xs text-primary hover:underline">View lead profile →</Link>
                )}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(call.started_at)}</span>
                <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {fmtDur(call.talk_seconds)}</span>
                {call.caller_phone_normalized && (
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {call.caller_phone_normalized}</span>
                )}
                {agent && <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" /> {agent}</span>}
                {trackingNumber && <span>via {trackingNumber}</span>}
                <span className="font-mono text-[10px]">CTM {call.ctm_call_id}</span>
              </div>
            </div>
            <div className="space-y-2 min-w-[280px]">
              {audio && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    <Headphones className="w-3 h-3" /> Recording
                  </div>
                  <audio controls preload="none" className="w-full" src={String(audio)} />
                </div>
              )}
              {chunks.length >= 8 && (
                <div className="flex items-center gap-2 justify-end">
                  {seedResult && (
                    <span className={`text-xs ${seedResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                      {seedResult.ok && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                      {seedResult.message.slice(0, 100)}
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={seedScenario} disabled={seedingScenario}>
                    {seedingScenario ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <GraduationCap className="w-3 h-3 mr-1.5" />}
                    Seed scenario from this call
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Prior conversations — what we know from earlier calls with the
          same caller. Renders nothing for first-time callers. */}
      {call && (
        <PriorConversationsPanel
          leadId={call.lead_id ?? null}
          phone={call.caller_phone_normalized ?? null}
          excludeCallId={call.id}
        />
      )}

      {/* Post-call snapshot — synthesizes what's known into a quick wrap-up brief */}
      {chunks.length > 0 && <CallSnapshot extractions={extractions} score={score} alerts={alerts} call={call} />}

      {/* AI summary — on-demand 2-paragraph LLM synthesis */}
      {call && chunks.length > 0 && <AiSummaryPanel call={call} onSaved={(c) => setCall(c)} />}

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <Card className="border-l-4 border-l-rose-500">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4" /> {alerts.length} high-priority alert{alerts.length > 1 ? "s" : ""} on this call
            </div>
            {alerts.map((a) => (
              <div key={a.id} className="text-sm">
                <Badge variant="outline" className="mr-2">{a.severity}</Badge>
                <span className="font-medium">{a.alert_type.replace(/_/g, " ")}</span>
                <span className="ml-2 text-muted-foreground">"{a.trigger_excerpt.slice(0, 200)}"</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Two-column body: transcript left, side panels right */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Transcript ({chunks.length} turns)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chunks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No transcript yet. CTM transcribes after the call ends; updates will appear here automatically.
                </p>
              ) : (
                <div ref={transcriptRef} className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-2 text-sm">
                  {chunks.map((c) => (
                    <div key={c.id} className="leading-relaxed">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-2">
                        {c.speaker ?? "?"}:
                      </span>
                      {c.content}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score breakdown */}
          {score && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" /> QA score
                  </CardTitle>
                  <div className="text-right">
                    <span className={`text-2xl font-semibold ${scoreColor(score.composite_score)}`}>{score.composite_score ?? "—"}</span>
                    <span className="text-xs text-muted-foreground ml-1">composite</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    ["qualification_completeness", "Qual"],
                    ["rapport_and_empathy", "Rapport"],
                    ["next_step_clarity", "Next step"],
                    ["compliance", "Compliance"],
                  ].map(([key, label]) => {
                    const v = score[key as keyof Score] as number | null;
                    return (
                      <div key={key} className="border rounded p-2 text-center">
                        <div className="text-muted-foreground">{label}</div>
                        <div className={`text-base font-semibold ${scoreColor(v)}`}>{v ?? "—"}</div>
                      </div>
                    );
                  })}
                </div>
                {score.coaching_takeaways?.what_to_try && score.coaching_takeaways.what_to_try.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Coaching</div>
                    <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                      {score.coaching_takeaways.what_to_try.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Specialist disposition + manager notes */}
          {call && <DispositionPicker call={call} onSaved={(c) => setCall(c)} />}
          {call && <ManagerCallEditor call={call} onSaved={(c) => setCall(c)} />}
        </div>

        {/* Right column: live coaching + KB search + extractions */}
        <div className="space-y-4">
          <LiveCoachingPanel call={call} chunks={chunks} extractions={extractions} />
          <KbSearchPanel />

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Extracted fields ({extractions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {extractions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No extractions yet.</p>
              ) : (
                <div className="space-y-2">
                  {extractions.map((e, i) => (
                    <div key={i} className="border rounded-md p-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs uppercase">{e.field_name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {(e.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-foreground mt-0.5">{e.extracted_value}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Required intake fields for a complete admissions call. Compared
// against field_extractions to show what's still missing while a call
// is in progress. Order matters — the checklist renders in this order.
const REQUIRED_INTAKE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "relationship_to_patient", label: "Relationship to patient" },
  { key: "presenting_substance", label: "Presenting substance" },
  { key: "insurance_provider", label: "Insurance provider" },
  { key: "urgency", label: "Urgency" },
  { key: "callback_preference", label: "Callback preference" },
];

function LiveCoachingPanel({ call, chunks, extractions }: {
  call: Call | null;
  chunks: Chunk[];
  extractions: Extraction[];
}) {
  const queryKb = useQueryKb();
  const lastSearchedRef = useRef<string>("");
  const [kbHits, setKbHits] = useState<Array<{ id: string; title: string; similarity: number }>>([]);
  const [kbSummary, setKbSummary] = useState<string>("");

  const isLive = call?.status === "ringing" || call?.status === "in_progress";

  // Build the recent caller context window from the last few caller turns.
  // Re-runs when chunks change. Debounced via the lastSearchedRef so we
  // don't fire on every keystroke-like update.
  useEffect(() => {
    if (!isLive) return;
    const callerLines = chunks
      .filter((c) => c.speaker && !/(specialist|agent|voicebot|bot|rep)/i.test(c.speaker))
      .slice(-3)
      .map((c) => c.content)
      .join(" ");
    const trimmed = callerLines.trim();
    if (trimmed.length < 20) return;
    if (trimmed === lastSearchedRef.current) return;
    lastSearchedRef.current = trimmed;
    const t = setTimeout(() => {
      queryKb.mutate({ data: { query: trimmed.slice(0, 400) } });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, isLive]);

  // Mirror queryKb response into local state so the panel keeps the
  // last successful match if the next call is still pending.
  useEffect(() => {
    const sources = (queryKb.data?.sources ?? []) as Array<{ id: string; title: string; similarity: number }>;
    if (sources.length > 0) {
      setKbHits(sources.slice(0, 3));
      setKbSummary(queryKb.data?.answer ?? "");
    }
  }, [queryKb.data]);

  const captured = new Set(
    extractions
      .filter((e) => e.extracted_value && e.extracted_value.trim().length > 0)
      .map((e) => e.field_name),
  );
  const missingCount = REQUIRED_INTAKE_FIELDS.filter((f) => !captured.has(f.key)).length;

  return (
    <Card className={isLive ? "border-emerald-500/40" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className={`w-4 h-4 ${isLive ? "text-emerald-500" : "text-muted-foreground"}`} />
          Live coaching
          {isLive && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400">live</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Required intake checklist */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Intake checklist</div>
            <span className="text-[11px] text-muted-foreground">
              {REQUIRED_INTAKE_FIELDS.length - missingCount}/{REQUIRED_INTAKE_FIELDS.length} captured
            </span>
          </div>
          <div className="space-y-1">
            {REQUIRED_INTAKE_FIELDS.map((f) => {
              const has = captured.has(f.key);
              return (
                <div key={f.key} className="flex items-center gap-2 text-sm">
                  {has
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
                  <span className={has ? "text-muted-foreground line-through" : ""}>{f.label}</span>
                </div>
              );
            })}
          </div>
          {!isLive && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Call has ended — checklist is final.
            </p>
          )}
        </div>

        {/* Live KB matches based on what the caller is saying */}
        {isLive && (
          <div className="border-t pt-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" /> Suggested KB
              {queryKb.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            {kbHits.length === 0 && !queryKb.isPending && (
              <p className="text-xs text-muted-foreground">
                Suggestions will appear once the caller starts speaking.
              </p>
            )}
            {kbSummary && (
              <div className="text-xs whitespace-pre-wrap border-l-2 border-primary/30 pl-2 mb-2 text-foreground/80">
                {kbSummary.slice(0, 240)}{kbSummary.length > 240 ? "…" : ""}
              </div>
            )}
            {kbHits.length > 0 && (
              <div className="space-y-1 text-xs">
                {kbHits.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-muted-foreground">
                    <span className="truncate">{h.title}</span>
                    <span className="tabular-nums shrink-0 ml-2">{(h.similarity * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ManagerCallEditor({ call, onSaved }: { call: Call; onSaved: (c: Call) => void }) {
  const [notes, setNotes] = useState(call.manager_notes ?? "");
  const [score, setScore] = useState<string>(call.manual_score == null ? "" : String(call.manual_score));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = notes !== (call.manager_notes ?? "")
    || score !== (call.manual_score == null ? "" : String(call.manual_score));

  async function save() {
    setSaving(true);
    setError(null);
    const trimmedScore = score.trim();
    const numScore = trimmedScore === "" ? null : Number(trimmedScore);
    if (numScore != null && (Number.isNaN(numScore) || numScore < 0 || numScore > 100)) {
      setError("Score must be 0-100");
      setSaving(false);
      return;
    }
    const { data, error: err } = await supabase
      .from("call_sessions")
      .update({ manager_notes: notes.trim() || null, manual_score: numScore })
      .eq("id", call.id)
      .select("*")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved(data as Call);
    setSavedAt(new Date());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Manager notes & score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was important about this call? Anything you want to reference later or push to Zoho."
            className="w-full min-h-[80px] text-sm border rounded-md px-3 py-2 bg-background"
          />
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Manual score (0-100)</div>
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="—"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {savedAt && !dirty && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Saved {savedAt.toLocaleTimeString()}
              </span>
            )}
            <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <p className="text-[11px] text-muted-foreground">
          Notes and manual score are managers-only. The lead-level score / interaction status (which
          push to Zoho) live on the lead detail page.
        </p>
      </CardContent>
    </Card>
  );
}

function KbSearchPanel() {
  const [query, setQuery] = useState("");
  const queryKb = useQueryKb();
  const sources = (queryKb.data?.sources ?? []) as Array<{ id: string; title: string; category: string | null; similarity: number }>;
  const topAnswer = queryKb.data?.answer;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="w-4 h-4" /> KB Search
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) queryKb.mutate({ data: { query: query.trim() } }); }}
              className="flex gap-2 mb-3">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Quick lookup…" className="text-sm" />
          <Button size="sm" type="submit" disabled={queryKb.isPending || !query.trim()}>
            {queryKb.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          </Button>
        </form>
        {queryKb.error && (
          <div className="text-xs text-destructive">{(queryKb.error as Error).message}</div>
        )}
        {queryKb.data && !queryKb.isPending && (
          <div className="space-y-2">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches.</p>
            ) : (
              <>
                <div className="text-sm whitespace-pre-wrap border-l-2 border-primary/30 pl-3">
                  {topAnswer}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t">
                  {sources.map((s) => (
                    <div key={s.id} className="flex justify-between">
                      <span>{s.title}</span>
                      <span className="tabular-nums">{(s.similarity * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === Post-call snapshot ===
// Synthesizes the call into a 30-second wrap-up brief: caller intent
// (from extractions), how it went (from score), suggested next-action
// (rule-based fallback to AI coaching takeaway).
function CallSnapshot({ extractions, score, alerts, call }: {
  extractions: Extraction[];
  score: Score | null;
  alerts: Alert[];
  call: Call;
}) {
  const get = (name: string) => extractions.find((e) => e.field_name === name)?.extracted_value ?? null;
  const insurance = get("insurance_provider");
  const urgency = get("urgency");
  const presenting = get("presenting_substance") ?? get("presenting_mental_health");
  const loc = get("level_of_care_requested");
  const intentParts: string[] = [];
  if (urgency) intentParts.push(`urgency: ${urgency}`);
  if (presenting) intentParts.push(presenting);
  if (insurance) intentParts.push(`insurance: ${insurance}`);
  if (loc) intentParts.push(`LOC: ${loc}`);

  const nextActions: string[] = [];
  if (alerts.length > 0) nextActions.push("Manager should review high-priority alerts before next contact");
  if (score?.needs_supervisor_review) nextActions.push("Flagged for supervisor review");
  if (!insurance && call.direction === "inbound") nextActions.push("Verify insurance — not captured on this call");
  if (urgency === "high") nextActions.push("High-urgency caller — schedule intake within 24h");
  if (call.status === "missed" || call.status === "voicemail" || call.status === "abandoned") {
    nextActions.push("Add to callback queue");
  }
  if (nextActions.length === 0 && score?.coaching_takeaways?.what_to_try?.[0]) {
    nextActions.push(score.coaching_takeaways.what_to_try[0]);
  }

  const composite = score?.composite_score ?? null;
  const verdict = composite == null ? null
    : composite >= 80 ? "Strong call"
    : composite >= 60 ? "Solid; minor gaps"
    : "Below bar — coachable";

  if (intentParts.length === 0 && nextActions.length === 0 && verdict == null) return null;

  return (
    <Card className="border-l-4 border-l-primary">
      <CardContent className="pt-4 pb-4">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wide">Snapshot</div>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Caller intent</div>
            <div>{intentParts.length > 0 ? intentParts.join(" · ") : <span className="text-muted-foreground">Not yet captured</span>}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">How it went</div>
            <div className="flex items-center gap-2">
              {composite != null && (
                <span className={`text-base font-semibold tabular-nums ${scoreColor(composite)}`}>{composite}</span>
              )}
              <span>{verdict ?? <span className="text-muted-foreground">Not scored yet</span>}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Suggested next</div>
            {nextActions.length === 0 ? (
              <span className="text-muted-foreground">No specific action — review and disposition</span>
            ) : (
              <ul className="space-y-0.5 list-disc list-inside">
                {nextActions.slice(0, 3).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Lead score picker ===
// Specialist sets a 1–5 star Lead_Score_Rating + free-text
// Lead_Score_Explanation after wrap-up. Each star maps to a specific
// Zoho picklist value (the full ⭐⭐⭐⭐⭐-prefixed string is what gets
// pushed). Cornerstone's picklist semantics:
//
//   ⭐⭐⭐⭐⭐  Ideal candidate — substance abuse + actively seeking help
//   ⭐⭐⭐⭐   Substance + intention but clear objections
//   ⭐⭐⭐    Substance mentioned but can't pay / not in proximity
//   ⭐⭐     Substance abuse but little intention of treatment
//   ⭐      No substance issue at all
//
// Values verified against production Zoho on 2026-05-13. If
// Cornerstone reorders or renames any value in Zoho, update STAR_RATINGS
// below — the strings must match EXACTLY or Zoho silently drops the
// PUT (including the curly apostrophe in the 3-star value).
const STAR_RATINGS: Array<{ stars: 1 | 2 | 3 | 4 | 5; zoho_value: string; short: string; tone: string }> = [
  { stars: 5, zoho_value: "⭐⭐⭐⭐⭐ Ideal Candidate - Has substance abuse and is seeking help", short: "Ideal candidate — actively seeking help",        tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10" },
  { stars: 4, zoho_value: "⭐⭐⭐⭐ Has substance and intention to seek help but there are clear objections", short: "Has intent but clear objections",                tone: "border-teal-500/40 text-teal-700 dark:text-teal-400 bg-teal-500/10" },
  { stars: 3, zoho_value: "⭐⭐⭐ Mentions substance abuse but unable to pay or isn’t within proximity", short: "Mentions abuse — can't pay / not in proximity",  tone: "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10" },
  { stars: 2, zoho_value: "⭐⭐ Has substance abuse but little intention of entering treatment", short: "Substance abuse but little intention",          tone: "border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/10" },
  { stars: 1, zoho_value: "⭐ Has no substance issue at all", short: "No substance issue at all",                  tone: "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/10" },
];

function ratingMetaForZoho(v: string | null) {
  if (!v) return null;
  return STAR_RATINGS.find((r) => r.zoho_value === v) ?? null;
}

function DispositionPicker({ call, onSaved }: { call: Call; onSaved: (c: Call) => void }) {
  const [rating, setRating] = useState<string | null>(call.lead_score_rating);
  const [explanation, setExplanation] = useState(call.lead_score_explanation ?? "");
  const [saving, setSaving] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const dirty =
    rating !== call.lead_score_rating ||
    explanation.trim() !== (call.lead_score_explanation ?? "").trim();

  async function save() {
    if (!rating) return;
    setSaving(true);
    setPushError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const patch: Record<string, unknown> = {
      lead_score_rating: rating,
      lead_score_explanation: explanation.trim() || null,
      lead_score_set_at: new Date().toISOString(),
      lead_score_set_by: user?.id ?? null,
    };
    const { data, error } = await supabase
      .from("call_sessions")
      .update(patch)
      .eq("id", call.id)
      .select("*")
      .single();
    if (error || !data) {
      setSaving(false);
      setPushError(error?.message ?? "save failed");
      return;
    }
    onSaved(data as Call);

    // Zoho push — fires the dedicated push-lead-score edge function
    // which finds the matched Lead/Deal and patches both fields.
    // Non-blocking so the UI feels snappy; the local row is saved
    // regardless of whether the push succeeds.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-lead-score`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ call_session_id: call.id }),
      });
      const json = await res.json();
      if (!json.ok) setPushError(`Saved locally; Zoho push failed: ${json.error ?? "unknown"}`);
    } catch (e) {
      setPushError(`Saved locally; Zoho push failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  }

  // The picker tracks the SELECTED star count (1-5) for UI purposes,
  // but persists the full Zoho-picklist string. `rating` here is the
  // raw Zoho value (with stars + descriptive text).
  const selectedStars = ratingMetaForZoho(rating)?.stars ?? null;
  const selectedMeta = ratingMetaForZoho(rating);
  const savedMeta = ratingMetaForZoho(call.lead_score_rating);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Lead score</span>
          {savedMeta && (
            <Badge variant="outline" className={`text-[10px] ${savedMeta.tone}`}>
              {"⭐".repeat(savedMeta.stars)} <span className="ml-1 normal-case">{savedMeta.short}</span>
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">Lead Score Rating</div>
          {/* 5-star row — click any star to set that rating. Hovering
              previews the descriptive text below so a rep doesn't have
              to guess what "2 stars" means without the legend open. */}
          <div className="flex items-center gap-1 mb-1.5">
            {[1, 2, 3, 4, 5].map((n) => {
              const meta = STAR_RATINGS.find((r) => r.stars === n)!;
              const active = selectedStars !== null && n <= selectedStars;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === meta.zoho_value ? null : meta.zoho_value)}
                  className={`text-3xl leading-none transition-all ${
                    active ? "scale-110" : "opacity-30 hover:opacity-60"
                  }`}
                  title={`${n} star${n === 1 ? "" : "s"} — ${meta.short}`}
                  aria-label={`Set ${n} star${n === 1 ? "" : "s"}: ${meta.short}`}
                >
                  ⭐
                </button>
              );
            })}
            {selectedMeta && (
              <button
                type="button"
                onClick={() => setRating(null)}
                className="ml-2 text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                clear
              </button>
            )}
          </div>
          {selectedMeta && (
            <div className={`text-[11px] px-2.5 py-1.5 rounded-md border ${selectedMeta.tone}`}>
              {selectedMeta.short}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">Lead Score Explanation</div>
          <Input
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Why this rating? e.g. 'Self-pay, ready to admit Friday, IOP fit.'"
            className="text-sm"
          />
        </div>
        {pushError && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            {pushError}
          </div>
        )}
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRating(call.lead_score_rating); setExplanation(call.lead_score_explanation ?? ""); setPushError(null); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || !rating} onClick={save} className="gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {call.lead_score_rating ? "Update" : "Save & push to Zoho"}
            </Button>
          </div>
        )}
        {call.lead_score_rating && call.lead_score_set_at && !dirty && (
          <div className="text-[10px] text-muted-foreground">
            Set {new Date(call.lead_score_set_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {call.lead_score_zoho_pushed_at
              ? <> · <span className="text-emerald-600 dark:text-emerald-400">synced to Zoho</span></>
              : <> · <span className="text-amber-600 dark:text-amber-400">local only — Zoho push pending</span></>}
            {call.lead_score_explanation && <> · "{call.lead_score_explanation}"</>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === AI summary panel ===
// On-demand LLM summary. First click hits the summarize-call Edge Function;
// subsequent loads return the cached value from call_sessions.ai_summary.
function AiSummaryPanel({ call, onSaved }: { call: Call; onSaved: (c: Call) => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force = false) {
    setGenerating(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("summarize-call", {
        body: { call_session_id: call.id, force },
      });
      if (invokeErr) throw new Error(invokeErr.message);
      if (!data?.ok) throw new Error(data?.error ?? "summarize failed");
      // Refetch the call so cached summary fields populate.
      const { data: refreshed } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("id", call.id)
        .maybeSingle();
      if (refreshed) onSaved(refreshed as Call);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (!call.ai_summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>No AI summary yet for this call.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => generate(false)} disabled={generating} className="gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate
          </Button>
        </CardContent>
        {error && (
          <CardContent className="pt-0 pb-3 text-xs text-destructive">{error}</CardContent>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" /> AI summary</span>
          <Button size="sm" variant="ghost" onClick={() => generate(true)} disabled={generating} className="h-7 gap-1 text-xs">
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Regenerate
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{call.ai_summary}</div>
        <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5" />
          {call.ai_summary_model} · {call.ai_summary_generated_at && new Date(call.ai_summary_generated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
        {error && <div className="text-xs text-destructive mt-2">{error}</div>}
      </CardContent>
    </Card>
  );
}
