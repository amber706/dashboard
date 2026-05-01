import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import {
  Bot, Loader2, Phone, Clock, Timer, Headphones, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, X, FileText, Wrench, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Severity = "low" | "medium" | "high";
type Status = "open" | "acknowledged" | "resolved" | "dismissed";

interface FeedbackItem {
  id: string;
  call_session_id: string;
  bot_profile_id: string | null;
  severity: Severity;
  category: string;
  title: string;
  description: string | null;
  transcript_excerpt: string | null;
  suggested_fix: string | null;
  status: Status;
  resolved_at: string | null;
  graded_by_service_version: string | null;
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
  bot: { id: string; full_name: string | null } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  escalation_failure: "Escalation failure",
  hallucination: "Hallucination",
  wrong_information: "Wrong information",
  missed_required_info: "Missed required info",
  abrupt_close: "Abrupt close",
  off_script: "Off-script",
  rapport_issue: "Rapport issue",
  transcription_issue: "Transcription issue",
  other: "Other",
};

const SEVERITY_CLASS: Record<Severity, string> = {
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30",
};

const STATUS_CLASS: Record<Status, string> = {
  open: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  acknowledged: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  dismissed: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}

export default function AIBotFeedback() {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("open");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reanalyzingCallId, setReanalyzingCallId] = useState<string | null>(null);
  const [botCallsThisMonth, setBotCallsThisMonth] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("ai_bot_feedback_items")
      .select(`
        id, call_session_id, bot_profile_id, severity, category, title,
        description, transcript_excerpt, suggested_fix, status, resolved_at,
        graded_by_service_version, created_at,
        call:call_sessions(id, ctm_call_id, caller_phone_normalized, caller_name, started_at, talk_seconds, ctm_raw_payload),
        bot:profiles!ai_bot_feedback_items_bot_profile_id_fkey(id, full_name)
      `)
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (severityFilter !== "all") q = q.eq("severity", severityFilter);
    if (categoryFilter !== "all") q = q.eq("category", categoryFilter);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setItems((data ?? []) as unknown as FeedbackItem[]);

    // Calls handled by bot this month, for the rollup denominator.
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("call_sessions")
      .select("id, specialist:profiles!inner(is_ai_agent)", { count: "exact", head: true })
      .gte("started_at", startOfMonth.toISOString())
      .eq("specialist.is_ai_agent", true);
    setBotCallsThisMonth(count ?? 0);

    setLoading(false);
  }, [statusFilter, severityFilter, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  // Rollup counts across the currently-loaded items (respects filters).
  const rollup = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const it of items) {
      byCategory[it.category] = (byCategory[it.category] ?? 0) + 1;
      bySeverity[it.severity]++;
    }
    return { byCategory, bySeverity };
  }, [items]);

  async function setStatus(id: string, status: Status) {
    const patch: Record<string, unknown> = { status };
    if (status === "resolved" || status === "dismissed") {
      patch.resolved_at = new Date().toISOString();
      if (user?.id) patch.resolved_by = user.id;
    } else {
      patch.resolved_at = null;
      patch.resolved_by = null;
    }
    const { error: err } = await supabase.from("ai_bot_feedback_items").update(patch).eq("id", id);
    if (!err) load();
  }

  async function reanalyze(callSessionId: string) {
    setReanalyzingCallId(callSessionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-bot-call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ call_session_id: callSessionId }),
      });
      await load();
    } finally {
      setReanalyzingCallId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Bot className="w-6 h-6" /> AI bot feedback
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-flagged issues from bot-handled calls. Each item is actionable feedback for the bot owner.
          Mark resolved when addressed; dismiss if not actually a problem.
        </p>
      </div>

      {/* Monthly rollup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">This month at a glance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <RollupTile label="Bot calls (month)" value={botCallsThisMonth} />
            <RollupTile label="High-severity" value={rollup.bySeverity.high} accent="rose"
              active={severityFilter === "high"}
              onClick={() => setSeverityFilter(severityFilter === "high" ? "all" : "high")} />
            <RollupTile label="Medium-severity" value={rollup.bySeverity.medium} accent="amber"
              active={severityFilter === "medium"}
              onClick={() => setSeverityFilter(severityFilter === "medium" ? "all" : "medium")} />
            <RollupTile label="Low-severity" value={rollup.bySeverity.low}
              active={severityFilter === "low"}
              onClick={() => setSeverityFilter(severityFilter === "low" ? "all" : "low")} />
            <RollupTile label="Total issues shown" value={items.length} />
          </div>

          {Object.keys(rollup.byCategory).length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">By category — click to filter</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rollup.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, n]) => {
                    const active = categoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setCategoryFilter(active ? "all" : cat)}
                        className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 hover:bg-muted border-transparent"
                        }`}
                      >
                        {CATEGORY_LABELS[cat] ?? cat} <span className="ml-1 opacity-70">{n}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-muted-foreground mr-1">Status:</span>
        {(["open", "acknowledged", "resolved", "dismissed", "all"] as const).map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}>
            {s}
          </Button>
        ))}
        {(severityFilter !== "all" || categoryFilter !== "all") && (
          <Button size="sm" variant="ghost" onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading feedback…
        </CardContent></Card>
      )}
      {error && (
        <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>
      )}
      {!loading && !error && items.length === 0 && (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground">
          No items matching these filters. Either the bot is handling things cleanly, or no calls have been analyzed yet.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {items.map((it) => {
          const isOpen = expanded === it.id;
          const audio = it.call?.ctm_raw_payload?.audio;
          return (
            <Card key={it.id} className={`border-l-4 ${
              it.severity === "high" ? "border-l-rose-500" :
              it.severity === "medium" ? "border-l-amber-500" :
              "border-l-slate-300"
            }`}>
              <CardHeader className="cursor-pointer pb-3" onClick={() => setExpanded(isOpen ? null : it.id)}>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 flex-wrap">
                    {isOpen ? <ChevronDown className="w-4 h-4 mt-1" /> : <ChevronRight className="w-4 h-4 mt-1" />}
                    <Badge className={`${SEVERITY_CLASS[it.severity]} border text-[10px] uppercase`} variant="outline">
                      {it.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABELS[it.category] ?? it.category}
                    </Badge>
                    <Badge className={`${STATUS_CLASS[it.status]} text-[10px]`} variant="secondary">
                      {it.status}
                    </Badge>
                    <span className="font-medium text-sm flex-1 min-w-0">{it.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap pl-6">
                    {it.bot?.full_name && <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> {it.bot.full_name}</span>}
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(it.call?.started_at ?? it.created_at)}</span>
                    {it.call?.talk_seconds != null && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {fmtDur(it.call.talk_seconds)}</span>}
                    {it.call?.caller_phone_normalized && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {it.call.caller_phone_normalized}
                        {it.call.caller_name && ` · ${it.call.caller_name}`}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="border-t pt-4 space-y-4">
                  {it.description && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">What happened</div>
                      <p className="text-sm">{it.description}</p>
                    </div>
                  )}

                  {it.transcript_excerpt && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                        <FileText className="w-3 h-3" /> Transcript excerpt
                      </div>
                      <pre className="text-sm bg-muted/40 rounded-md p-3 whitespace-pre-wrap font-sans">
                        {it.transcript_excerpt}
                      </pre>
                    </div>
                  )}

                  {it.suggested_fix && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                        <Wrench className="w-3 h-3" /> Suggested fix for the bot
                      </div>
                      <p className="text-sm">{it.suggested_fix}</p>
                    </div>
                  )}

                  {audio && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                        <Headphones className="w-3 h-3" /> Recording
                      </div>
                      <audio controls preload="none" src={String(audio)} className="w-full h-9" />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                    <div className="flex gap-2 flex-wrap">
                      {it.status !== "resolved" && (
                        <Button size="sm" onClick={() => setStatus(it.id, "resolved")} className="gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark resolved
                        </Button>
                      )}
                      {it.status !== "acknowledged" && it.status === "open" && (
                        <Button size="sm" variant="outline" onClick={() => setStatus(it.id, "acknowledged")}>
                          Acknowledge
                        </Button>
                      )}
                      {it.status !== "dismissed" && (
                        <Button size="sm" variant="outline" onClick={() => setStatus(it.id, "dismissed")} className="gap-1">
                          <X className="w-3.5 h-3.5" /> Dismiss (not a problem)
                        </Button>
                      )}
                      {(it.status === "resolved" || it.status === "dismissed") && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(it.id, "open")}>
                          Reopen
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => reanalyze(it.call_session_id)}
                        disabled={reanalyzingCallId === it.call_session_id} className="gap-1">
                        {reanalyzingCallId === it.call_session_id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <RefreshCw className="w-3.5 h-3.5" />}
                        Re-analyze call
                      </Button>
                      {it.call?.id && (
                        <Link href={`/live/${it.call.id}`} className="text-xs text-primary hover:underline">
                          Open call →
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="text-[10px] text-muted-foreground pt-2 border-t">
                    Flagged by {it.graded_by_service_version} · {fmtTime(it.created_at)}
                    {it.call?.ctm_call_id && ` · CTM ${it.call.ctm_call_id}`}
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

function RollupTile({ label, value, accent, active, onClick }: {
  label: string;
  value: number;
  accent?: "rose" | "amber";
  active?: boolean;
  onClick?: () => void;
}) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
      : "";
  const interactive = onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : "";
  const activeClass = active ? "ring-2 ring-primary" : "";
  const Wrapper: any = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`text-left border rounded-lg p-3 ${accentClass} ${interactive} ${activeClass}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {onClick && (
        <div className="text-[10px] text-muted-foreground/70 mt-1">
          {active ? "filtering" : "click to filter"}
        </div>
      )}
    </Wrapper>
  );
}
