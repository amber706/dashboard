import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { StatCard } from "@/components/ops/stat-card";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { useToast } from "@/hooks/use-toast";
import {
  useFlaggedReviews,
  useFlaggedReviewStats,
  signoffFlaggedReview,
  type FlaggedReview,
} from "@/hooks/use-ops-api";
import {
  RefreshCw, AlertTriangle, ShieldAlert, ShieldCheck,
  Phone, ChevronDown, ChevronRight, Volume2,
  FileText, Eye, Loader2, CheckCircle2,
  GraduationCap, Flag, MapPin, BarChart3, Heart, MessageSquare,
  Clock, Search, AlertCircle, ArrowUpRight, Brain, Scale, Megaphone,
  Headphones, FileAudio,
} from "lucide-react";

const CONCERN_LABELS: Record<string, string> = {
  poor_greeting: "Poor Greeting / Opening",
  missed_reason_discovery: "Missed Reason-for-Call Discovery",
  weak_empathy: "Weak Empathy / Rapport",
  poor_objection_handling: "Poor Objection Handling",
  weak_close: "Weak Close / Next-Step Explanation",
  missing_insurance_steps: "Missing Insurance or Qualification Steps",
  incomplete_documentation: "Incomplete Zoho Documentation",
  compliance_concern: "Compliance Concern",
  customer_frustration: "Customer Frustration / Negative Sentiment",
  customer_confusion: "Customer Confusion Not Resolved",
  tone_mismatch: "Tone Mismatch",
  escalation_concern: "Escalation Concern",
  script_deviation: "Script Deviation",
  missing_follow_up: "Missing Follow-Up Scheduling",
};

function severityColor(severity: string) {
  switch (severity) {
    case "critical": return "bg-red-600/20 text-red-400 border-red-600/30";
    case "high": return "bg-orange-600/20 text-orange-400 border-orange-600/30";
    case "medium": return "bg-amber-600/20 text-amber-400 border-amber-600/30";
    default: return "bg-slate-600/20 text-slate-400 border-slate-600/30";
  }
}

function priorityBadge(priority: string) {
  const styles: Record<string, string> = {
    high: "bg-red-600/20 text-red-400 border-red-600/30",
    medium: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    low: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  };
  return <Badge className={`${styles[priority] || styles.low} text-[10px]`}>{priority}</Badge>;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    signed_off: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30",
    coaching_scheduled: "bg-violet-600/20 text-violet-400 border-violet-600/30",
    compliance_review: "bg-red-600/20 text-red-400 border-red-600/30",
    follow_up_required: "bg-blue-600/20 text-blue-400 border-blue-600/30",
    score_correction: "bg-orange-600/20 text-orange-400 border-orange-600/30",
    escalated: "bg-red-600/20 text-red-400 border-red-600/30",
  };
  return <Badge className={`${styles[status] || styles.pending} text-[10px]`}>{status.replace(/_/g, " ")}</Badge>;
}

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-xs font-mono font-medium ${pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400"}`}>{score.toFixed(0)}%</span>
      </div>
      <div className="bg-accent/30 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AudioPlayer({ ctmCallId }: { ctmCallId: string }) {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const proxyUrl = `${baseUrl}api/ops/recording-proxy/${ctmCallId}`;
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="p-2.5 rounded-md bg-muted/20 border border-border/30 text-[11px] text-muted-foreground flex items-center gap-2">
        <Volume2 className="w-3.5 h-3.5" />
        Recording unavailable — may require CTM authentication
      </div>
    );
  }

  return (
    <audio
      controls
      preload="none"
      className="w-full h-10 rounded-md"
      src={proxyUrl}
      onError={() => setError(true)}
    />
  );
}

