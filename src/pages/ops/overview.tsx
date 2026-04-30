import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { StatCard } from "@/components/ops/stat-card";
import { PriorityBadge } from "@/components/ops/priority-badge";
import { ConfidenceIndicator } from "@/components/ops/confidence-indicator";
import { SuggestionActions } from "@/components/ops/suggestion-actions";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { DrillDownPanel, type ColumnDef } from "@/components/drill-down-panel";
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
      <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto">
        <PageHeader title="Operations Overview" subtitle="Manager command center" />
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

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-7xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Operations Overview"
        subtitle="Real-time command center for admissions operations"
        actions={
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={refetch}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <StatCard
          label="Inbound Today"
          value={d.inbound_calls_today}
          icon={<Phone className="w-4 h-4 text-blue-400" />}
          loading={loading && !data}
          onClick={() => setDrillDown("inbound")}
        />
        <StatCard
          label="Answered"
          value={d.answered_today}
          icon={<Phone className="w-4 h-4 text-emerald-400" />}
          change={d.inbound_calls_today > 0 ? `${Math.round((d.answered_today / d.inbound_calls_today) * 100)}% rate` : undefined}
          changeType="positive"
          loading={loading && !data}
          onClick={() => setDrillDown("answered")}
        />
        <StatCard
          label="Missed"
          value={d.missed_today}
          icon={<PhoneMissed className="w-4 h-4 text-red-400" />}
          changeType={d.missed_today > 5 ? "negative" : "neutral"}
          loading={loading && !data}
          onClick={() => setDrillDown("missed")}
        />
        <StatCard
          label="Callback Backlog"
          value={d.callback_backlog}
          icon={<Clock className="w-4 h-4 text-amber-400" />}
          changeType={d.callback_backlog > 10 ? "negative" : "neutral"}
          loading={loading && !data}
          onClick={() => setDrillDown("callback-backlog")}
        />
        <StatCard
          label="Awaiting 1st Contact"
          value={d.leads_awaiting_first_contact}
          icon={<Target className="w-4 h-4 text-violet-400" />}
          loading={loading && !data}
          onClick={() => setDrillDown("awaiting-first-contact")}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <StatCard
          label="Overdue Follow-ups"
          value={d.overdue_followups}
          icon={<AlertTriangle className="w-4 h-4 text-orange-400" />}
          changeType={d.overdue_followups > 5 ? "negative" : "neutral"}
          loading={loading && !data}
          onClick={() => setDrillDown("overdue")}
        />
        <StatCard
          label="Attribution Conflicts"
          value={d.attribution_conflicts}
          icon={<Activity className="w-4 h-4 text-amber-400" />}
          loading={loading && !data}
          onClick={() => setDrillDown("attribution")}
        />
        <StatCard
          label="QA Review Queue"
          value={d.qa_review_queue}
          icon={<ShieldAlert className="w-4 h-4 text-cyan-400" />}
          loading={loading && !data}
          onClick={() => setDrillDown("qa-review")}
        />
        <StatCard
          label="Supervisor Queue"
          value={d.supervisor_review_queue}
          icon={<Eye className="w-4 h-4 text-purple-400" />}
          loading={loading && !data}
          onClick={() => setDrillDown("supervisor")}
        />
        <StatCard
          label="Rep Capacity Warnings"
          value={d.rep_capacity_warnings}
          icon={<UserX className="w-4 h-4 text-red-400" />}
          changeType={d.rep_capacity_warnings > 0 ? "negative" : "neutral"}
          loading={loading && !data}
          onClick={() => setDrillDown("rep-capacity")}
        />
      </div>

      <CallLossSummary />

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

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Top Recommendations
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">AI-generated suggestions for immediate action</p>
            </div>
            <Link href="/ops/suggestions">
              <Button variant="ghost" size="sm" className="h-11 md:h-8 text-xs gap-1 text-primary">
                View All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {d.top_recommendations.length === 0 ? (
            <div className="text-center py-10">
              <Zap className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No active recommendations</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Suggestions will appear here when the system detects actionable items</p>
            </div>
          ) : (
            <div className="space-y-3">
              {d.top_recommendations.slice(0, 5).map((rec: OpsRecommendation) => {
                const ctx = rec.call_context;
                const isExpanded = expandedRecId === rec.id;
                return (
                  <div key={rec.id} className="border border-border/50 rounded-xl hover:bg-muted/20 transition-all duration-200">
                    <div className="p-5 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <button
                            onClick={() => setExpandedRecId(isExpanded ? null : rec.id)}
                            className="mt-0.5 shrink-0 hover:text-foreground text-muted-foreground transition-colors"
                          >
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />
                            }
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <PriorityBadge priority={rec.priority} />
                              <span className="text-sm font-medium">{rec.title}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{rec.summary}</p>

                            {ctx && !isExpanded && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                                {ctx.caller_phone && (
                                  <span className="flex items-center gap-1">
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
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
            <div key={seg.label} className="flex items-center gap-2.5">
              <div className={`w-3 h-3 rounded-full ${seg.color} flex-shrink-0`} />
              <div>
                <div className={`text-lg font-semibold ${seg.textColor}`}>{seg.value}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">{seg.label}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function OpsOverview() {
  return <OpsRoleGuard><OpsOverviewContent /></OpsRoleGuard>;
}
