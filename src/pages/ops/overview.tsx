import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceIndicator } from "@/components/ops/confidence-indicator";
import { SuggestionActions } from "@/components/ops/suggestion-actions";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { DrillDownPanel, type ColumnDef } from "@/components/drill-down-panel";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { LiveFloor, TodayKpis, AttentionStrip, TrainingWatchlist } from "@/components/ops/manager-command-center";
import { RecommendationCard, ReasoningPanels } from "@/components/dashboard/RecommendationCard";
import { PriorityBadge } from "@/components/dashboard/PriorityBadge";
import { useToast } from "@/hooks/use-toast";
import { useOpsOverview, actOnSuggestion, fetchDrillDownData, usePollingFetch, type OpsRecommendation } from "@/hooks/use-ops-api";
import { Link, useLocation } from "wouter";
import {
  Phone, PhoneMissed, Clock, Users, AlertTriangle,
  ShieldAlert, BookOpen, ArrowRight, RefreshCw, Zap,
  Eye, Activity, Target, UserX, PhoneOff, TrendingDown,
  Headphones, FileText, ChevronDown, ChevronRight, Timer, User,
} from "lucide-react";

function formatTime(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

function formatDateTime(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number") return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatAge(minutes: unknown): string {
  if (typeof minutes !== "number") return "—";
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type OpsDrillKey = "inbound" | "answered" | "missed" | "callback-backlog" | "awaiting-first-contact"
  | "overdue" | "attribution" | "qa-review" | "supervisor" | "rep-capacity";

const OPS_DRILL_CONFIGS: Record<OpsDrillKey, {
  title: string;
  endpoint: string;
  columns: ColumnDef[];
  navigateTo?: string;
  rowClickLabel?: string;
}> = {
  inbound: {
    title: "Inbound Calls Today",
    endpoint: "/ops/overview/inbound",
    columns: [
      { key: "caller_name", label: "Caller" },
      { key: "call_time", label: "Time", render: (v) => formatTime(v) },
      { key: "call_status", label: "Status" },
      { key: "duration_seconds", label: "Duration", render: (v) => formatDuration(v) },
      { key: "rep_name", label: "Rep" },
    ],
  },
  answered: {
    title: "Answered Calls Today",
    endpoint: "/ops/overview/inbound?status=answered",
    columns: [
      { key: "caller_name", label: "Caller" },
      { key: "call_time", label: "Time", render: (v) => formatTime(v) },
      { key: "duration_seconds", label: "Duration", render: (v) => formatDuration(v) },
      { key: "rep_name", label: "Rep" },
    ],
  },
  missed: {
    title: "Missed Calls Today",
    endpoint: "/ops/overview/missed",
    columns: [
      { key: "caller_phone", label: "Phone" },
      { key: "caller_name", label: "Caller" },
      { key: "call_time", label: "Time", render: (v) => formatTime(v) },
      { key: "tracking_source", label: "Source" },
    ],
  },
  "callback-backlog": {
    title: "Callback Backlog",
    endpoint: "/ops/overview/callback-backlog",
    columns: [
      { key: "caller_phone", label: "Phone" },
      { key: "caller_name", label: "Caller" },
      { key: "call_time", label: "Call Time", render: (v) => formatTime(v) },
      { key: "age_minutes", label: "Waiting", render: (v) => formatAge(v) },
    ],
  },
  "awaiting-first-contact": {
    title: "Awaiting 1st Contact",
    endpoint: "/ops/overview/awaiting-first-contact",
    columns: [
      { key: "caller_phone", label: "Phone" },
      { key: "caller_name", label: "Caller" },
      { key: "call_time", label: "Missed Call Time", render: (v) => formatTime(v) },
      { key: "age_minutes", label: "Age", render: (v) => formatAge(v) },
    ],
  },
  overdue: {
    title: "Overdue Follow-ups",
    endpoint: "/ops/overview/overdue-followups",
    columns: [
      { key: "task_subject", label: "Task" },
      { key: "owner", label: "Owner" },
      { key: "due_date", label: "Due Date", render: (v) => formatDateTime(v) },
      { key: "age_minutes", label: "Overdue By", render: (v) => formatAge(v) },
      { key: "status", label: "Status" },
    ],
  },
  attribution: {
    title: "Attribution Conflicts",
    endpoint: "/ops/attribution-conflicts?status=pending",
    columns: [
      { key: "ctm_call_id", label: "Call ID" },
      { key: "ctm_source", label: "CTM Source" },
      { key: "zoho_source", label: "Zoho Source" },
      { key: "conflict_reason", label: "Reason" },
      { key: "created_at", label: "Created", render: (v) => formatDateTime(v) },
    ],
    navigateTo: "/ops/attribution",
    rowClickLabel: "Go to Attribution Review",
  },
  "qa-review": {
    title: "QA Review Queue",
    endpoint: "/ops/overview/qa-review-queue",
    columns: [
      { key: "ctm_call_id", label: "Call ID" },
      { key: "rep_name", label: "Rep" },
      { key: "flag_reason", label: "Flag Reason" },
      { key: "qa_score_percent", label: "Grade", render: (v) => typeof v === "number" ? `${v}%` : "—" },
      { key: "source", label: "Source" },
    ],
    navigateTo: "/ops/supervisor-review",
    rowClickLabel: "Go to Supervisor Review",
  },
  supervisor: {
    title: "Supervisor Review Queue",
    endpoint: "/ops/overview/supervisor-review-queue",
    columns: [
      { key: "ctm_call_id", label: "Call ID" },
      { key: "rep_name", label: "Rep" },
      { key: "flag_reason", label: "Flag Reason" },
      { key: "qa_score_percent", label: "Grade", render: (v) => typeof v === "number" ? `${v}%` : "—" },
      { key: "source", label: "Source" },
    ],
    navigateTo: "/ops/supervisor-review",
    rowClickLabel: "Go to Supervisor Review",
  },
  "rep-capacity": {
    title: "Rep Capacity Warnings",
    endpoint: "/ops/rep-workload",
    columns: [
      { key: "rep_name", label: "Rep" },
      { key: "calls_today", label: "Calls Today" },
      { key: "open_leads", label: "Open Leads" },
      { key: "overdue_callbacks", label: "Overdue Callbacks" },
      { key: "capacity_status", label: "Status" },
    ],
  },
};

function OpsOverviewContent() {
  const { data, loading, error, refetch } = useOpsOverview({ interval: 15000 });
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [drillDown, setDrillDown] = useState<OpsDrillKey | null>(null);
  const [expandedRecId, setExpandedRecId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const activeDrill = drillDown ? OPS_DRILL_CONFIGS[drillDown] : null;

  const handleAction = async (id: number, action: "acknowledge" | "dismiss" | "act") => {
    setActionLoading(id);
    try {
      await actOnSuggestion(id, action);
      refetch();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Could not complete the action. Please try again.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
        <header className="mb-6 space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Command center</div>
          <h1 className="text-2xl font-semibold">Operations Overview</h1>
        </header>
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load operations data. The operations API may not be configured yet.</p>
            <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = data || {
    inbound_calls_today: 0,
    answered_today: 0,
    missed_today: 0,
    callback_backlog: 0,
    leads_awaiting_first_contact: 0,
    overdue_followups: 0,
    attribution_conflicts: 0,
    qa_review_queue: 0,
    supervisor_review_queue: 0,
    rep_capacity_warnings: 0,
    top_recommendations: [],
  };

  // Severity mapping per the design spec — drives the colored top-edge bar
  // and icon-tile color on every MetricCard. Tweaks the tone based on actual
  // values for the cards where the spec uses thresholds (success when 0).
  const answerRate = d.inbound_calls_today > 0
    ? Math.round((d.answered_today / d.inbound_calls_today) * 100)
    : 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] mx-auto space-y-6">
      {/* Page header — same shape as the home dashboard: small uppercase
          eyebrow, text-2xl font-semibold title, muted subtitle. No gradient,
          no decorative serif, no brand divider. */}
      <header className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Command center
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold">Operations Overview</h1>
          <Button variant="outline" size="sm" className="h-9" onClick={refetch}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Real-time command center for admissions operations — live calls, callback queues, and AI-generated coaching across your team.
        </p>
      </header>

      {/* Page hierarchy follows F-pattern reading: small at-a-glance KPIs
          first, then the most urgent issues, then live operational state,
          then slower-moving training/coaching signals. */}

      {/* 1. KPI strip — at-a-glance small cards across the top */}
      <TodayKpis />

      {/* 2. Two-column row — most urgent: what needs me NOW alongside
             what's happening NOW on the floor */}
      <div className="grid lg:grid-cols-2 gap-5">
        <AttentionStrip />
        <LiveFloor />
      </div>

      {/* 3. Slower-moving signal — coaching/training watchlist */}
      <TrainingWatchlist />

      {activeDrill && (
        <DrillDownPanel
          open={!!drillDown}
          onOpenChange={(open) => { if (!open) setDrillDown(null); }}
          title={activeDrill.title}
          fetchData={(limit, offset) => fetchDrillDownData(activeDrill.endpoint, limit, offset)}
          columns={activeDrill.columns}
          onRowClick={activeDrill.navigateTo ? () => navigate(activeDrill.navigateTo!) : undefined}
          rowClickLabel={activeDrill.rowClickLabel}
        />
      )}

      <section>
        <SectionHeader
          number="02"
          eyebrow="TOP RECOMMENDATIONS"
          title={<>AI suggestions for immediate action</>}
          actions={
            <Link href="/ops/suggestions" className="text-sm text-[#E89077] hover:text-[#5BA3D4] font-medium transition-colors">
              View all →
            </Link>
          }
        />
        <div className="mt-5">
          {d.top_recommendations.length === 0 ? (
            <div className="glass rounded-2xl text-center py-12">
              <Zap className="w-8 h-8 mx-auto mb-3 text-[#3D4E6E]" />
              <p className="text-sm text-[#C5D2E5]">No active recommendations</p>
              <p className="text-xs text-[#9AABC9] mt-1">Suggestions will appear here when the system detects actionable items</p>
            </div>
          ) : (
            <NestedRecommendations
              recs={d.top_recommendations}
              renderRec={(rec: OpsRecommendation) => {
                const ctx = rec.call_context;
                const isExpanded = expandedRecId === rec.id;
                return (
                  <div key={rec.id} className={`rounded-2xl transition-all duration-150 ${isExpanded ? "border-gradient-brand" : "glass"}`}>
                    <div className="p-5 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <button
                            onClick={() => setExpandedRecId(isExpanded ? null : rec.id)}
                            className="mt-0.5 shrink-0 text-[#9AABC9] hover:text-[#F4EFE6] transition-colors"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />
                            }
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <PriorityBadge priority={rec.priority} />
                              <h3 className="font-display text-[17px] font-normal tracking-[-0.005em] text-[#F4EFE6] leading-snug">{rec.title}</h3>
                            </div>
                            <p className="text-[13px] text-[#C5D2E5] leading-relaxed">{rec.summary}</p>

                            {ctx && !isExpanded && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#9AABC9]">
                                {ctx.caller_phone && (
                                  <span className="flex items-center gap-1 font-mono">
                                    <Phone className="w-3 h-3" /> {ctx.caller_phone}
                                  </span>
                                )}
                                {ctx.caller_name && (
                                  <span className="flex items-center gap-1">
                                    <User className="w-3 h-3" /> {ctx.caller_name}
                                  </span>
                                )}
                                {ctx.rep_name && (
                                  <span className="flex items-center gap-1">
                                    <Headphones className="w-3 h-3" /> {ctx.rep_name}
                                  </span>
                                )}
                                {ctx.call_time && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {formatDateTime(ctx.call_time)}
                                  </span>
                                )}
                                {ctx.duration_seconds != null && ctx.duration_seconds > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Timer className="w-3 h-3" /> {formatDuration(ctx.duration_seconds)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <ConfidenceIndicator confidence={rec.confidence} />
                      </div>

                      <div className="flex items-center justify-between pl-7">
                        <div className="flex items-center gap-3 text-[11.5px] text-[#9AABC9]">
                          {rec.action_owner && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" /> {rec.action_owner}
                            </span>
                          )}
                          <span>{rec.recommended_action}</span>
                        </div>
                        <SuggestionActions
                          suggestionId={rec.id}
                          onAcknowledge={(id) => handleAction(id, "acknowledge")}
                          onDismiss={(id) => handleAction(id, "dismiss")}
                          onAct={(id) => handleAction(id, "act")}
                          loading={actionLoading}
                        />
                      </div>
                    </div>

                    {isExpanded && ctx && (
                      <div className="px-5 pb-5 pt-0 border-t border-border/30 mt-0">
                        <div className="pt-4 pl-7 space-y-3">
                          {(ctx as any).call_session_id && (
                            <div className="flex items-center gap-3 flex-wrap">
                              <Link href={`/live/${(ctx as any).call_session_id}`} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                                Open coaching view <ArrowRight className="w-3 h-3" />
                              </Link>
                              {(ctx as any).ctm_call_id && (
                                <span className="text-[10px] font-mono text-muted-foreground">CTM {(ctx as any).ctm_call_id}</span>
                              )}
                            </div>
                          )}

                          {(ctx as any).recording_url && (
                            <div>
                              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                <Headphones className="w-3 h-3" /> Recording
                              </div>
                              <audio controls preload="none" className="w-full max-w-md h-9" src={(ctx as any).recording_url} />
                            </div>
                          )}

                          {(ctx as any).score && (
                            <div className="space-y-3 rounded-md bg-muted/30 border border-border/40 p-3">
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">QA breakdown</div>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-muted-foreground">composite</span>
                                  <span className={`text-lg font-semibold tabular-nums ${
                                    (ctx as any).score.composite >= 80 ? "text-emerald-500" :
                                    (ctx as any).score.composite >= 60 ? "text-amber-500" :
                                    "text-rose-500"
                                  }`}>{(ctx as any).score.composite ?? "—"}</span>
                                  {(ctx as any).score.sentiment && (
                                    <span className="px-1.5 py-0 rounded border border-border/40 text-[10px]">{(ctx as any).score.sentiment}</span>
                                  )}
                                </div>
                              </div>

                              {(ctx as any).score.rubric && (
                                <div className="grid grid-cols-3 md:grid-cols-9 gap-1.5">
                                  {[
                                    ["qualification_completeness", "Qual"],
                                    ["rapport_and_empathy", "Rapport"],
                                    ["objection_handling", "Object"],
                                    ["urgency_handling", "Urgency"],
                                    ["next_step_clarity", "Next"],
                                    ["script_adherence", "Script"],
                                    ["compliance", "Comply"],
                                    ["booking_or_transfer", "Book"],
                                    ["overall_quality", "Overall"],
                                  ].map(([key, label]) => {
                                    const v = (ctx as any).score.rubric[key as string];
                                    const cls = v == null ? "text-muted-foreground" :
                                      v >= 80 ? "text-emerald-500" :
                                      v >= 60 ? "text-amber-500" :
                                      "text-rose-500";
                                    return (
                                      <div key={key as string} className="border border-border/40 rounded p-1.5 text-center">
                                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
                                        <div className={`text-sm font-semibold tabular-nums ${cls}`}>{v ?? "—"}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {(ctx as any).score.compliance_flags?.length > 0 && (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-500 mb-1.5 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> Compliance flags ({(ctx as any).score.compliance_flags.length})
                                  </div>
                                  <div className="space-y-1.5">
                                    {(ctx as any).score.compliance_flags.map((f: any, i: number) => (
                                      <div key={i} className="border border-rose-500/30 bg-rose-500/5 rounded p-2 text-[11px]">
                                        <div className="font-medium">{f.flag}</div>
                                        {f.description && <div className="text-muted-foreground mt-0.5">{f.description}</div>}
                                        {f.transcript_ref && <div className="text-muted-foreground/80 mt-1 text-[10px]">"{f.transcript_ref}"</div>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(ctx as any).score.coaching_takeaways && (
                                <div className="grid md:grid-cols-2 gap-3">
                                  {(ctx as any).score.coaching_takeaways.what_went_well?.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500 mb-1">What went well</div>
                                      <ul className="text-[11px] space-y-0.5 list-disc list-inside text-muted-foreground">
                                        {(ctx as any).score.coaching_takeaways.what_went_well.map((t: string, i: number) => <li key={i}>{t}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {(ctx as any).score.coaching_takeaways.what_to_try?.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-500 mb-1">What to try</div>
                                      <ul className="text-[11px] space-y-0.5 list-disc list-inside text-muted-foreground">
                                        {(ctx as any).score.coaching_takeaways.what_to_try.map((t: string, i: number) => <li key={i}>{t}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                            {ctx.caller_phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3 text-blue-400" /> {ctx.caller_phone}
                              </span>
                            )}
                            {ctx.caller_name && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3 text-blue-400" /> {ctx.caller_name}
                              </span>
                            )}
                            {ctx.rep_name && (
                              <span className="flex items-center gap-1">
                                <Headphones className="w-3 h-3 text-emerald-400" /> {ctx.rep_name}
                              </span>
                            )}
                            {ctx.call_time && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {formatDateTime(ctx.call_time)}
                              </span>
                            )}
                            {ctx.duration_seconds != null && ctx.duration_seconds > 0 && (
                              <span className="flex items-center gap-1">
                                <Timer className="w-3 h-3" /> {formatDuration(ctx.duration_seconds)}
                                {ctx.talk_seconds != null && ctx.talk_seconds > 0 && ctx.talk_seconds !== ctx.duration_seconds && (
                                  <span className="text-muted-foreground/60">({formatDuration(ctx.talk_seconds)} talk)</span>
                                )}
                              </span>
                            )}
                            {ctx.direction && (
                              <span className="capitalize">{ctx.direction}</span>
                            )}
                            {ctx.call_status && (
                              <span className="px-1.5 py-0 rounded border border-border/40 text-[10px]">{ctx.call_status}</span>
                            )}
                          </div>

                          {ctx.lead_score != null && (
                            <div className="flex items-center gap-3 text-[11px]">
                              <span className="text-muted-foreground">Lead Score: <span className="font-medium text-foreground">{ctx.lead_score}</span></span>
                              {ctx.lead_quality_tier && (
                                <span className={`px-1.5 py-0 rounded border text-[10px] ${
                                  ctx.lead_quality_tier === "A" ? "border-emerald-500/40 text-emerald-400" :
                                  ctx.lead_quality_tier === "B" ? "border-blue-500/40 text-blue-400" :
                                  ctx.lead_quality_tier === "C" ? "border-amber-500/40 text-amber-400" :
                                  "border-red-500/40 text-red-400"
                                }`}>
                                  Tier {ctx.lead_quality_tier}
                                </span>
                              )}
                            </div>
                          )}

                          {rec.reason && rec.reason !== rec.summary && (
                            <div>
                              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Why This Matters</div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{rec.reason}</p>
                            </div>
                          )}

                          {ctx.transcript_excerpt && (
                            <div className="rounded-md bg-muted/30 border border-border/40 p-3 space-y-1">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <FileText className="w-3 h-3 text-muted-foreground/60" />
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transcript Preview</span>
                              </div>
                              {ctx.transcript_excerpt.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => {
                                const colonIdx = line.indexOf(":");
                                if (colonIdx > 0 && colonIdx < 40) {
                                  const speaker = line.slice(0, colonIdx).trim();
                                  const content = line.slice(colonIdx + 1).trim();
                                  return (
                                    <div key={i} className="text-[11px] leading-relaxed">
                                      <span className="font-medium text-blue-400/80">{speaker}:</span>{" "}
                                      <span className="text-muted-foreground">{content}</span>
                                    </div>
                                  );
                                }
                                return <div key={i} className="text-[11px] text-muted-foreground leading-relaxed">{line}</div>;
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            />
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Link href="/ops/workload" className="block">
          <Card className="hover:shadow-md hover:border-border transition-all duration-200 cursor-pointer h-full border-border/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-blue-500 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-sm font-medium">Rep Workload</div>
                <div className="text-xs text-muted-foreground">Agent capacity & performance</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/attribution" className="block">
          <Card className="hover:shadow-md hover:border-border transition-all duration-200 cursor-pointer h-full border-border/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-medium">Attribution Review</div>
                <div className="text-xs text-muted-foreground">{d.attribution_conflicts} conflicts pending</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/ops/supervisor-review" className="block">
          <Card className="hover:shadow-md hover:border-border transition-all duration-200 cursor-pointer h-full border-border/50">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-purple-500 dark:text-purple-400" />
              </div>
              <div>
                <div className="text-sm font-medium">Supervisor Review</div>
                <div className="text-xs text-muted-foreground">{d.supervisor_review_queue} items in queue</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

function CallLossSummary() {
  const { data } = usePollingFetch<{
    answered: number; short_abandon: number; true_abandon: number;
    critical_abandon: number; voicemail: number; no_agent_losses: number;
    queue_pending: number; sla_breached: number; abandon_rate: number;
  }>("/abandoned-calls/stats?days=30", { interval: 60000 });

  if (!data) return null;

  const segments = [
    { label: "True Abandons", value: data.true_abandon, color: "bg-yellow-500", textColor: "text-yellow-600" },
    { label: "Critical Abandons", value: data.critical_abandon, color: "bg-red-500", textColor: "text-red-600" },
    { label: "Short Abandons", value: data.short_abandon, color: "bg-gray-300 dark:bg-gray-600", textColor: "text-muted-foreground" },
    { label: "Voicemail", value: data.voicemail, color: "bg-blue-400", textColor: "text-blue-500" },
    { label: "No-Agent Losses", value: data.no_agent_losses, color: "bg-purple-400", textColor: "text-purple-500" },
  ];

  const hasAbandons = data.true_abandon + data.critical_abandon + data.short_abandon > 0;

  if (!hasAbandons) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneOff className="w-4 h-4 text-red-500" />
              Call Loss Summary
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Abandon rate: <span className="font-semibold">{data.abandon_rate}%</span> (excl. short abandons) · {data.queue_pending} pending follow-ups · {data.sla_breached} SLA breaches
            </p>
          </div>
          <Link href="/ops/abandoned-calls">
            <Button variant="ghost" size="sm" className="h-11 md:h-8 text-xs gap-1 text-primary">
              View Queue <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {segments.map((seg) => (
            <Link key={seg.label} href="/ops/abandoned-calls" className="flex items-center gap-2.5 rounded-md p-1.5 -m-1.5 hover:bg-accent/40 transition-colors cursor-pointer">
              <div className={`w-3 h-3 rounded-full ${seg.color} flex-shrink-0`} />
              <div>
                <div className={`text-lg font-semibold ${seg.textColor}`}>{seg.value}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">{seg.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Nested recommendations: priority → rep → suggestion
//
// Cornerstone managers were drowning in flat lists of "Drill recommended for X"
// rows that all looked identical at the surface level. Nest them so the eye
// can scan: priority bucket counts up top, expand to see which reps are
// flagged, expand a rep to see their actual drills.
// =============================================================================

const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;
const PRIORITY_TONE: Record<string, { bg: string; text: string; bar: string }> = {
  critical: { bg: "bg-rose-500/15",   text: "text-rose-300",     bar: "bg-rose-500" },
  high:     { bg: "bg-rose-500/10",   text: "text-rose-300",     bar: "bg-rose-500" },
  medium:   { bg: "bg-amber-500/10",  text: "text-amber-300",    bar: "bg-amber-500" },
  low:      { bg: "bg-zinc-500/10",   text: "text-zinc-300",     bar: "bg-zinc-500" },
};

function repLabelFor(rec: OpsRecommendation): string {
  return rec.specialist_name
    ?? rec.call_context?.rep_name
    ?? rec.action_owner
    ?? "Unassigned";
}

function NestedRecommendations({
  recs,
  renderRec,
}: {
  recs: OpsRecommendation[];
  renderRec: (rec: OpsRecommendation) => React.ReactNode;
}) {
  // Group by priority then by rep label
  const byPriority = new Map<string, Map<string, OpsRecommendation[]>>();
  for (const r of recs) {
    const pri = (r.priority ?? "medium").toLowerCase();
    const rep = repLabelFor(r);
    if (!byPriority.has(pri)) byPriority.set(pri, new Map());
    const repMap = byPriority.get(pri)!;
    if (!repMap.has(rep)) repMap.set(rep, []);
    repMap.get(rep)!.push(r);
  }

  const priorityKeys = PRIORITY_ORDER.filter((p) => byPriority.has(p));
  // Auto-expand the highest priority by default
  const [openPriorities, setOpenPriorities] = useState<Set<string>>(
    () => new Set(priorityKeys.length > 0 ? [priorityKeys[0]] : []),
  );
  const [openReps, setOpenReps] = useState<Set<string>>(new Set());

  function togglePriority(p: string) {
    const next = new Set(openPriorities);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setOpenPriorities(next);
  }
  function toggleRep(key: string) {
    const next = new Set(openReps);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenReps(next);
  }

  return (
    <div className="space-y-3">
      {priorityKeys.map((p) => {
        const repMap = byPriority.get(p)!;
        const totalRecs = Array.from(repMap.values()).reduce((s, r) => s + r.length, 0);
        const tone = PRIORITY_TONE[p];
        const isOpen = openPriorities.has(p);
        return (
          <div key={p} className="glass rounded-2xl overflow-hidden">
            {/* Priority header */}
            <button
              onClick={() => togglePriority(p)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/20 transition-colors"
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDown className="w-4 h-4 text-[#9AABC9]" /> : <ChevronRight className="w-4 h-4 text-[#9AABC9]" />}
              <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${tone.bg} ${tone.text}`}>
                {p}
              </span>
              <span className="text-sm font-medium text-[#F4EFE6]">
                {totalRecs} suggestion{totalRecs === 1 ? "" : "s"} across {repMap.size} {repMap.size === 1 ? "rep" : "reps"}
              </span>
            </button>

            {/* Reps inside this priority */}
            {isOpen && (
              <div className="border-t border-border/40 divide-y divide-border/40">
                {Array.from(repMap.entries())
                  .sort((a, b) => b[1].length - a[1].length)
                  .map(([rep, repRecs]) => {
                    const repKey = `${p}::${rep}`;
                    const repOpen = openReps.has(repKey);
                    return (
                      <div key={repKey}>
                        <button
                          onClick={() => toggleRep(repKey)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/20 transition-colors"
                          aria-expanded={repOpen}
                        >
                          {repOpen ? <ChevronDown className="w-4 h-4 text-[#9AABC9]" /> : <ChevronRight className="w-4 h-4 text-[#9AABC9]" />}
                          <span className="flex items-center gap-2 flex-1 min-w-0">
                            <Headphones className="w-3.5 h-3.5 text-[#9AABC9]" />
                            <span className="text-sm text-[#F4EFE6] truncate">{rep}</span>
                          </span>
                          <span className="text-xs text-[#9AABC9] tabular-nums shrink-0">
                            {repRecs.length} {repRecs.length === 1 ? "drill" : "drills"}
                          </span>
                        </button>

                        {/* Actual recs for this rep */}
                        {repOpen && (
                          <div className="px-3 pb-4 space-y-3">
                            {repRecs.map((rec) => (
                              <div key={rec.id}>{renderRec(rec)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OpsOverview() {
  return <OpsRoleGuard><OpsOverviewContent /></OpsRoleGuard>;
}
