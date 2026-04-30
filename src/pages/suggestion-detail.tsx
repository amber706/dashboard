import { useParams, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  ArrowLeft, Phone, Clock, MapPin,
  AlertTriangle, Shield, Eye, UserPlus, PhoneForwarded, GitBranch,
  CheckCircle2, Info, FileText, XCircle,
  Target, User, Headphones, BarChart3, MessageSquare,
  TrendingUp, TrendingDown, Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkflow } from "@/lib/workflow-context";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";
import { getSuggestionTypeLabel, type SuggestionType, type Priority, type Suggestion } from "@/lib/types";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  assign_lead: <UserPlus className="w-4 h-4" />,
  schedule_callback: <PhoneForwarded className="w-4 h-4" />,
  preserve_owner: <Shield className="w-4 h-4" />,
  review_attribution: <GitBranch className="w-4 h-4" />,
  supervisor_review: <Eye className="w-4 h-4" />,
  missed_call_callback: <Phone className="w-4 h-4" />,
  urgent_high_intent_lead: <Target className="w-4 h-4" />,
  reassign_due_to_overload: <User className="w-4 h-4" />,
  poor_call_needs_supervisor_review: <Eye className="w-4 h-4" />,
  attribution_conflict_review: <GitBranch className="w-4 h-4" />,
  new_kb_draft_ready_for_approval: <FileText className="w-4 h-4" />,
  task_overdue: <Clock className="w-4 h-4" />,
  lead_missing_required_fields: <AlertTriangle className="w-4 h-4" />,
  low_quality_or_wrong_fit_lead: <TrendingDown className="w-4 h-4" />,
};

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  medium: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  low: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
};

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatCallTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function ScoreBadge({ score, label }: { score: number | null | undefined; label: string }) {
  if (score == null) return null;
  const pct = Math.round(score);
  const color = pct >= 80 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : pct >= 60 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : "text-red-400 bg-red-500/10 border-red-500/20";
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${color}`}>
      <Star className="w-3 h-3" />
      {label}: {pct}%
    </div>
  );
}

function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    A: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    B: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    C: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    D: "text-red-400 bg-red-500/10 border-red-500/20",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${colors[tier] || colors.D}`}>
      Tier {tier}
    </span>
  );
}

