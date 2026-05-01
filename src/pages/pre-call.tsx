import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  Phone, User as UserIcon, Clock, ArrowRight, Loader2, History,
  Sparkles, Activity, BookOpen, CheckCircle2, ChevronRight, MessageSquare,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuditView } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Call {
  id: string;
  ctm_call_id: string;
  status: string;
  caller_phone_normalized: string | null;
  caller_name: string | null;
  started_at: string | null;
  ctm_raw_payload: any;
  lead_id: string | null;
}

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone_normalized: string | null;
  stage: string | null;
  outcome_category: "won" | "lost" | "in_progress" | null;
  insurance_provider: string | null;
  program_interest: string[] | null;
  urgency: string | null;
  relationship_to_patient: string | null;
  first_touch_source_category: string | null;
  first_touch_medium: string | null;
  first_touch_campaign: string | null;
  notes: string | null;
  created_at: string;
}

interface PriorCall {
  id: string;
  ctm_call_id: string;
  started_at: string | null;
  talk_seconds: number | null;
  status: string;
  ctm_raw_payload: any;
  score: { composite_score: number | null; coaching_takeaways: { what_went_well?: string[]; what_to_try?: string[] } | null } | null;
}

interface Extraction {
  field_name: string;
  extracted_value: string | null;
  confidence: number;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

const OUTCOME_CLASS: Record<string, string> = {
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  lost: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

export default function PreCall() {
  const params = useParams();
  const callId = (params as any).id ?? "";
  useAuditView("call_session", callId, { surface: "pre_call_brief" });

  const [call, setCall] = useState<Call | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [priorCalls, setPriorCalls] = useState<PriorCall[]>([]);
  const [knownFields, setKnownFields] = useState<Extraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data: callRow, error: callErr } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("id", callId)
        .maybeSingle();
      if (cancelled) return;
      if (callErr || !callRow) {
        setError(callErr?.message ?? "Call not found");
        setLoading(false);
        return;
      }
      setCall(callRow as Call);

      // Lead lookup: prefer linked lead_id, fall back to phone match.
      let leadRow: Lead | null = null;
      if (callRow.lead_id) {
        const { data } = await supabase
          .from("leads")
          .select("*")
          .eq("id", callRow.lead_id)
          .maybeSingle();
        leadRow = data as Lead | null;
      } else if (callRow.caller_phone_normalized) {
        const { data } = await supabase
          .from("leads")
          .select("*")
          .eq("primary_phone_normalized", callRow.caller_phone_normalized)
          .limit(1)
          .maybeSingle();
        leadRow = data as Lead | null;
      }
      if (!cancelled) setLead(leadRow);

      // Prior calls from same caller — show last 5 (excluding current).
      if (callRow.caller_phone_normalized) {
        const { data: priors } = await supabase
          .from("call_sessions")
          .select(`id, ctm_call_id, started_at, talk_seconds, status, ctm_raw_payload,
            score:call_scores(composite_score, coaching_takeaways)`)
          .eq("caller_phone_normalized", callRow.caller_phone_normalized)
          .neq("id", callId)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(5);
        if (!cancelled) {
          const mapped = (priors ?? []).map((p: any) => ({
            ...p,
            score: Array.isArray(p.score) ? p.score[0] : p.score,
          }));
          setPriorCalls(mapped as PriorCall[]);
        }
      }

      // Known fields from prior calls so the specialist doesn't re-ask.
      if (leadRow?.id) {
        const { data: ext } = await supabase
          .from("field_extractions")
          .select("field_name, extracted_value, confidence")
          .eq("lead_id", leadRow.id)
          .not("extracted_value", "is", null)
          .order("confidence", { ascending: false })
          .limit(20);
        if (!cancelled) setKnownFields((ext ?? []) as Extraction[]);
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [callId]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Building pre-call brief…
        </CardContent></Card>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-destructive">{error ?? "No call data"}</p>
            <Link href="/"><Button variant="outline" size="sm">Back to dashboard</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const callerDisplayName = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || call.caller_name || call.caller_phone_normalized
    : call.caller_name ?? call.caller_phone_normalized ?? "Unknown caller";
  const trackingLabel = call.ctm_raw_payload?.tracking_label ?? null;
  const isReturning = priorCalls.length > 0;

  const contextLine: string[] = [];
  if (isReturning) contextLine.push(`${priorCalls.length}${priorCalls.length === 5 ? "+" : ""} prior call${priorCalls.length > 1 ? "s" : ""}`);
  if (lead?.outcome_category && lead.outcome_category !== "in_progress") {
    contextLine.push(lead.outcome_category === "won" ? "previously admitted" : "previously closed lost");
  }
  if (trackingLabel) contextLine.push(`source: ${trackingLabel}`);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* Top strip */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold truncate">{callerDisplayName}</h1>
                {lead?.outcome_category && (
                  <Badge className={`${OUTCOME_CLASS[lead.outcome_category]} border text-[10px] uppercase`} variant="outline">
                    {lead.outcome_category === "won" ? "previously admitted"
                      : lead.outcome_category === "lost" ? "previously closed lost"
                      : "in progress"}
                  </Badge>
                )}
                {!isReturning && lead && (
                  <Badge variant="outline" className="text-[10px]">existing lead, first call</Badge>
                )}
                {!lead && (
                  <Badge variant="outline" className="text-[10px]">new caller</Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                {call.caller_phone_normalized && (
                  <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {call.caller_phone_normalized}</span>
                )}
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {fmtTime(call.started_at)}</span>
                {trackingLabel && (
                  <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> {trackingLabel}</span>
                )}
              </div>
              {contextLine.length > 0 && (
                <div className="text-xs text-foreground/80 italic">
                  {contextLine.join(" · ")}
                </div>
              )}
            </div>
            <Link href={`/live/${call.id}`}>
              <Button size="lg" className="gap-2">
                Open coaching view <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: prior calls + last-call recap */}
        <div className="lg:col-span-2 space-y-4">
          {priorCalls[0]?.score && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Last call recap</span>
                  <Link href={`/live/${priorCalls[0].id}`} className="text-xs text-primary hover:underline">Open →</Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                  <span className={`text-xl font-semibold ${scoreColor(priorCalls[0].score.composite_score)}`}>{priorCalls[0].score.composite_score ?? "—"}</span>
                  <span className="text-xs">composite</span>
                  <span className="text-xs">· {fmtTime(priorCalls[0].started_at)}</span>
                </div>
                {priorCalls[0].score.coaching_takeaways?.what_went_well && priorCalls[0].score.coaching_takeaways.what_went_well.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400 mb-1">What worked last time</div>
                    <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                      {priorCalls[0].score.coaching_takeaways.what_went_well.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {priorCalls[0].score.coaching_takeaways?.what_to_try && priorCalls[0].score.coaching_takeaways.what_to_try.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-400 mb-1">What to try this time</div>
                    <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                      {priorCalls[0].score.coaching_takeaways.what_to_try.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {priorCalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4" /> Call history ({priorCalls.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {priorCalls.map((p) => {
                    const agent = p.ctm_raw_payload?.agent;
                    const agentName = agent?.name ?? agent?.email ?? null;
                    return (
                      <Link key={p.id} href={`/live/${p.id}`} className="block">
                        <div className="border-b py-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{fmtTime(p.started_at)}</span>
                              <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {p.talk_seconds ? `${Math.floor(p.talk_seconds / 60)}m ${p.talk_seconds % 60}s` : "—"}
                              {agentName && ` · ${agentName}`}
                            </div>
                          </div>
                          {p.score?.composite_score != null && (
                            <span className={`text-sm font-semibold ${scoreColor(p.score.composite_score)}`}>{p.score.composite_score}</span>
                          )}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {!isReturning && (
            <Card>
              <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                <UserIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No prior calls from this number. Treat as a fresh intake.
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: lead snapshot + already-captured */}
        <div className="space-y-4">
          {lead && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserIcon className="w-4 h-4" /> Lead snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <SnapshotRow label="Stage" value={lead.stage ?? "—"} />
                <SnapshotRow label="Insurance" value={lead.insurance_provider ?? "—"} />
                <SnapshotRow label="Urgency" value={lead.urgency ?? "—"} />
                <SnapshotRow label="Relationship" value={lead.relationship_to_patient ?? "—"} />
                {lead.program_interest && lead.program_interest.length > 0 && (
                  <SnapshotRow label="Program interest" value={lead.program_interest.join(", ")} />
                )}
                {lead.first_touch_source_category && (
                  <SnapshotRow label="First touch" value={`${lead.first_touch_source_category}${lead.first_touch_medium ? ` / ${lead.first_touch_medium}` : ""}`} />
                )}
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Lead created {fmtDate(lead.created_at)}
                </div>
              </CardContent>
            </Card>
          )}

          {knownFields.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> Already captured
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  We've captured these from prior calls — don't re-ask unless verifying.
                </p>
                <div className="space-y-1 text-sm">
                  {knownFields.slice(0, 8).map((f) => (
                    <div key={f.field_name} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground capitalize">{f.field_name.replace(/_/g, " ")}</div>
                        <div className="truncate">{f.extracted_value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!lead && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> Suggested approach
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>No history on this caller. Use the standard intake flow:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Capture name + relationship to patient</li>
                  <li>Identify presenting substance / mental health</li>
                  <li>Verify insurance</li>
                  <li>Assess urgency + court status</li>
                  <li>Confirm callback preference + next step</li>
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
