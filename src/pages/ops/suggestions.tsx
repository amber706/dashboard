import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { PriorityBadge } from "@/components/ops/priority-badge";
import { ConfidenceIndicator, ConfidenceBar } from "@/components/ops/confidence-indicator";
import { SuggestionActions } from "@/components/ops/suggestion-actions";
import { QueueFilters } from "@/components/ops/queue-filters";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { useToast } from "@/hooks/use-toast";
import { useOpsSuggestions, actOnSuggestion, type OpsSuggestion, type CallContext } from "@/hooks/use-ops-api";
import {
  RefreshCw, Zap, Users, Phone, AlertTriangle,
  Clock, Link2, ChevronDown, ChevronRight,
  MapPin, PhoneIncoming, PhoneOutgoing, Timer, FileText,
  User, Tag, Headphones,
} from "lucide-react";

const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "workload_balance", label: "Workload Balance" },
  { value: "callback_reminder", label: "Callback Reminder" },
  { value: "lead_reassignment", label: "Lead Reassignment" },
  { value: "qa_flag", label: "QA Flag" },
  { value: "staffing_alert", label: "Staffing Alert" },
  { value: "attribution_conflict", label: "Attribution" },
  { value: "coaching_opportunity", label: "Coaching" },
  { value: "low_quality_or_wrong_fit_lead", label: "Low Quality Lead" },
  { value: "missed_call_callback", label: "Missed Callback" },
  { value: "poor_call_needs_supervisor_review", label: "Poor QA" },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "All Priorities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "completed", label: "Completed" },
  { value: "dismissed", label: "Dismissed" },
];

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatCallTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function CallerInfo({ ctx }: { ctx: CallContext }) {
  const name = ctx.caller_name;
  const phone = ctx.caller_phone;
  const location = [ctx.caller_city, ctx.caller_state].filter(Boolean).join(", ");

  if (!name && !phone && !location) return null;

  return (
    <div className="flex items-start gap-2">
      <User className="w-3.5 h-3.5 mt-0.5 text-blue-400 shrink-0" />
      <div className="min-w-0">
        {name && <span className="text-xs font-medium text-foreground">{name}</span>}
        {phone && <span className="text-[11px] text-muted-foreground ml-2">{phone}</span>}
        {location && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="w-2.5 h-2.5" /> {location}
          </span>
        )}
      </div>
    </div>
  );
}

function CallMeta({ ctx }: { ctx: CallContext }) {
  const DirectionIcon = ctx.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const dirLabel = ctx.direction === "inbound" ? "Inbound" : ctx.direction === "outbound" ? "Outbound" : ctx.direction;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {ctx.direction && (
        <span className="flex items-center gap-1">
          <DirectionIcon className="w-3 h-3" /> {dirLabel}
        </span>
      )}
      {ctx.call_time && (
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {formatCallTime(ctx.call_time)}
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
      {ctx.rep_name && (
        <span className="flex items-center gap-1">
          <Headphones className="w-3 h-3" /> {ctx.rep_name}
        </span>
      )}
      {ctx.tracking_label && (
        <span className="flex items-center gap-1">
          <Tag className="w-3 h-3" /> {ctx.tracking_label}
        </span>
      )}
      {ctx.call_status && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0">{ctx.call_status}</Badge>
      )}
    </div>
  );
}