function InfoRow({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 py-2 ${className || ""}`}>
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">{label}</span>
        <span className="text-sm font-medium text-foreground">{value || "—"}</span>
      </div>
    </div>
  );
}

export default function SuggestionDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { setMode } = useWorkflow();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [suggestion, setSuggestion] = useState<any>(null);

  useEffect(() => {
    setMode("admin");
  }, [setMode]);

  useEffect(() => {
    async function loadSuggestion() {
      if (!params.id) return;
      try {
        const res = await apiFetch(`/ops/suggestions/${params.id}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestion(data);
        } else if (res.status === 401 || res.status === 403) {
          toast({ title: "Access denied", description: "You don't have permission to view this suggestion.", variant: "destructive" });
        } else if (res.status !== 404) {
          toast({ title: "Error loading suggestion", description: `Server returned ${res.status}`, variant: "destructive" });
        }
      } catch (err) {
        console.error("Failed to load suggestion:", err);
        toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    loadSuggestion();
  }, [params.id]);

  const handleAction = async (action: string, notes?: string) => {
    if (!suggestion) return;
    try {
      const res = await apiFetch(`/ops/suggestions/${suggestion.suggestion_id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: "admin", notes: notes || action }),
      });
      if (!res.ok) throw new Error("Action failed");
      const updated = await res.json();
      setSuggestion((prev: any) => ({ ...prev, ...updated, call_context: prev?.call_context || updated.call_context }));
      toast({ title: "Action completed", description: `Suggestion ${action}d successfully.` });
    } catch {
      toast({ title: "Action failed", description: "Could not complete the action.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-5 md:p-8 lg:p-10 max-w-[1400px] mx-auto space-y-6 md:space-y-8">
        <div className="flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded" />
          <Skeleton className="h-6 w-48 rounded" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
        <Button variant="ghost" className="gap-2 mb-4" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-muted-foreground">Suggestion not found</h3>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pStyle = PRIORITY_STYLES[suggestion.priority as Priority] ?? PRIORITY_STYLES.medium;
  const typeLabel = getSuggestionTypeLabel(suggestion.type);
  const typeIcon = TYPE_ICONS[suggestion.type] ?? <Info className="w-4 h-4" />;
  const ctx = suggestion.call_context;
  const isDone = suggestion.status === "completed" || suggestion.status === "dismissed";

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-[1400px] mx-auto space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Button>
          <div className="w-px h-6 bg-border" />
          <div className={`w-9 h-9 rounded-lg ${pStyle.bg} flex items-center justify-center`}>
            <span className={pStyle.text}>{typeIcon}</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold tracking-tight">{typeLabel}</h1>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${pStyle.text} ${pStyle.bg} ${pStyle.border}`}>
                {suggestion.priority}
              </Badge>
              {suggestion.related_call_id && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{suggestion.related_call_id}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {suggestion.suggestion_id}
              {ctx?.rep_name && ` · Rep: ${ctx.rep_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDone ? (
            <Badge className={`text-sm px-4 py-2 gap-1.5 ${suggestion.status === "completed" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}>
              {suggestion.status === "completed" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {suggestion.status === "completed" ? "Completed" : "Dismissed"}
            </Badge>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => handleAction("dismiss", "Dismissed by admin")}>
                Dismiss
              </Button>
              <Button className="gap-2" onClick={() => handleAction("complete", typeLabel)}>
                <CheckCircle2 className="w-4 h-4" />
                Mark Complete
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-primary/15">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground/90 leading-relaxed">{suggestion.title}</p>
              <p className="text-sm text-foreground/80 leading-relaxed mt-1">{suggestion.summary}</p>
              {suggestion.reasoning && (
                <p className="text-xs text-muted-foreground mt-1.5">{suggestion.reasoning}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-4">
          {ctx && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Call Evidence
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Caller" value={ctx.caller_name || "Unknown"} />
                  <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={ctx.caller_phone} />
                  <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Location" value={[ctx.caller_city, ctx.caller_state].filter(Boolean).join(", ") || "—"} />
                  <InfoRow icon={<Clock className="w-3.5 h-3.5" />} label="Call Time" value={formatCallTime(ctx.call_time)} />
                  <InfoRow icon={<Headphones className="w-3.5 h-3.5" />} label="Handled By" value={ctx.rep_name || "—"} />
                  <InfoRow
                    icon={<BarChart3 className="w-3.5 h-3.5" />}
                    label="Duration"
                    value={
                      <span>
                        {formatDuration(ctx.duration_seconds)} total
                        {ctx.talk_seconds != null && <span className="text-muted-foreground"> · {formatDuration(ctx.talk_seconds)} talk</span>}
                      </span>
                    }
                  />
                  <InfoRow
                    icon={<PhoneForwarded className="w-3.5 h-3.5" />}
                    label="Direction / Status"
                    value={
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] capitalize">{ctx.direction}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{ctx.call_status}</Badge>
                      </span>
                    }
                  />
                  {ctx.tracking_label && (
                    <InfoRow icon={<Target className="w-3.5 h-3.5" />} label="Source / Tracking" value={ctx.tracking_label} />
                  )}
                  {ctx.disposition && (
                    <InfoRow icon={<FileText className="w-3.5 h-3.5" />} label="Disposition" value={ctx.disposition} />
                  )}
                </div>

                <div className="border-t pt-3 flex flex-wrap gap-2">
                  {ctx.lead_score != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Lead Score:</span>
                      <span className={`text-sm font-bold ${ctx.lead_score >= 70 ? "text-emerald-400" : ctx.lead_score >= 40 ? "text-amber-400" : "text-red-400"}`}>
                        {ctx.lead_score}
                      </span>
                      <TierBadge tier={ctx.lead_quality_tier} />
                    </div>
                  )}
                  {ctx.call_score != null && (
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Call Score:</span>
                      <span className={`text-sm font-bold ${ctx.call_score >= 80 ? "text-emerald-400" : ctx.call_score >= 60 ? "text-amber-400" : "text-red-400"}`}>
                        {ctx.call_score}
                      </span>
                    </div>
                  )}
                </div>

                {ctx.call_score_breakdown && Object.keys(ctx.call_score_breakdown).length > 0 && (
                  <div className="border-t pt-3">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-2">Call Score Breakdown</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(ctx.call_score_breakdown).map(([key, val]) => (
                        <div key={key} className="p-2 rounded-md bg-muted/30 border border-border/50">
                          <span className="text-[10px] text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                          <div className="text-sm font-medium">{val as string}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {ctx && (ctx.qa_overall_score != null || ctx.qa_passed != null) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" />
                  QA Grade
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ScoreBadge score={ctx.qa_overall_score} label="Overall" />
                  <ScoreBadge score={ctx.qa_script_adherence} label="Script" />
                  <ScoreBadge score={ctx.qa_objection_handling} label="Objection" />
                  {ctx.qa_passed != null && (
                    <Badge className={ctx.qa_passed ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}>
                      {ctx.qa_passed ? "Passed" : "Failed"}
                    </Badge>
                  )}
                  {ctx.qa_auto_fail && (
                    <Badge className="bg-red-500/10 text-red-400 border-red-500/20 gap-1">
                      <XCircle className="w-3 h-3" />
                      Auto-Fail
                    </Badge>
                  )}
                </div>

                {ctx.qa_auto_fail_reasons && ctx.qa_auto_fail_reasons.length > 0 && (
                  <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                    <span className="text-[10px] text-red-400 uppercase tracking-wider block mb-1">Auto-Fail Reasons</span>
                    <ul className="text-xs text-red-300 space-y-0.5">
                      {ctx.qa_auto_fail_reasons.map((reason: string, i: number) => (
                        <li key={i}>• {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {ctx.qa_coaching_suggestions && ctx.qa_coaching_suggestions.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <span className="text-[10px] text-amber-400 uppercase tracking-wider block mb-1">Coaching Suggestions</span>
                    <ul className="text-xs text-amber-300 space-y-0.5">
                      {ctx.qa_coaching_suggestions.map((tip: string, i: number) => (
                        <li key={i}>• {typeof tip === "string" ? tip : JSON.stringify(tip)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {ctx?.transcript_excerpt && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  Transcript Excerpt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50 max-h-48 overflow-y-auto">
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{ctx.transcript_excerpt}</pre>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Suggestion Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {suggestion.recommended_action && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Recommended Action</span>
                  <p className="text-sm font-medium text-foreground mt-1">{suggestion.recommended_action}</p>
                </div>
              )}
              {suggestion.source_signals_json && suggestion.source_signals_json.length > 0 && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Source Signals</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestion.source_signals_json.map((signal: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        {Object.entries(signal).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px] capitalize gap-1">
                            {k.replace(/_/g, " ")}: {String(v)}
                          </Badge>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence</span>
                  <p className="text-sm font-medium text-foreground mt-1">{Math.round(suggestion.confidence * 100)}%</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</span>
                  <p className="text-sm font-medium text-foreground mt-1 capitalize">{suggestion.status}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="w-full lg:w-72 shrink-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "Suggestion ID", value: suggestion.suggestion_id },
                  { label: "Type", value: typeLabel },
                  { label: "Priority", value: suggestion.priority },
                  { label: "Related Call", value: suggestion.related_call_id ?? "—" },
                  { label: "Related Lead", value: ctx?.zoho_lead_id || suggestion.related_lead_id || "—" },
                  { label: "Handled By", value: ctx?.rep_name || suggestion.related_rep_id || "—" },
                  { label: "Created", value: suggestion.created_at ? new Date(suggestion.created_at).toLocaleString() : "—" },
                  ...(suggestion.completed_at ? [{ label: "Completed", value: new Date(suggestion.completed_at).toLocaleString() }] : []),
                  ...(suggestion.dismissed_at ? [{ label: "Dismissed", value: new Date(suggestion.dismissed_at).toLocaleString() }] : []),
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</span>
                      <div className="text-xs font-medium text-foreground break-all">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {ctx?.recording_url && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-primary" />
                  Recording
                </CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={ctx.recording_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1.5"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  Listen to recording
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
