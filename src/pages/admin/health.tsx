import { useEffect, useState, useCallback } from "react";
import {
  Activity, Loader2, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Phone, ShieldAlert, BookOpen, Sparkles, GraduationCap, Bot, TrendingUp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PipelineCheck {
  name: string;
  icon: React.ReactNode;
  // Most recent event time the pipeline produced.
  lastAt: string | null;
  // Count of records that should be "small" (e.g. stale stuck rows).
  stuckCount?: number | null;
  // Total throughput in last 24h for context.
  throughput24h?: number | null;
  // What "healthy" means in minutes since lastAt.
  healthyMinutes: number;
  warningMinutes: number;
  description: string;
}

function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function fmtAge(mins: number | null): string {
  if (mins == null) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusFor(check: PipelineCheck): { color: string; icon: React.ReactNode; label: string } {
  const age = ageMinutes(check.lastAt);
  if (age == null) return { color: "rose", icon: <XCircle className="w-4 h-4" />, label: "Never run" };
  if (age <= check.healthyMinutes) return { color: "emerald", icon: <CheckCircle2 className="w-4 h-4" />, label: "Healthy" };
  if (age <= check.warningMinutes) return { color: "amber", icon: <AlertTriangle className="w-4 h-4" />, label: "Stale" };
  return { color: "rose", icon: <XCircle className="w-4 h-4" />, label: "Down" };
}

const COLOR_CLASS: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/15 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/15 text-amber-700 dark:text-amber-400",
  rose: "border-rose-500/30 bg-rose-50/30 dark:bg-rose-950/15 text-rose-700 dark:text-rose-400",
};

export default function HealthPage() {
  const [checks, setChecks] = useState<PipelineCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const [
      lastCall, last24hCalls, stuckRinging,
      lastScore, last24hScores,
      lastAlert, last24hAlerts,
      lastOutcomeEvent, last24hOutcomeEvents,
      lastSuggestion, last24hSuggestions,
      lastBotFeedback, last24hBotFeedback,
      lastKbDraft, last24hKbDrafts,
      pendingCallbacks,
    ] = await Promise.all([
      supabase.from("call_sessions").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
      supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("status", "ringing").lt("started_at", fifteenMinAgo),

      supabase.from("call_scores").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("call_scores").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),

      supabase.from("high_priority_alerts").select("classified_at").order("classified_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("high_priority_alerts").select("id", { count: "exact", head: true }).gte("classified_at", dayAgo),

      supabase.from("lead_outcome_events").select("transitioned_at").order("transitioned_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("lead_outcome_events").select("id", { count: "exact", head: true }).gte("transitioned_at", dayAgo),

      supabase.from("suggestions").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("suggestions").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),

      supabase.from("ai_bot_feedback_items").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("ai_bot_feedback_items").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),

      supabase.from("kb_drafts").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("kb_drafts").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),

      supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("callback_status", "pending"),
    ]);

    setChecks([
      {
        name: "CTM webhook ingest",
        icon: <Phone className="w-4 h-4" />,
        lastAt: (lastCall.data as any)?.created_at ?? null,
        throughput24h: last24hCalls.count ?? 0,
        stuckCount: stuckRinging.count ?? 0,
        healthyMinutes: 30,
        warningMinutes: 120,
        description: "CTM call_sessions inserts. Stuck count = calls still 'ringing' for 15+ min.",
      },
      {
        name: "Call scoring",
        icon: <ShieldAlert className="w-4 h-4" />,
        lastAt: (lastScore.data as any)?.created_at ?? null,
        throughput24h: last24hScores.count ?? 0,
        healthyMinutes: 60,
        warningMinutes: 360,
        description: "score-call edge function output. Should fire after every transcribed call.",
      },
      {
        name: "Alert classifier",
        icon: <AlertTriangle className="w-4 h-4" />,
        lastAt: (lastAlert.data as any)?.classified_at ?? null,
        throughput24h: last24hAlerts.count ?? 0,
        healthyMinutes: 1440,         // alerts are rare; only worry after 24h+ silence
        warningMinutes: 4320,
        description: "Crisis-language flags. Low volume is normal; check the function if no calls trigger anything for days.",
      },
      {
        name: "Outcome attribution",
        icon: <TrendingUp className="w-4 h-4" />,
        lastAt: (lastOutcomeEvent.data as any)?.transitioned_at ?? null,
        throughput24h: last24hOutcomeEvents.count ?? 0,
        healthyMinutes: 1440,
        warningMinutes: 4320,
        description: "Lead stage transitions written by the trigger. Backfilled rows count as 'recent'.",
      },
      {
        name: "Suggestion sweep",
        icon: <Sparkles className="w-4 h-4" />,
        lastAt: (lastSuggestion.data as any)?.created_at ?? null,
        throughput24h: last24hSuggestions.count ?? 0,
        healthyMinutes: 90,
        warningMinutes: 240,
        description: "generate-suggestions runs hourly. Last-created suggestion timestamp.",
      },
      {
        name: "Bot feedback analyzer",
        icon: <Bot className="w-4 h-4" />,
        lastAt: (lastBotFeedback.data as any)?.created_at ?? null,
        throughput24h: last24hBotFeedback.count ?? 0,
        healthyMinutes: 1440,
        warningMinutes: 4320,
        description: "analyze-bot-call output. Fires per completed bot call.",
      },
      {
        name: "KB drafts pipeline",
        icon: <BookOpen className="w-4 h-4" />,
        lastAt: (lastKbDraft.data as any)?.created_at ?? null,
        throughput24h: last24hKbDrafts.count ?? 0,
        healthyMinutes: 2880,
        warningMinutes: 10080,
        description: "AI-generated KB drafts + specialist requests + manager-authored drafts.",
      },
      {
        name: "Callback queue",
        icon: <GraduationCap className="w-4 h-4" />,
        lastAt: null,                  // not a producer; show as the pending count
        stuckCount: pendingCallbacks.count ?? 0,
        healthyMinutes: 0,
        warningMinutes: 0,
        description: "Pending callbacks waiting to be worked. Always shown; 'last' age doesn't apply.",
      },
    ]);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="w-6 h-6" /> System health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Is each pipeline actually running? Green = healthy, amber = stale, rose = down.
            Refreshed {lastRefresh.toLocaleTimeString()}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading && checks.length === 0 && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Pinging pipelines…
        </CardContent></Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {checks.map((c) => {
          // Special-case the callback queue tile (no producer time).
          if (c.name === "Callback queue") {
            const stuck = c.stuckCount ?? 0;
            const color = stuck === 0 ? "emerald" : stuck < 10 ? "amber" : "rose";
            return (
              <Card key={c.name} className={`border-l-4 ${COLOR_CLASS[color].split(" ")[0].replace("border-", "border-l-")}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">{c.icon} {c.name}</span>
                    <Badge className={COLOR_CLASS[color]} variant="outline">
                      {stuck === 0 ? "clear" : `${stuck} pending`}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">{c.description}</CardContent>
              </Card>
            );
          }

          const status = statusFor(c);
          return (
            <Card key={c.name} className={`border-l-4 ${COLOR_CLASS[status.color].split(" ")[0].replace("border-", "border-l-")}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2">{c.icon} {c.name}</span>
                  <Badge className={`${COLOR_CLASS[status.color]} gap-1`} variant="outline">
                    {status.icon} {status.label}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm flex items-center gap-3 flex-wrap">
                  <span>
                    Last: <span className="font-medium">{fmtAge(ageMinutes(c.lastAt))}</span>
                  </span>
                  {c.throughput24h != null && (
                    <span className="text-muted-foreground">· {c.throughput24h} in 24h</span>
                  )}
                  {c.stuckCount != null && c.stuckCount > 0 && (
                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                      · {c.stuckCount} stuck
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-muted">
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Edge function logs:</strong> for deeper investigation,
          check Supabase → Functions → Logs for the relevant function. Status here is derived from the
          most recent record each pipeline writes to the database, so a function failure that prevents
          writes shows as "stale" or "down" within the warning window.
        </CardContent>
      </Card>
    </div>
  );
}