function TranscriptExcerpt({ text }: { text: string }) {
  const lines = text.split("\n").filter(l => l.trim());
  return (
    <div className="mt-2 rounded-md bg-muted/30 border border-border/40 p-3 space-y-1">
      <div className="flex items-center gap-1.5 mb-1.5">
        <FileText className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transcript Preview</span>
      </div>
      {lines.map((line, i) => {
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
  );
}

function CallContextCard({ ctx }: { ctx: CallContext }) {
  return (
    <div className="mt-2 space-y-2 pl-1">
      <CallerInfo ctx={ctx} />
      <CallMeta ctx={ctx} />
      {ctx.lead_score != null && (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-muted-foreground">Lead Score: <span className="font-medium text-foreground">{ctx.lead_score}</span></span>
          {ctx.lead_quality_tier && (
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
              ctx.lead_quality_tier === "A" ? "border-emerald-500/40 text-emerald-400" :
              ctx.lead_quality_tier === "B" ? "border-blue-500/40 text-blue-400" :
              ctx.lead_quality_tier === "C" ? "border-amber-500/40 text-amber-400" :
              "border-red-500/40 text-red-400"
            }`}>
              Tier {ctx.lead_quality_tier}
            </Badge>
          )}
          {ctx.zoho_lead_id && (
            <span className="text-muted-foreground/60">Zoho: {ctx.zoho_lead_id}</span>
          )}
        </div>
      )}
      {ctx.transcript_excerpt && <TranscriptExcerpt text={ctx.transcript_excerpt} />}
    </div>
  );
}

function OpsSuggestionsContent() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const { toast } = useToast();

  const { data, loading, error, refetch } = useOpsSuggestions(
    { type: typeFilter, priority: priorityFilter, status: statusFilter },
    { interval: 15000 }
  );

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

  const suggestions = data?.suggestions || [];

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Live Suggestions Feed"
        subtitle="Prioritized AI-generated recommendations for your team"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      <QueueFilters
        filters={[
          { key: "type", label: "Type", options: TYPE_OPTIONS, value: typeFilter, onChange: setTypeFilter },
          { key: "priority", label: "Priority", options: PRIORITY_OPTIONS, value: priorityFilter, onChange: setPriorityFilter },
          { key: "status", label: "Status", options: STATUS_OPTIONS, value: statusFilter, onChange: setStatusFilter },
        ]}
      />

      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : error && !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load suggestions. The operations API may not be configured yet.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : suggestions.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Zap className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">No suggestions found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Try adjusting your filters or check back later</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((suggestion: OpsSuggestion) => {
            const isExpanded = expandedId === suggestion.id;
            const ctx = suggestion.call_context;

            return (
              <Card
                key={suggestion.id}
                className="hover:bg-muted/10 transition-colors"
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : suggestion.id)}
                        className="mt-0.5 shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <PriorityBadge priority={suggestion.priority} />
                          <span className="text-sm font-medium">{suggestion.title}</span>
                          <Badge variant="outline" className="text-[10px]">{suggestion.type.replace(/_/g, " ")}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{suggestion.summary}</p>

                        {ctx && !isExpanded && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                            {ctx.caller_name && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" /> {ctx.caller_name}
                              </span>
                            )}
                            {ctx.caller_phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {ctx.caller_phone}
                              </span>
                            )}
                            {ctx.rep_name && (
                              <span className="flex items-center gap-1">
                                <Headphones className="w-3 h-3" /> {ctx.rep_name}
                              </span>
                            )}
                            {ctx.call_time && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {formatCallTime(ctx.call_time)}
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
                    <div className="shrink-0 flex items-center gap-2">
                      <ConfidenceIndicator confidence={suggestion.confidence} showPercent />
                      {suggestion.status !== "new" && suggestion.status !== "open" && (
                        <Badge className={`text-[10px] ${
                          suggestion.status === "completed" ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" :
                          suggestion.status === "acknowledged" ? "bg-cyan-600/20 text-cyan-400 border-cyan-600/30" :
                          "bg-slate-600/20 text-slate-400 border-slate-600/30"
                        }`}>
                          {suggestion.status}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pl-7">
                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                      {suggestion.action_owner && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {suggestion.action_owner}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3" /> {suggestion.recommended_action}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {suggestion.created_at ? new Date(suggestion.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                    {(suggestion.status === "new" || suggestion.status === "open") && (
                      <SuggestionActions
                        suggestionId={suggestion.id}
                        onAcknowledge={(id) => handleAction(id, "acknowledge")}
                        onDismiss={(id) => handleAction(id, "dismiss")}
                        onAct={(id) => handleAction(id, "act")}
                        loading={actionLoading}
                      />
                    )}
                  </div>

                  {isExpanded && (
                    <div className="pl-7 pt-3 border-t space-y-4">
                      {ctx && <CallContextCard ctx={ctx} />}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Why This Matters</div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.reason || suggestion.summary}</p>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Confidence</div>
                          <ConfidenceBar confidence={suggestion.confidence} />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        {(suggestion.related_lead_id || ctx?.zoho_lead_id) && (
                          <span className="flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> Lead: {suggestion.related_lead_id || ctx?.zoho_lead_id}
                          </span>
                        )}
                        {suggestion.related_rep_id && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> Rep: {ctx?.rep_name || suggestion.related_rep_id}
                          </span>
                        )}
                        {suggestion.related_call_id && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" /> Call: {suggestion.related_call_id}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {data && (
        <div className="text-xs text-muted-foreground text-center pt-2">
          Showing {suggestions.length} of {data.total} suggestions
        </div>
      )}
    </div>
  );
}

export default function OpsSuggestions() {
  return <OpsRoleGuard><OpsSuggestionsContent /></OpsRoleGuard>;
}