function TranscriptViewer({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n").filter((l) => l.trim());
  const preview = lines.slice(0, 6);
  const hasMore = lines.length > 6;

  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5 text-emerald-400" /> Call Transcript
      </div>
      <div className="p-3 rounded-lg bg-muted/20 border border-border/30 space-y-1.5 max-h-[400px] overflow-y-auto">
        {(expanded ? lines : preview).map((line, i) => {
          const speakerMatch = line.match(/^(Agent|Caller|Speaker\s*\d*|Rep|Customer)\s*[:\-]\s*/i);
          if (speakerMatch) {
            const speaker = speakerMatch[1];
            const content = line.slice(speakerMatch[0].length);
            const isAgent = /agent|rep/i.test(speaker);
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`text-[10px] font-semibold shrink-0 w-14 pt-0.5 ${isAgent ? "text-sky-400" : "text-amber-400"}`}>
                  {speaker}
                </span>
                <p className="text-[11px] text-foreground/80 leading-relaxed">{content}</p>
              </div>
            );
          }
          return (
            <p key={i} className="text-[11px] text-foreground/80 leading-relaxed">{line}</p>
          );
        })}
        {hasMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[11px] text-sky-400 hover:text-sky-300 mt-1"
          >
            Show full transcript ({lines.length} lines)
          </button>
        )}
        {hasMore && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-[11px] text-sky-400 hover:text-sky-300 mt-1"
          >
            Collapse transcript
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review, onSignoff }: { review: FlaggedReview; onSignoff: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [coachingTopic, setCoachingTopic] = useState("");
  const [recordingOpen, setRecordingOpen] = useState(false);
  const { toast } = useToast();

  const handleSignoff = async (action: string) => {
    setActionLoading(action);
    try {
      const res = await signoffFlaggedReview(review.id, action, notes || undefined, coachingTopic || undefined);
      if (res.ok) {
        toast({ title: "Review updated", description: `Action: ${action.replace(/_/g, " ")}` });
        onSignoff();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Action failed", description: err.detail || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Action failed", description: "Network error", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const qa = review.qa_breakdown || {};
  const categoryScores = qa.category_scores || {};

  return (
    <Card className="overflow-hidden border-border/50">
      <CardContent className="p-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/5 transition-colors"
        >
          <div className="shrink-0">{priorityBadge(review.review_priority)}</div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{review.rep_name || review.rep_id || "Specialist not linked"}</span>
              <Badge variant="outline" className="text-[10px] font-mono">call {review.ctm_call_id}</Badge>
              {statusBadge(review.status)}
              {review.poor_sentiment_flag && (
                <Badge className="bg-red-600/10 text-red-400 border-red-600/20 text-[9px] gap-0.5">
                  <Heart className="w-2.5 h-2.5" /> poor sentiment
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
              <span>QA <span className={`font-semibold ${review.qa_score_percent != null ? (review.qa_score_percent >= 80 ? "text-emerald-500" : review.qa_score_percent >= 60 ? "text-amber-500" : "text-red-500") : ""}`}>{review.qa_score_percent != null ? `${review.qa_score_percent.toFixed(0)}/100` : "—"}</span></span>
              <span>·</span>
              <span>{review.concerns.length} concern{review.concerns.length !== 1 ? "s" : ""}</span>
              {/* Show top 2 concerns inline so the row tells you *what's* wrong without expanding */}
              {review.concerns.slice(0, 2).map((c, i) => (
                <Badge key={i} variant="outline" className={`${severityColor(c.severity)} text-[9px] py-0`}>
                  {CONCERN_LABELS[c.concern_type] ?? c.concern_type.replace(/_/g, " ")}
                </Badge>
              ))}
              {review.concerns.length > 2 && (
                <span className="text-[10px]">+{review.concerns.length - 2} more</span>
              )}
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {review.created_at ? new Date(review.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
          </span>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
        </button>

        {expanded && (
          <div className="border-t border-border/30">
            <div className="p-4 space-y-5">

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Concerns ({review.concerns.length})
                    </div>
                    <div className="space-y-2">
                      {review.concerns.map((concern, i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/20 border border-border/30 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Badge className={`${severityColor(concern.severity)} text-[9px]`}>{concern.severity}</Badge>
                            <span className="text-xs font-medium">{CONCERN_LABELS[concern.concern_type] || concern.concern_type.replace(/_/g, " ")}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{concern.explanation}</p>
                          {concern.supporting_evidence && (
                            <p className="text-[10px] text-muted-foreground/70">{concern.supporting_evidence}</p>
                          )}
                        </div>
                      ))}
                      {review.concerns.length === 0 && (
                        <p className="text-xs text-muted-foreground">No specific concerns identified</p>
                      )}
                    </div>
                  </div>

                  {review.issue_locations.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-blue-400" /> Where to Check in the Call
                      </div>
                      <div className="space-y-1.5">
                        {review.issue_locations.map((loc, i) => (
                          <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-blue-950/40 border border-blue-700/40">
                            <Search className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[11px] text-blue-200">{loc.guidance}</p>
                              {loc.matches && loc.matches.length > 0 && (
                                <div className="mt-1.5 space-y-1">
                                  {loc.matches.map((match, j) => (
                                    <div key={j} className="text-[10px] text-blue-200/70 p-1.5 bg-blue-950/30 rounded">
                                      <span className="font-mono text-blue-400">{match.timestamp}</span>
                                      <span className="mx-1.5 text-border">|</span>
                                      <span className="capitalize">{match.speaker}</span>
                                      <span className="mx-1.5 text-border">|</span>
                                      <span className="">"{match.snippet.slice(0, 120)}{match.snippet.length > 120 ? "..." : ""}"</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-violet-400" /> QA Score Breakdown
                    </div>
                    <div className="p-3 rounded-lg bg-muted/20 border border-border/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Overall QA Score</span>
                        <span className={`text-lg font-bold ${(qa.overall_score || 0) >= 80 ? "text-emerald-400" : (qa.overall_score || 0) >= 60 ? "text-amber-400" : "text-red-400"}`}>
                          {qa.overall_score?.toFixed(0) || "—"}%
                        </span>
                      </div>
                      {qa.auto_fail && (
                        <div className="flex items-center gap-1.5 text-red-400 text-[11px]">
                          <AlertCircle className="w-3.5 h-3.5" /> Auto-fail triggered
                          {(qa.auto_fail_reasons || []).length > 0 && (
                            <span className="text-muted-foreground">— {(qa.auto_fail_reasons || []).join(", ")}</span>
                          )}
                        </div>
                      )}
                      <div className="border-t border-border/20 pt-2 space-y-2">
                        {Object.entries(categoryScores).map(([cat, score]) => (
                          <ScoreBar key={cat} label={cat.replace(/_/g, " ")} score={typeof score === "number" ? score : 0} />
                        ))}
                        {qa.script_adherence_score != null && <ScoreBar label="Script Adherence" score={qa.script_adherence_score} />}
                        {qa.objection_handling_score != null && <ScoreBar label="Objection Handling" score={qa.objection_handling_score} />}
                        {qa.zoho_completeness_score != null && <ScoreBar label="Documentation" score={qa.zoho_completeness_score} />}
                      </div>
                    </div>
                  </div>

                  {review.poor_sentiment_flag && review.sentiment_markers.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Heart className="w-3.5 h-3.5 text-red-400" /> Sentiment Issues
                      </div>
                      <div className="space-y-1.5">
                        {review.sentiment_markers.slice(0, 5).map((marker, i) => (
                          <div key={i} className="p-2.5 rounded-md bg-red-950/40 border border-red-700/40 text-[11px]">
                            <span className="font-medium text-red-200 capitalize">{marker.indicator || marker.type.replace(/_/g, " ")}</span>
                            {marker.context_snippet && (
                              <p className="text-red-300/70 mt-0.5">"{marker.context_snippet.slice(0, 150)}{marker.context_snippet.length > 150 ? "..." : ""}"</p>
                            )}
                            {marker.detail && !marker.context_snippet && (
                              <p className="text-red-300/70 mt-0.5">{marker.detail}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {review.coaching_recommendations.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <GraduationCap className="w-3.5 h-3.5 text-violet-400" /> Coaching Recommendations
                      </div>
                      <div className="space-y-1.5">
                        {review.coaching_recommendations.map((rec, i) => (
                          <div key={i} className="p-2.5 rounded-md bg-violet-950/40 border border-violet-700/40">
                            <p className="text-[11px] text-violet-200 leading-relaxed">{rec.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-border/30 pt-3">
                <button
                  onClick={() => setRecordingOpen(!recordingOpen)}
                  className="w-full flex items-center gap-2 text-left hover:bg-accent/5 transition-colors rounded-md p-2 -m-2"
                >
                  <Headphones className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Call Recording & Transcript</span>
                  <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ml-auto ${recordingOpen ? "rotate-90" : ""}`} />
                </button>

                {recordingOpen && (
                  <div className="mt-3 space-y-4">
                    {!review.recording_url && !review.transcript_text ? (
                      <div className="p-4 rounded-lg bg-muted/10 border border-border/20 text-center">
                        <FileAudio className="w-5 h-5 text-muted-foreground/50 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground/60">Recording and transcript not yet available</p>
                      </div>
                    ) : (
                      <>
                        {review.recording_url && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <Volume2 className="w-3.5 h-3.5 text-sky-400" /> Call Recording
                            </div>
                            <AudioPlayer ctmCallId={review.ctm_call_id} />
                          </div>
                        )}

                        {review.transcript_text && (
                          <TranscriptViewer text={review.transcript_text} />
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {review.status === "pending" && (
                <div className="border-t border-border/30 pt-4 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5" /> Supervisor Actions
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Review Notes</label>
                      <Input
                        placeholder="Add notes about this review..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Coaching Topic (optional)</label>
                      <Input
                        placeholder="e.g., Objection handling, Empathy"
                        value={coachingTopic}
                        onChange={(e) => setCoachingTopic(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/10 gap-1"
                      onClick={() => handleSignoff("approve")}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "approve" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Approve / Sign Off
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-violet-400 border-violet-600/30 hover:bg-violet-600/10 gap-1"
                      onClick={() => handleSignoff("coaching_required")}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "coaching_required" ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                      Coaching Required
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-400 border-red-600/30 hover:bg-red-600/10 gap-1"
                      onClick={() => handleSignoff("compliance_concern")}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "compliance_concern" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flag className="w-3 h-3" />}
                      Compliance Concern
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-blue-400 border-blue-600/30 hover:bg-blue-600/10 gap-1"
                      onClick={() => handleSignoff("rep_follow_up_required")}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "rep_follow_up_required" ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                      Rep Follow-Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-orange-400 border-orange-600/30 hover:bg-orange-600/10 gap-1"
                      onClick={() => handleSignoff("score_correction_required")}
                      disabled={!!actionLoading}
                    >
                      Score Correction
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-400 border-red-600/30 hover:bg-red-600/10 gap-1"
                      onClick={() => handleSignoff("escalate")}
                      disabled={!!actionLoading}
                    >
                      {actionLoading === "escalate" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                      Escalate
                    </Button>
                  </div>
                </div>
              )}

              {review.status !== "pending" && review.supervisor_notes && (
                <div className="border-t border-border/30 pt-3">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Supervisor Notes</div>
                  <p className="text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-md">{review.supervisor_notes}</p>
                  {review.supervisor_signoff_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Signed off {new Date(review.supervisor_signoff_at).toLocaleString()} — Action: {review.supervisor_action?.replace(/_/g, " ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpsSupervisorReviewContent() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const { data, loading, error, refetch } = useFlaggedReviews({ interval: 30000, status: statusFilter });
  const { data: stats } = useFlaggedReviewStats({ interval: 30000 });

  const items = data?.items || [];

  return (
    <PageShell
      eyebrow="QUALITY"
      title="Supervisor review"
      subtitle="Calls flagged by QA scoring or compliance triggers. Listen, sign off, or schedule coaching."
      maxWidth={1400}
      actions={
        <Button variant="outline" size="sm" onClick={refetch} className="gap-1.5 h-9">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        <StatCard
          label="Pending Reviews"
          value={stats?.pending ?? 0}
          icon={<Eye className="w-4 h-4 text-amber-400" />}
          changeType={(stats?.pending ?? 0) > 5 ? "negative" : "neutral"}
          loading={!stats}
          onClick={() => setStatusFilter("pending")}
        />
        <StatCard
          label="High Priority"
          value={stats?.high_priority ?? 0}
          icon={<ShieldAlert className="w-4 h-4 text-red-400" />}
          changeType={(stats?.high_priority ?? 0) > 0 ? "negative" : "neutral"}
          loading={!stats}
        />
        <StatCard
          label="Coaching Scheduled"
          value={stats?.coaching_scheduled ?? 0}
          icon={<GraduationCap className="w-4 h-4 text-violet-400" />}
          loading={!stats}
          onClick={() => setStatusFilter("coaching_scheduled")}
        />
        <StatCard
          label="Compliance Flags"
          value={stats?.compliance_flags ?? 0}
          icon={<Flag className="w-4 h-4 text-orange-400" />}
          changeType={(stats?.compliance_flags ?? 0) > 0 ? "negative" : "neutral"}
          loading={!stats}
          onClick={() => setStatusFilter("compliance_review")}
        />
        <StatCard
          label="Signed Off Today"
          value={stats?.signed_off_today ?? 0}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          loading={!stats}
          onClick={() => setStatusFilter("signed_off")}
        />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {["pending", "all", "signed_off", "coaching_scheduled", "compliance_review", "escalated"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs shrink-0 whitespace-nowrap"
            onClick={() => setStatusFilter(s)}
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : error && !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load flagged reviews.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-lg font-medium">All Clear</p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusFilter === "pending" ? "No calls currently flagged for supervisor review" : `No reviews with status "${statusFilter.replace(/_/g, " ")}"`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ReviewCard key={item.id} review={item} onSignoff={refetch} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default function OpsSupervisorReview() {
  return <OpsRoleGuard><OpsSupervisorReviewContent /></OpsRoleGuard>;
}
