import { Link, useLocation } from "wouter";
import { useState, useEffect, useCallback } from "react";
import {
  PhoneIncoming, PhoneMissed, PhoneForwarded, Clock, AlertTriangle,
  UserPlus, Shield, GitBranch, Eye, Activity, Filter, X, Check,
  Users, Zap, BarChart3, ChevronRight, Sparkles, Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/section-header";
import { DrillDownPanel, type ColumnDef } from "@/components/drill-down-panel";
import { useRole } from "@/lib/role-context";
import { useWorkflow } from "@/lib/workflow-context";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";
import { fetchDrillDownData } from "@/hooks/use-ops-api";
import {
  getSuggestionTypeLabel, getPriorityOrder,
  attentionItemsFromMetrics,
  type Suggestion, type SuggestionType, type SuggestionListResponse,
  type Priority, type RepWorkload, type TodayMetrics, type AttentionItem,
} from "@/lib/types";

const SUGGESTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  assign_lead: <UserPlus className="w-4 h-4" />,
  schedule_callback: <PhoneForwarded className="w-4 h-4" />,
  preserve_owner: <Shield className="w-4 h-4" />,
  review_attribution: <GitBranch className="w-4 h-4" />,
  supervisor_review: <Eye className="w-4 h-4" />,
  missed_call_callback: <PhoneMissed className="w-4 h-4" />,
  urgent_high_intent_lead: <Zap className="w-4 h-4" />,
  reassign_due_to_overload: <Users className="w-4 h-4" />,
  poor_call_needs_supervisor_review: <Eye className="w-4 h-4" />,
  attribution_conflict_review: <GitBranch className="w-4 h-4" />,
  new_kb_draft_ready_for_approval: <Activity className="w-4 h-4" />,
  task_overdue: <Clock className="w-4 h-4" />,
  lead_missing_required_fields: <AlertTriangle className="w-4 h-4" />,
};

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  medium: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  low: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
};

const AVAILABILITY_STYLES: Record<string, { dot: string; label: string }> = {
  available: { dot: "bg-green-500", label: "Available" },
  on_call: { dot: "bg-amber-500 animate-pulse", label: "On Call" },
  away: { dot: "bg-slate-400", label: "Away" },
  offline: { dot: "bg-slate-600", label: "Offline" },
};

