import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, ShieldAlert, BookOpen, GraduationCap, Phone, Inbox,
  TrendingUp, Loader2, Clock, Sparkles, Headphones, Zap, ChevronRight, Activity,
  PhoneCall, Radio, Pin, X, PhoneOff, Voicemail, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SinceLastVisit {
  since: string | null;             // ISO timestamp (null = first visit)
  new_alerts: number;
  new_suggestions: number;
  new_bot_feedback: number;
  new_flagged_qa: number;
}

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
  my_callbacks: Array<{ id: string; lead_id: string | null; caller_label: string; phone: string | null; status: string; started_at: string | null; ownership: "lead_owner" | "original_specialist" }>;
  my_outreach_owed: number;
  my_undispositioned: Array<{ id: string; caller_label: string; started_at: string | null }>;
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
  const { role } = useRole();
  const canPin = role === "manager" || role === "admin";
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinceLastVisit, setSinceLastVisit] = useState<SinceLastVisit | null>(null);

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

  // "Since you last visited" — read prior last_seen_at, count what's new
  // since then, then bump it forward to now. Skips counting if this is the
  // very first visit (no prior timestamp) so we don't show "247 new" on
  // day one.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("last_seen_at")
        .eq("id", user.id)
        .maybeSingle();
      const prior = prof?.last_seen_at ?? null;

      if (prior) {
        const [alertsR, suggR, botR, qaR] = await Promise.all([
          supabase.from("high_priority_alerts").select("id", { count: "exact", head: true }).gte("classified_at", prior),
          supabase.from("suggestions").select("id", { count: "exact", head: true }).gte("created_at", prior).eq("status", "open"),
          supabase.from("ai_bot_feedback_items").select("id", { count: "exact", head: true }).gte("created_at", prior).eq("status", "open"),
          supabase.from("call_scores").select("id", { count: "exact", head: true }).gte("created_at", prior).eq("needs_supervisor_review", true).is("supervisor_signoff_at", null),
        ]);
        if (!cancelled) {
          setSinceLastVisit({
            since: prior,
            new_alerts: alertsR.count ?? 0,
            new_suggestions: suggR.count ?? 0,
            new_bot_feedback: botR.count ?? 0,
            new_flagged_qa: qaR.count ?? 0,
          });
        }
      } else if (!cancelled) {
        setSinceLastVisit({ since: null, new_alerts: 0, new_suggestions: 0, new_bot_feedback: 0, new_flagged_qa: 0 });
      }

      // Bump last_seen_at forward.
      await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    })();
    return () => { cancelled = true; };
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

        // Specialist-scoped callbacks: missed/voicemail calls where I was the
        // original specialist OR the lead is owned by me. Same dedup pattern as /me.
        let myCallbacks: HomeData["my_callbacks"] = [];
        if (user?.id) {
          const baseSel = `id, status, caller_name, caller_phone_normalized, started_at, lead_id,
            lead:leads!call_sessions_lead_id_fkey(id, first_name, last_name)`;
          const [origRes, ownedLeadsRes] = await Promise.all([
            supabase
              .from("call_sessions")
              .select(baseSel)
              .eq("specialist_id", user.id)
              .or("status.in.(missed,abandoned,voicemail),specialist_disposition.eq.needs_callback")
              .eq("callback_status", "pending")
              .order("started_at", { ascending: false, nullsFirst: false })
              .limit(20),
            supabase.from("leads").select("id").eq("owner_id", user.id),
          ]);
          const ownedLeadIds = (ownedLeadsRes.data ?? []).map((l: any) => l.id) as string[];
          const ownedCallsRes = ownedLeadIds.length > 0
            ? await supabase
                .from("call_sessions")
                .select(baseSel)
                .in("lead_id", ownedLeadIds)
                .in("status", ["missed", "abandoned", "voicemail"])
                .eq("callback_status", "pending")
                .order("started_at", { ascending: false, nullsFirst: false })
                .limit(20)
            : { data: [] as any[] };
          const cbMap = new Map<string, HomeData["my_callbacks"][number]>();
          const toRow = (c: any, ownership: "original_specialist" | "lead_owner") => {
            const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
            return {
              id: c.id,
              lead_id: lead?.id ?? c.lead_id ?? null,
              caller_label: c.caller_name
                ?? [lead?.first_name, lead?.last_name].filter(Boolean).join(" ")
                ?? c.caller_phone_normalized
                ?? "Unknown",
              phone: c.caller_phone_normalized,
              status: c.status,
              started_at: c.started_at,
              ownership,
            };
          };
          for (const c of (origRes.data ?? []) as any[]) cbMap.set(c.id, toRow(c, "original_specialist"));
          for (const c of (ownedCallsRes.data ?? []) as any[]) cbMap.set(c.id, toRow(c, "lead_owner"));
          myCallbacks = Array.from(cbMap.values()).sort((a, b) =>
            (a.started_at ?? "") < (b.started_at ?? "") ? 1 : -1,
          );
        }

        // Undispositioned calls — answered calls I took but haven't wrapped up.
        let myUndispositioned: HomeData["my_undispositioned"] = [];
        if (user?.id) {
          const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data: undisp } = await supabase
            .from("call_sessions")
            .select("id, caller_name, caller_phone_normalized, started_at")
            .eq("specialist_id", user.id)
            .eq("status", "answered")
            .is("specialist_disposition", null)
            .gte("started_at", sevenDaysAgoISO)
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(10);
          myUndispositioned = ((undisp ?? []) as any[]).map((c) => ({
            id: c.id,
            caller_label: c.caller_name ?? c.caller_phone_normalized ?? "Unknown",
            started_at: c.started_at,
          }));
        }

        // Outreach owed count (just count — full list lives on /me).
        let myOutreachOwed = 0;
        if (user?.id) {
          const STALE_DAYS = 3;
          const staleCutoffMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
          const lookback = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
          const { data: myLeads } = await supabase
            .from("leads")
            .select("id")
            .eq("owner_id", user.id)
            .eq("outcome_category", "in_progress")
            .not("primary_phone_normalized", "is", null)
            .gte("created_at", lookback)
            .limit(200);
          const ids = (myLeads ?? []).map((l: any) => l.id) as string[];
          if (ids.length > 0) {
            const { data: leadCalls } = await supabase
              .from("call_sessions")
              .select("lead_id, direction, started_at")
              .in("lead_id", ids);
            const byLead = new Map<string, { hasIn: boolean; lastOut: string | null }>();
            for (const c of (leadCalls ?? []) as any[]) {
              if (!c.lead_id) continue;
              const b = byLead.get(c.lead_id) ?? { hasIn: false, lastOut: null };
              if (c.direction === "inbound") b.hasIn = true;
              if (c.direction === "outbound" && (!b.lastOut || (c.started_at && c.started_at > b.lastOut))) b.lastOut = c.started_at;
              byLead.set(c.lead_id, b);
            }
            myOutreachOwed = ids.filter((id) => {
              const b = byLead.get(id);
              if (!b?.hasIn) return false;
              if (b.lastOut && new Date(b.lastOut).getTime() > staleCutoffMs) return false;
              return true;
            }).length;
          }
        }

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
            my_callbacks: myCallbacks,
            my_outreach_owed: myOutreachOwed,
            my_undispositioned: myUndispositioned,
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
      <PinnedMessageBanner canPin={canPin} userId={user?.id ?? null} />

      {/* Active-call banner — shows when current specialist has a ringing or in-progress call */}
      {activeCalls.length > 0 && (
        <div className="space-y-2">
          {activeCalls.map((c) => (
            // Ringing → pre-call brief (caller hasn't been picked up yet, prep first).
            // In-progress → live coaching view.
            <Link key={c.id} href={c.status === "ringing" ? `/pre-call/${c.id}` : `/live/${c.id}`}>
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
                    {c.status === "ringing" ? "Open pre-call brief" : "Open coaching view"} <ChevronRight className="w-4 h-4" />
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

      {/* Since you last visited — quietly hidden when nothing has changed */}
      {sinceLastVisit && sinceLastVisit.since && (
        sinceLastVisit.new_alerts + sinceLastVisit.new_suggestions + sinceLastVisit.new_bot_feedback + sinceLastVisit.new_flagged_qa > 0
      ) && (
        <Card className="border-l-4 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/15">
          <CardContent className="pt-3 pb-3">
            <div className="text-xs text-muted-foreground mb-1.5">
              Since you last visited <span className="italic">({new Date(sinceLastVisit.since).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})</span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {sinceLastVisit.new_alerts > 0 && (
                <Link href="/ops/alerts" className="hover:underline text-rose-700 dark:text-rose-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {sinceLastVisit.new_alerts} new alert{sinceLastVisit.new_alerts > 1 ? "s" : ""}
                </Link>
              )}
              {sinceLastVisit.new_suggestions > 0 && (
                <Link href="/ops/suggestions" className="hover:underline font-medium flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> {sinceLastVisit.new_suggestions} new suggestion{sinceLastVisit.new_suggestions > 1 ? "s" : ""}
                </Link>
              )}
              {sinceLastVisit.new_bot_feedback > 0 && (
                <Link href="/ops/ai-bot-feedback" className="hover:underline font-medium flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> {sinceLastVisit.new_bot_feedback} new bot issue{sinceLastVisit.new_bot_feedback > 1 ? "s" : ""}
                </Link>
              )}
              {sinceLastVisit.new_flagged_qa > 0 && (
                <Link href="/ops/qa-review" className="hover:underline text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> {sinceLastVisit.new_flagged_qa} flagged for review
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
            <Link href="/ctm-calls?date=today" className="block rounded-md -m-1 p-1 hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="text-xs text-muted-foreground">Calls today</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_today}</div>
            </Link>
            <Link href="/ctm-calls?date=24h" className="block rounded-md -m-1 p-1 hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="text-xs text-muted-foreground">Calls last 24h</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_24h}</div>
            </Link>
            <Link href="/ctm-calls?date=24h&has_transcript=true" className="block rounded-md -m-1 p-1 hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="text-xs text-muted-foreground">With transcript</div>
              <div className="text-2xl font-semibold tabular-nums">{data.calls_with_transcript}</div>
            </Link>
            <Link href="/ops/qa-review" className="block rounded-md -m-1 p-1 hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="text-xs text-muted-foreground">Avg QA score (24h)</div>
              <div className={`text-2xl font-semibold tabular-nums ${scoreColor(data.avg_score_24h)}`}>{data.avg_score_24h ?? "—"}</div>
            </Link>
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

        {/* Calls awaiting disposition — quick wrap-up reminder */}
        {data.my_undispositioned.length > 0 && (
          <Card className="border-l-4 border-l-amber-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-amber-600" /> Wrap up these calls</span>
                <Badge variant="outline" className="text-[10px]">{data.my_undispositioned.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.my_undispositioned.slice(0, 5).map((c) => (
                <Link key={c.id} href={`/live/${c.id}`} className="block">
                  <div className="border rounded-md p-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.caller_label}</div>
                      <div className="text-xs text-muted-foreground">{c.started_at ? new Date(c.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              ))}
              {data.my_undispositioned.length > 5 && (
                <div className="text-xs text-muted-foreground text-center pt-1">
                  +{data.my_undispositioned.length - 5} more
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Outreach owed (one-liner — full list lives on /me) */}
        {data.my_outreach_owed > 0 && (
          <Link href="/me" className="block">
            <Card className="border-l-4 border-l-rose-500 hover:bg-accent/30 transition-colors">
              <CardContent className="pt-3 pb-3 flex items-center gap-3">
                <PhoneCall className="w-4 h-4 text-rose-600 shrink-0" />
                <div className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold">{data.my_outreach_owed}</span>
                  <span className="text-muted-foreground"> {data.my_outreach_owed === 1 ? "lead" : "leads"} you own with no outbound contact in 3+ days</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        )}

        {/* My callbacks owed */}
        {data.my_callbacks.length > 0 && (
          <Card className="border-l-4 border-l-amber-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><PhoneOff className="w-4 h-4 text-amber-600" /> Callbacks to make</span>
                <Badge variant="outline" className="text-[10px]">{data.my_callbacks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.my_callbacks.slice(0, 6).map((c) => {
                const ageMs = c.started_at ? Date.now() - new Date(c.started_at).getTime() : 0;
                const breached = ageMs > 60 * 60 * 1000;
                const Icon = c.status === "voicemail" ? Voicemail : PhoneOff;
                const iconColor = c.status === "voicemail" ? "text-blue-500" : "text-rose-500";
                const href = c.lead_id ? `/leads/${c.lead_id}` : `/live/${c.id}`;
                return (
                  <Link key={c.id} href={href} className="block">
                    <div className="border rounded-md p-2.5 text-sm hover:bg-accent/50 transition-colors flex items-start gap-3">
                      <Icon className={`w-4 h-4 ${iconColor} shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{c.caller_label}</span>
                          <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                          {c.ownership === "lead_owner" && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-700 dark:text-blue-400">your lead</Badge>
                          )}
                          {breached && (
                            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">&gt;1h</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {c.phone && <>{c.phone} · </>}{c.started_at ? new Date(c.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {data.my_callbacks.length > 6 && (
                <Link href="/me" className="block text-xs text-primary hover:underline text-center pt-1">
                  +{data.my_callbacks.length - 6} more on My coaching →
                </Link>
              )}
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

function PinnedMessageBanner({ canPin, userId }: { canPin: boolean; userId: string | null }) {
  interface Pin { id: string; body: string; created_at: string; posted_by_profile: { full_name: string | null; email: string | null } | null }
  const [msg, setMsg] = useState<Pin | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("pinned_messages")
      .select(`id, body, created_at, posted_by_profile:profiles!pinned_messages_posted_by_fkey(full_name, email)`)
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setMsg(data as unknown as Pin | null);
  }
  useEffect(() => { load(); }, []);

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    // Unpin any prior message — keeps the noise floor at one active pin.
    await supabase.from("pinned_messages").update({ active: false }).eq("active", true);
    await supabase.from("pinned_messages").insert({ body, posted_by: userId, active: true });
    setPosting(false);
    setDraft("");
    setComposing(false);
    load();
  }

  async function unpin() {
    if (!msg) return;
    await supabase.from("pinned_messages").update({ active: false }).eq("id", msg.id);
    load();
  }

  if (!msg && !canPin) return null;
  if (!msg && canPin && !composing) {
    return (
      <button
        onClick={() => setComposing(true)}
        className="w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors rounded-md px-3 py-1.5 flex items-center gap-1.5 border border-dashed"
      >
        <Pin className="w-3 h-3" /> Pin a message for the team…
      </button>
    );
  }

  if (composing) {
    return (
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
            <Pin className="w-3 h-3" /> New pinned message
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. New AHCCCS verification script in the KB — please review before tomorrow's calls."
            className="min-h-[70px] text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setComposing(false); setDraft(""); }} disabled={posting}>Cancel</Button>
            <Button size="sm" onClick={post} disabled={!draft.trim() || posting}>
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pin className="w-3.5 h-3.5" />}
              Pin to team
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!msg) return null;
  return (
    <Card className="border-l-4 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/15">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <Pin className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm whitespace-pre-wrap">{msg.body}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Pinned {new Date(msg.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {msg.posted_by_profile && ` by ${msg.posted_by_profile.full_name ?? msg.posted_by_profile.email}`}
              </div>
            </div>
          </div>
          {canPin && (
            <Button size="sm" variant="ghost" onClick={unpin} className="shrink-0 h-7 px-2" title="Unpin">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
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
