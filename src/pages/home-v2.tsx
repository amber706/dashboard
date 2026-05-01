import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, ShieldAlert, BookOpen, GraduationCap, Phone, Inbox,
  TrendingUp, Loader2, Clock, Sparkles, Headphones, Zap, ChevronRight, Activity,
  PhoneCall, Radio,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface HomeData {
  alerts_pending: number;
  alerts_critical: Array<{ id: string; alert_type: string; trigger_excerpt: string; call_id: string }>;
  calls_today: number;
  calls_24h: number;
  calls_with_transcript: number;
  scores_pending_review: number;
  avg_score_24h: number | null;
  suggestions_open: number;
  suggestions_top: Array<{ id: string; title: string; priority: string; suggestion_type: string }>;
  kb_drafts_pending: number;
  scenarios_pending_review: number;
  my_assignments: Array<{ id: string; scenario_id: string; scenario_title: string; due_at: string | null; manager_note: string | null }>;
  recent_calls: Array<{ id: string; ctm_call_id: string; caller_name: string | null; caller_phone: string | null; status: string; talk_seconds: number | null; started_at: string | null; composite_score: number | null; agent_name: string | null }>;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
const priorityClass: Record<string, string> = {
  critical: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
};

interface ActiveCall {
  id: string;
  caller_name: string | null;
  caller_phone: string | null;
  status: string;
  started_at: string | null;
}

export default function HomeV2() {
  const { user } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active-call watch: when ANY in-progress call is assigned to this user,
  // surface a top-of-page banner so they can jump straight to coaching.
  // Subscribes via Supabase Realtime; works for both initial load and live
  // updates as new calls land.
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function fetchActive() {
      const { data } = await supabase
        .from("call_sessions")
        .select("id, caller_name, caller_phone_normalized, status, started_at")
        .eq("specialist_id", user!.id)
        .in("status", ["ringing", "in_progress"])
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(5);
      if (cancelled) return;
      setActiveCalls((data ?? []).map((c) => ({
        id: c.id,
        caller_name: c.caller_name,
        caller_phone: c.caller_phone_normalized,
        status: c.status,
        started_at: c.started_at,
      })));
    }

    fetchActive();

    const channel = supabase
      .channel(`home-active-calls-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_sessions", filter: `specialist_id=eq.${user.id}` },
        () => fetchActive(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const startOfDayISO = startOfDay.toISOString();
        const dayAgoISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const [
          { count: alertsPending },
          alertsCriticalRes,
          { count: callsToday },
          { count: calls24h },
          { count: callsWithTranscript },
          { count: scoresPending },
          scores24hRes,
          { count: suggestionsOpen },
          suggestionsTopRes,
          { count: kbDraftsPending },
          { count: scenariosPending },
          myAssignmentsRes,
          recentCallsRes,
        ] = await Promise.all([
          supabase.from("high_priority_alerts").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase
            .from("high_priority_alerts")
            .select("id, alert_type, trigger_excerpt, call_session_id")
            .eq("status", "pending")
            .eq("severity", "critical")
            .order("classified_at", { ascending: false })
            .limit(3),
          supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("started_at", startOfDayISO),
          supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("started_at", dayAgoISO),
          supabase.from("call_sessions").select("id", { count: "exact", head: true })
            .gte("started_at", dayAgoISO)
            .not("ctm_raw_payload->>transcription_text", "is", null),
          supabase.from("call_scores").select("id", { count: "exact", head: true })
            .eq("needs_supervisor_review", true).is("supervisor_signoff_at", null),
          supabase.from("call_scores").select("composite_score").gte("created_at", dayAgoISO),
          supabase.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "open"),
          supabase
            .from("suggestions")
            .select("id, title, priority, suggestion_type")
            .eq("status", "open")
            .order("priority", { ascending: true })
            .order("created_at", { ascending: false })
            .limit(5),
          supabase.from("kb_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("training_scenarios").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
          user?.id
            ? supabase
                .from("training_assignments")
                .select(`id, scenario_id, due_at, notes,
                  scenario:training_scenarios(title)`)
                .eq("specialist_id", user.id)
                .in("status", ["assigned", "in_progress"])
                .order("due_at", { ascending: true, nullsFirst: false })
                .limit(5)
            : Promise.resolve({ data: [] as any[], error: null }),
          supabase
            .from("call_sessions")
            .select(`id, ctm_call_id, caller_name, caller_phone_normalized, status, talk_seconds, started_at, ctm_raw_payload,
              score:call_scores(composite_score)`)
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(8),
        ]);

        const scoreVals = (scores24hRes.data ?? []).map((r) => r.composite_score).filter((n): n is number => n != null);
        const avgScore = scoreVals.length > 0 ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : null;

        const myAssignments = ((myAssignmentsRes.data ?? []) as any[])
          .filter((a) => a.scenario)
          .map((a) => ({
            id: a.id,
            scenario_id: a.scenario.id ?? a.scenario_id,
            scenario_title: a.scenario.title,
            due_at: a.due_at,
            manager_note: a.notes,
          }));

        const recentCalls = ((recentCallsRes.data ?? []) as any[]).map((c) => {
          const score = Array.isArray(c.score) ? c.score[0] : c.score;
          const agent = c.ctm_raw_payload?.agent;
          return {
            id: c.id,
            ctm_call_id: c.ctm_call_id,
            caller_name: c.caller_name,
            caller_phone: c.caller_phone_normalized,
            status: c.status,
            talk_seconds: c.talk_seconds,
            started_at: c.started_at,
            composite_score: score?.composite_score ?? null,
            agent_name: agent?.name ?? null,
          };
        });

        if (!cancelled) {
          setData({
            alerts_pending: alertsPending ?? 0,
            alerts_critical: ((alertsCriticalRes.data ?? []) as any[]).map((a) => ({
              id: a.id,
              alert_type: a.alert_type,
              trigger_excerpt: a.trigger_excerpt,
              call_id: a.call_session_id,
            })),
            calls_today: callsToday ?? 0,
            calls_24h: calls24h ?? 0,
            calls_with_transcript: callsWithTranscript ?? 0,
            scores_pending_review: scoresPending ?? 0,
            avg_score_24h: avgScore,
            suggestions_open: suggestionsOpen ?? 0,
            suggestions_top: ((suggestionsTopRes.data ?? []) as any[]).map((s) => ({
              id: s.id, title: s.title, priority: s.priority, suggestion_type: s.suggestion_type,
            })),
            kb_drafts_pending: kbDraftsPending ?? 0,
            scenarios_pending_review: scenariosPending ?? 0,
            my_assignments: myAssignments,
            recent_calls: recentCalls,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading dashboard…
        </CardContent></Card>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error ?? "No data"}</CardContent></Card>
      </div>
    );
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Active-call banner — shows when current specialist has a ringing or in-progress call */}
      {activeCalls.length > 0 && (
        <div className="space-y-2">
          {activeCalls.map((c) => (
            <Link key={c.id} href={`/live/${c.id}`}>
              <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer">
                <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <PhoneCall className="w-5 h-5 text-emerald-600" />
                      <Radio className="w-3 h-3 text-emerald-600 absolute -top-1 -right-1 animate-pulse" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        Live call{c.status === "ringing" ? " incoming" : " in progress"}
                        <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.caller_name ?? "Unknown caller"} {c.caller_phone && `· ${c.caller_phone}`}
                        {c.started_at && ` · started ${fmtTime(c.started_at)}`}
                      </div>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    Open coaching view <ChevronRight className="w-4 h-4" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">{greeting}{user?.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}.</h1>
        <p className="text-sm text-muted-foreground mt-1">Here's what needs attention today at Cornerstone Healing Center.</p>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatLink href="/ops/alerts" icon={<AlertTriangle className="w-4 h-4" />} label="Pending alerts" value={data.alerts_pending} accent={data.alerts_pending > 0 ? "rose" : undefined} />
        <StatLink href="/ops/qa-review" icon={<ShieldAlert className="w-4 h-4" />} label="QA needs review" value={data.scores_pending_review} accent={data.scores_pending_review > 0 ? "amber" : undefined} />
        <StatLink href="/ops/suggestions" icon={<Zap className="w-4 h-4" />} label="Open suggestions" value={data.suggestions_open} />
        <StatLink href="/ops/kb-drafts" icon={<BookOpen className="w-4 h-4" />} label="KB drafts pending" value={data.kb_drafts_pending} />
        <StatLink href="/ops/scenario-review" icon={<GraduationCap className="w-4 h-4" />} label="Scenarios pending" value={data.scenarios_pending_review} />
      </div>

      {/* Today's call activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4" /> Call activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Calls today</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_today}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Calls last 24h</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_24h}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">With transcript</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_with_transcript}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg QA score (24h)</div>
              <div className={`text-2xl font-semibold tabular-nums ${scoreColor(data.avg_score_24h)}`}>{data.avg_score_24h ?? "—"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Critical alerts */}
        {data.alerts_critical.length > 0 && (
          <Card className="border-l-4 border-l-rose-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-600" /> Critical alerts ({data.alerts_critical.length})</span>
                <Link href="/ops/alerts" className="text-xs text-primary hover:underline">All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.alerts_critical.map((a) => (
                <Link key={a.id} href={`/live/${a.call_id}`} className="block">
                  <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors">
                    <Badge variant="outline" className="text-xs mb-1.5">{a.alert_type.replace(/_/g, " ")}</Badge>
                    <p className="text-muted-foreground italic">"{a.trigger_excerpt.slice(0, 200)}"</p>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Top suggestions */}
        {data.suggestions_top.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> Top suggestions</span>
                <Link href="/ops/suggestions" className="text-xs text-primary hover:underline">All {data.suggestions_open} →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.suggestions_top.map((s) => (
                <Link key={s.id} href="/ops/suggestions" className="block">
                  <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-2">
                    <Badge className={priorityClass[s.priority] ?? ""} variant="secondary">{s.priority}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.suggestion_type.replace(/_/g, " ")}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* My training assignments */}
        {data.my_assignments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Inbox className="w-4 h-4" /> Your training assignments</span>
                <Link href="/training" className="text-xs text-primary hover:underline">All →</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.my_assignments.map((a) => (
                <Link key={a.id} href={`/training/${a.scenario_id}`} className="block">
                  <div className="border-l-4 border-l-amber-500 border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors">
                    <div className="font-medium">{a.scenario_title}</div>
                    {a.due_at && <div className="text-xs text-muted-foreground mt-0.5">Due {new Date(a.due_at).toLocaleDateString()}</div>}
                    {a.manager_note && <div className="text-xs italic text-muted-foreground mt-0.5">"{a.manager_note}"</div>}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Recent calls */}
        <Card className={data.my_assignments.length > 0 || data.suggestions_top.length > 0 || data.alerts_critical.length > 0 ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><Phone className="w-4 h-4" /> Recent calls</span>
              <Link href="/ctm-calls" className="text-xs text-primary hover:underline">Full log →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent_calls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent calls.</p>
            ) : (
              <div className="space-y-1.5">
                {data.recent_calls.map((c) => (
                  <Link key={c.id} href={`/live/${c.id}`} className="block">
                    <div className="border-b py-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{c.caller_name ?? c.caller_phone ?? "Unknown"}</span>
                          <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" /> {fmtTime(c.started_at)}
                          <span>{fmtDur(c.talk_seconds)}</span>
                          {c.agent_name && <span>· {c.agent_name}</span>}
                        </div>
                      </div>
                      {c.composite_score != null && (
                        <span className={`text-sm font-semibold ${scoreColor(c.composite_score)}`}>{c.composite_score}</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatLink({ href, icon, label, value, accent }: { href: string; icon: React.ReactNode; label: string; value: number; accent?: "rose" | "amber" }) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/30 dark:bg-rose-950/10"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10"
      : "";
  return (
    <Link href={href} className="block">
      <Card className={`hover:bg-accent/50 transition-colors cursor-pointer ${accentClass}`}>
        <CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
        </CardContent>
      </Card>
    </Link>
  );
}