function getConfidenceTier(c: number): { label: string; color: string } {
  if (c >= 0.9) return { label: "Very High", color: "text-green-400 bg-green-500/10 border-green-500/20" };
  if (c >= 0.75) return { label: "High", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  if (c >= 0.5) return { label: "Moderate", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  return { label: "Low", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" };
}

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function AttentionBanner({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-amber-200/40 bg-amber-50/30 dark:bg-amber-500/5 dark:border-amber-500/15 overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground mb-2">What needs attention right now</h2>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {items.map((item, i) => (
                <span key={i} className="text-sm text-muted-foreground">
                  <span className={`font-semibold ${item.type === "critical" ? "text-red-400" : item.type === "warning" ? "text-amber-400" : "text-blue-400"}`}>
                    {item.count}
                  </span>{" "}
                  {item.label}
                  {i < items.length - 1 && <span className="ml-4 text-muted-foreground/30">·</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTime(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
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

const INBOUND_COLUMNS: ColumnDef[] = [
  { key: "caller_name", label: "Caller" },
  { key: "call_time", label: "Time", render: (v) => formatTime(v) },
  { key: "call_status", label: "Status" },
  { key: "duration_seconds", label: "Duration", render: (v) => formatDuration(v) },
  { key: "rep_name", label: "Rep" },
  { key: "direction", label: "Direction" },
];

const MISSED_COLUMNS: ColumnDef[] = [
  { key: "caller_phone", label: "Phone" },
  { key: "caller_name", label: "Caller" },
  { key: "call_time", label: "Time", render: (v) => formatTime(v) },
  { key: "tracking_source", label: "Source" },
  { key: "caller_city", label: "City" },
  { key: "caller_state", label: "State" },
];

const CALLBACK_BACKLOG_COLUMNS: ColumnDef[] = [
  { key: "caller_phone", label: "Phone" },
  { key: "caller_name", label: "Caller" },
  { key: "call_time", label: "Call Time", render: (v) => formatTime(v) },
  { key: "age_minutes", label: "Waiting", render: (v) => formatAge(v) },
  { key: "tracking_source", label: "Source" },
];

const AWAITING_CONTACT_COLUMNS: ColumnDef[] = [
  { key: "caller_phone", label: "Phone" },
  { key: "caller_name", label: "Caller" },
  { key: "call_time", label: "Missed Call Time", render: (v) => formatTime(v) },
  { key: "age_minutes", label: "Age", render: (v) => formatAge(v) },
  { key: "tracking_source", label: "Source" },
];

const ATTRIBUTION_COLUMNS: ColumnDef[] = [
  { key: "ctm_call_id", label: "Call ID" },
  { key: "ctm_source", label: "CTM Source" },
  { key: "zoho_source", label: "Zoho Source" },
  { key: "conflict_reason", label: "Reason" },
  { key: "created_at", label: "Created", render: (v) => formatDateTime(v) },
];

const CALLS_TO_REVIEW_COLUMNS: ColumnDef[] = [
  { key: "ctm_call_id", label: "Call ID" },
  { key: "rep_name", label: "Rep" },
  { key: "flag_reason", label: "Flag Reason" },
  { key: "qa_score_percent", label: "Grade", render: (v) => typeof v === "number" ? `${v}%` : "—" },
  { key: "created_at", label: "Created", render: (v) => formatDateTime(v) },
];

type DrillDownKey = "inbound" | "missed" | "callback-backlog" | "awaiting-first-contact" | "attribution" | "calls-to-review";

function MetricsStrip({ metrics, isLoading }: { metrics: TodayMetrics | null; isLoading: boolean }) {
  const [drillDown, setDrillDown] = useState<DrillDownKey | null>(null);
  const [, navigate] = useLocation();

  const cards: { label: string; value: number | undefined; icon: React.ReactNode; accent: string; drillKey: DrillDownKey }[] = [
    { label: "Inbound Today", value: metrics?.inboundToday, icon: <PhoneIncoming className="w-4 h-4 text-blue-400" />, accent: "text-foreground", drillKey: "inbound" },
    { label: "Missed Today", value: metrics?.missedToday, icon: <PhoneMissed className="w-4 h-4 text-red-400" />, accent: "text-red-400", drillKey: "missed" },
    { label: "Callback Backlog", value: metrics?.callbackBacklog, icon: <PhoneForwarded className="w-4 h-4 text-amber-400" />, accent: "text-amber-400", drillKey: "callback-backlog" },
    { label: "Awaiting 1st Contact", value: metrics?.leadsAwaitingFirstContact, icon: <Clock className="w-4 h-4 text-cyan-400" />, accent: "text-cyan-400", drillKey: "awaiting-first-contact" },
    { label: "Attribution Conflicts", value: metrics?.attributionConflicts, icon: <GitBranch className="w-4 h-4 text-violet-400" />, accent: "text-violet-400", drillKey: "attribution" },
    { label: "Calls to Review", value: metrics?.poorCallsNeedingReview, icon: <Eye className="w-4 h-4 text-orange-400" />, accent: "text-orange-400", drillKey: "calls-to-review" },
  ];

  const drillConfig: Record<DrillDownKey, {
    title: string;
    endpoint: string;
    columns: ColumnDef[];
    onRowClick?: (row: Record<string, unknown>) => void;
    rowClickLabel?: string;
  }> = {
    inbound: { title: "Inbound Calls Today", endpoint: "/ops/overview/inbound", columns: INBOUND_COLUMNS },
    missed: { title: "Missed Calls Today", endpoint: "/ops/overview/missed", columns: MISSED_COLUMNS },
    "callback-backlog": { title: "Callback Backlog", endpoint: "/ops/overview/callback-backlog", columns: CALLBACK_BACKLOG_COLUMNS },
    "awaiting-first-contact": { title: "Awaiting 1st Contact", endpoint: "/ops/overview/awaiting-first-contact", columns: AWAITING_CONTACT_COLUMNS },
    attribution: {
      title: "Attribution Conflicts",
      endpoint: "/ops/attribution-conflicts?status=pending",
      columns: ATTRIBUTION_COLUMNS,
      onRowClick: () => navigate("/ops/attribution"),
      rowClickLabel: "Go to Attribution Review",
    },
    "calls-to-review": {
      title: "Calls to Review",
      endpoint: "/ops/overview/qa-review-queue",
      columns: CALLS_TO_REVIEW_COLUMNS,
      onRowClick: () => navigate("/ops/supervisor-review"),
      rowClickLabel: "Go to Supervisor Review",
    },
  };

  const activeDrill = drillDown ? drillConfig[drillDown] : null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((card) => (
          <TooltipProvider key={card.label} delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Card
                  className="overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md hover:border-border active:scale-[0.99] border-border/50"
                  onClick={() => setDrillDown(card.drillKey)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-medium text-muted-foreground tracking-wide leading-tight">{card.label}</span>
                      {card.icon}
                    </div>
                    {isLoading ? (
                      <Skeleton className="h-8 w-16 rounded" />
                    ) : (
                      <div className={`text-2xl font-bold tracking-tight ${card.accent}`}>{card.value ?? 0}</div>
                    )}
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Click to view details
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>

      {activeDrill && (
        <DrillDownPanel
          open={!!drillDown}
          onOpenChange={(open) => { if (!open) setDrillDown(null); }}
          title={activeDrill.title}
          fetchData={(limit, offset) => fetchDrillDownData(activeDrill.endpoint, limit, offset)}
          columns={activeDrill.columns}
          onRowClick={activeDrill.onRowClick}
          rowClickLabel={activeDrill.rowClickLabel}
        />
      )}
    </>
  );
}

function FilterBar({
  filters,
  onFilterChange,
  repNames,
}: {
  filters: FilterState;
  onFilterChange: (f: FilterState) => void;
  repNames: string[];
}) {
  const activeCount = Object.values(filters).filter((v) => v !== "all").length;

  const Pill = ({ label, value, options, field }: { label: string; value: string; options: { value: string; label: string }[]; field: keyof FilterState }) => (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onFilterChange({ ...filters, [field]: e.target.value })}
        className={`appearance-none text-xs px-3 py-3 md:py-1.5 min-h-[44px] md:min-h-0 rounded-full border cursor-pointer transition-colors ${
          value !== "all"
            ? "bg-primary/10 border-primary/30 text-primary font-medium"
            : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-muted-foreground mr-1">
        <Filter className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Filters</span>
        {activeCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{activeCount}</Badge>
        )}
      </div>
      <Pill label="Priority" value={filters.priority} field="priority" options={[
        { value: "all", label: "All Priorities" },
        { value: "critical", label: "Critical" },
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ]} />
      <Pill label="Rep" value={filters.rep} field="rep" options={[
        { value: "all", label: "All Reps" },
        ...repNames.map((n) => ({ value: n, label: n })),
      ]} />
      <Pill label="Type" value={filters.type} field="type" options={[
        { value: "all", label: "All Types" },
        { value: "missed_call_callback", label: "Missed Call" },
        { value: "urgent_high_intent_lead", label: "High Intent" },
        { value: "reassign_due_to_overload", label: "Reassign" },
        { value: "poor_call_needs_supervisor_review", label: "Supervisor" },
        { value: "attribution_conflict_review", label: "Attribution" },
        { value: "task_overdue", label: "Task Overdue" },
        { value: "lead_missing_required_fields", label: "Missing Fields" },
        { value: "new_kb_draft_ready_for_approval", label: "KB Draft" },
      ]} />
      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 md:h-7 text-xs gap-1 text-muted-foreground"
          onClick={() => onFilterChange({ priority: "all", rep: "all", source: "all", queue: "all", type: "all" })}
        >
          <X className="w-3 h-3" />
          Clear
        </Button>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onAction,
  isActioned,
}: {
  suggestion: Suggestion;
  onAction: (id: string, action: string) => void;
  isActioned: boolean;
}) {
  const tier = getConfidenceTier(suggestion.confidence);
  const pStyle = PRIORITY_STYLES[suggestion.priority as Priority] ?? PRIORITY_STYLES.medium;
  const typeLabel = getSuggestionTypeLabel(suggestion.type);
  const typeIcon = SUGGESTION_TYPE_ICONS[suggestion.type] ?? <Activity className="w-4 h-4" />;
  const createdAt = suggestion.created_at ? new Date(suggestion.created_at) : new Date();

  return (
    <Link href={`/suggestion/${suggestion.suggestion_id}`} className="block">
      <Card className={`transition-all duration-200 cursor-pointer border-border/50 ${isActioned ? "opacity-60 scale-[0.98]" : "hover:shadow-md hover:border-border"}`}>
        <CardContent className="p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-lg ${pStyle.bg} flex items-center justify-center shrink-0 mt-0.5`}>
              <span className={pStyle.text}>{typeIcon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-sm font-semibold text-foreground">{typeLabel}</span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${pStyle.text} ${pStyle.bg} ${pStyle.border}`}>
                  {suggestion.priority}
                </Badge>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tier.color}`}>
                  {tier.label} — {Math.round(suggestion.confidence * 100)}%
                </Badge>
                <span className="text-[11px] text-muted-foreground/60 ml-auto shrink-0">{timeAgo(createdAt)}</span>
              </div>

              <p className="text-sm font-medium text-foreground/90 leading-relaxed mb-1">{suggestion.title}</p>

              <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-muted/30 border border-border/50">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.summary}</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {suggestion.related_call_id && (
                    <span>Call: {suggestion.related_call_id}</span>
                  )}
                  {suggestion.related_rep_id && (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{suggestion.related_rep_id}</span>
                    </>
                  )}
                  {suggestion.recommended_action && (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span>{suggestion.recommended_action}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
                  {isActioned ? (
                    <div className="flex items-center gap-1.5 text-green-400 text-xs font-medium">
                      <Check className="w-4 h-4" />
                      Done
                    </div>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-11 md:h-7 text-xs gap-1"
                        onClick={(e) => { e.preventDefault(); onAction(suggestion.suggestion_id, typeLabel); }}
                      >
                        {typeLabel}
                        <ChevronRight className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-11 md:h-7 text-xs text-muted-foreground"
                        onClick={(e) => { e.preventDefault(); onAction(suggestion.suggestion_id, "Dismissed"); }}
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SuggestionsFeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array(4).fill(0).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                  <Skeleton className="h-4 w-28 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Skeleton className="h-3 w-20 rounded" />
                    <Skeleton className="h-3 w-16 rounded" />
                  </div>
                  <Skeleton className="h-7 w-20 rounded" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function RepWorkloadPanel({ reps, isLoading }: { reps: RepWorkload[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-32 rounded" />
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rep Workload</span>
        </div>
        <div className="space-y-3">
          {reps.map((rep) => {
            const avail = AVAILABILITY_STYLES[rep.availability_status] || AVAILABILITY_STYLES.offline;
            const loadPct = Math.round(rep.workload_score * 100);
            const loadColor = loadPct > 80 ? "bg-red-500" : loadPct > 60 ? "bg-amber-500" : "bg-green-500";
            const displayName = rep.rep_name ?? rep.rep_id;
            return (
              <div key={rep.id} className="group">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground">
                      {getInitials(displayName)}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${avail.dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground truncate">{displayName}</span>
                      <span className="text-[10px] text-muted-foreground">{loadPct}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1 mt-1">
                      <div
                        className={`h-1 rounded-full transition-all duration-500 ${loadColor}`}
                        style={{ width: `${Math.min(loadPct, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="ml-11 mt-1 flex items-center gap-3 text-[10px] text-muted-foreground/70">
                  <span>{rep.open_leads} leads</span>
                  <span>{rep.overdue_callbacks} callbacks</span>
                  <span>{rep.calls_today} calls</span>
                  <span>{rep.active_tasks} tasks</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyFeedState() {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center justify-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <Sparkles className="w-7 h-7 text-muted-foreground/40" />
        </div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">No suggestions match your filters</h3>
        <p className="text-xs text-muted-foreground/60 max-w-xs">Try adjusting your filter criteria or clear all filters to see the full suggestions feed.</p>
      </CardContent>
    </Card>
  );
}

interface FilterState {
  priority: string;
  rep: string;
  source: string;
  queue: string;
  type: string;
}

export default function Home() {
  const { userName } = useRole();
  const { setMode } = useWorkflow();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reps, setReps] = useState<RepWorkload[]>([]);
  const [metrics, setMetrics] = useState<TodayMetrics | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    priority: "all", rep: "all", source: "all", queue: "all", type: "all",
  });

  useEffect(() => {
    setMode("admin");
  }, [setMode]);

  useEffect(() => {
    async function loadData() {
      try {
        const [sugRes, workloadRes, overviewRes] = await Promise.all([
          apiFetch("/ops/suggestions?per_page=50&status=open"),
          apiFetch("/ops/workload?latest_only=true"),
          apiFetch("/ops/overview"),
        ]);

        if (sugRes.ok) {
          const data = await sugRes.json();
          setSuggestions(data.suggestions || data.items || []);
        }

        if (workloadRes.ok) {
          const data = await workloadRes.json();
          setReps(Array.isArray(data) ? data : (data.reps || []));
        }

        if (overviewRes.ok) {
          const overview = await overviewRes.json();
          const m: TodayMetrics = {
            inboundToday: overview.inbound_calls_today || 0,
            missedToday: overview.missed_today || 0,
            callbackBacklog: overview.callback_backlog || 0,
            leadsAwaitingFirstContact: overview.leads_awaiting_first_contact || 0,
            attributionConflicts: overview.attribution_conflicts || 0,
            poorCallsNeedingReview: overview.qa_review_queue || overview.flagged_review_queue || 0,
          };
          setMetrics(m);
          setAttentionItems(attentionItemsFromMetrics(m));
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleAction = useCallback(async (suggestionId: string, actionLabel: string) => {
    const action = actionLabel === "Dismissed" ? "dismiss" : "complete";
    try {
      const res = await apiFetch(`/ops/suggestions/${suggestionId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: userName, notes: actionLabel }),
      });
      if (!res.ok) throw new Error("Action failed");

      if (actionLabel === "Dismissed") {
        setDismissedIds((prev) => new Set(prev).add(suggestionId));
        toast({
          title: "Suggestion dismissed",
          description: "This suggestion has been removed from your feed.",
        });
      } else {
        setActionedIds((prev) => new Set(prev).add(suggestionId));
        toast({
          title: `${actionLabel} completed`,
          description: "The action has been recorded and the relevant team has been notified.",
        });
      }
    } catch {
      toast({
        title: "Action failed",
        description: "Could not complete the action. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast, userName]);

  const filteredSuggestions = suggestions
    .filter((s) => {
      if (dismissedIds.has(s.suggestion_id)) return false;
      if (filters.priority !== "all" && s.priority !== filters.priority) return false;
      if (filters.rep !== "all" && s.related_rep_id !== filters.rep) return false;
      if (filters.type !== "all" && s.type !== filters.type) return false;
      return true;
    })
    .sort((a, b) => getPriorityOrder(a.priority as Priority) - getPriorityOrder(b.priority as Priority));

  const repNames = reps.map((r) => r.rep_name ?? r.rep_id);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-[1400px] mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title={`${greeting}, ${userName.split(" ")[0]}`}
        subtitle="Your admissions operations cockpit — suggestions, metrics, and rep workload at a glance."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1 px-2 py-1">
              <Activity className="w-3 h-3 text-green-400" />
              Live
            </Badge>
          </div>
        }
      />

      {!isLoading && <AttentionBanner items={attentionItems} />}
      {isLoading && (
        <Card className="overflow-hidden">
          <CardContent className="p-5 flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 rounded" />
              <Skeleton className="h-3 w-72 rounded" />
            </div>
          </CardContent>
        </Card>
      )}

      <MetricsStrip metrics={metrics} isLoading={isLoading} />

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Suggestions Feed</h2>
              {!isLoading && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{filteredSuggestions.length}</Badge>
              )}
            </div>
          </div>

          <FilterBar filters={filters} onFilterChange={setFilters} repNames={repNames} />

          {isLoading ? (
            <SuggestionsFeedSkeleton />
          ) : filteredSuggestions.length === 0 ? (
            <EmptyFeedState />
          ) : (
            <div className="space-y-3">
              {filteredSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.suggestion_id}
                  suggestion={suggestion}
                  onAction={handleAction}
                  isActioned={actionedIds.has(suggestion.suggestion_id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="w-full lg:w-80 shrink-0">
          <RepWorkloadPanel reps={reps} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
