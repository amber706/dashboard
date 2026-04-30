import { useEffect, useState, useCallback } from "react";
import { ShieldAlert, Loader2, Phone, Clock, Timer, User as UserIcon, Headphones, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ScoreRow {
  id: string;
  call_session_id: string;
  composite_score: number | null;
  caller_sentiment: string | null;
  needs_supervisor_review: boolean;
  qualification_completeness: number | null;
  rapport_and_empathy: number | null;
  objection_handling: number | null;
  urgency_handling: number | null;
  next_step_clarity: number | null;
  script_adherence: number | null;
  compliance: number | null;
  booking_or_transfer: number | null;
  overall_quality: number | null;
  quality_signals: any[] | null;
  compliance_flags: any[] | null;
  coaching_takeaways: { what_went_well?: string[]; what_to_try?: string[] } | null;
  graded_by_service_version: string | null;
  supervisor_signoff_at: string | null;
  created_at: string;
  call: {
    id: string;
    ctm_call_id: string;
    caller_phone_normalized: string | null;
    caller_name: string | null;
    started_at: string | null;
    talk_seconds: number | null;
    ctm_raw_payload: any;
  } | null;
}

type Filter = "all" | "needs_review" | "low" | "high" | "unsigned";

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

const RUBRIC: Array<[keyof ScoreRow, string]> = [
  ["qualification_completeness", "Qual."],
  ["rapport_and_empathy", "Rapport"],
  ["objection_handling", "Objection"],
  ["urgency_handling", "Urgency"],
  ["next_step_clarity", "Next step"],
  ["script_adherence", "Script"],
  ["compliance", "Compliance"],
  ["booking_or_transfer", "Booking"],
  ["overall_quality", "Overall"],
];

export default function QAReview() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("needs_review");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("call_scores")
      .select(`
        id, call_session_id, composite_score, caller_sentiment, needs_supervisor_review,
        qualification_completeness, rapport_and_empathy, objection_handling, urgency_handling,
        next_step_clarity, script_adherence, compliance, booking_or_transfer, overall_quality,
        quality_signals, compliance_flags, coaching_takeaways, graded_by_service_version,
        supervisor_signoff_at, created_at,
        call:call_sessions(id, ctm_call_id, caller_phone_normalized, caller_name, started_at, talk_seconds, ctm_raw_payload)
      `)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter === "needs_review") q = q.eq("needs_supervisor_review", true);
    else if (filter === "low") q = q.lt("composite_score", 50);
    else if (filter === "high") q = q.gte("composite_score", 80);
    else if (filter === "unsigned") q = q.is("supervisor_signoff_at", null).eq("needs_supervisor_review", true);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setRows((data ?? []) as unknown as ScoreRow[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function signoff(id: string) {
    const { error } = await supabase
      .from("call_scores")
      .update({ supervisor_signoff_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) load();
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldAlert className="w-6 h-6" />
          QA review
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-scored calls with the same 9-category rubric. Review flagged calls and sign off.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["needs_review", "unsigned", "low", "high", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f.replace("_", " ")}
          </Button>
        ))}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scored calls…
        </CardContent></Card>
      )}
      {error && (<Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>)}
      {!loading && !error && rows.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">No calls in this filter.</CardContent></Card>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const isOpen = expanded === r.id;
          const audio = r.call?.ctm_raw_payload?.audio;
          const agent = r.call?.ctm_raw_payload?.agent;
          return (
            <Card key={r.id} className={r.needs_supervisor_review && !r.supervisor_signoff_at ? "border-l-4 border-l-rose-500" : ""}>
              <CardHeader className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <span className={`text-2xl font-semibold ${scoreColor(r.composite_score)}`}>{r.composite_score ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">composite</span>
                      {r.caller_sentiment && (
                        <Badge variant="outline" className="text-xs">{r.caller_sentiment}</Badge>
                      )}
                      {r.needs_supervisor_review && !r.supervisor_signoff_at && (
                        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400" variant="secondary">needs review</Badge>
                      )}
                      {r.supervisor_signoff_at && (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" variant="secondary">signed off</Badge>
                      )}
                      {(r.compliance_flags?.length ?? 0) > 0 && (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <AlertTriangle className="w-3 h-3" /> {r.compliance_flags!.length} compliance
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(r.call?.started_at ?? r.created_at)}</span>
                      {r.call?.talk_seconds != null && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {fmtDur(r.call.talk_seconds)}</span>}
                      {r.call?.caller_phone_normalized && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.call.caller_phone_normalized}{r.call.caller_name && ` · ${r.call.caller_name}`}</span>}
                      {agent && <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" /> {String(agent)}</span>}
                      {audio && (
                        <a href={String(audio)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-foreground hover:underline">
                          <Headphones className="w-3 h-3" /> Recording
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="border-t pt-4 space-y-4">
                  <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
                    {RUBRIC.map(([key, label]) => {
                      const v = r[key] as number | null;
                      return (
                        <div key={String(key)} className="border rounded-md p-2 text-center">
                          <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
                          <div className={`text-lg font-semibold ${scoreColor(v)}`}>{v ?? "—"}</div>
                        </div>
                      );
                    })}
                  </div>

                  {(r.compliance_flags?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" /> Compliance flags
                      </h4>
                      <div className="space-y-2">
                        {r.compliance_flags!.map((f: any, i: number) => (
                          <div key={i} className="border border-rose-200 dark:border-rose-900 rounded-md p-2.5 text-sm bg-rose-50 dark:bg-rose-950/20">
                            <div className="font-medium">{f.flag}</div>
                            <div className="text-muted-foreground mt-0.5">{f.description}</div>
                            {f.transcript_ref && <div className="text-xs italic mt-1 text-muted-foreground">"{f.transcript_ref}"</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {r.coaching_takeaways && (
                    <div className="grid md:grid-cols-2 gap-3">
                      {r.coaching_takeaways.what_went_well && r.coaching_takeaways.what_went_well.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">What went well</h4>
                          <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                            {r.coaching_takeaways.what_went_well.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                      {r.coaching_takeaways.what_to_try && r.coaching_takeaways.what_to_try.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">What to try next time</h4>
                          <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                            {r.coaching_takeaways.what_to_try.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {r.needs_supervisor_review && !r.supervisor_signoff_at && (
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => signoff(r.id)}>
                        Sign off
                      </Button>
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground border-t pt-2">
                    Scored by {r.graded_by_service_version} · {fmtTime(r.created_at)}
                    {r.call?.ctm_call_id && ` · CTM ${r.call.ctm_call_id}`}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
