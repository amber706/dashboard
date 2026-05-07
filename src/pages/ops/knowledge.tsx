import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { StatCard } from "@/components/ops/stat-card";
import { ConfidenceIndicator } from "@/components/ops/confidence-indicator";
import { StatusBadge } from "@/components/ops/priority-badge";
import { OpsRoleGuard } from "@/components/ops/role-guard";
import { useToast } from "@/hooks/use-toast";
import {
  useKnowledgeItems, resolveKnowledgeItem, generateKnowledgeProposals,
  type KnowledgeItem, type AnswerProposal,
} from "@/hooks/use-ops-api";
import {
  RefreshCw, AlertTriangle, BookOpen, CheckCircle2,
  XCircle, FileText, ChevronDown, ChevronRight,
  HelpCircle, MessageSquare, Loader2, Edit, TrendingUp, Sparkles,
} from "lucide-react";

function typeIcon(type: string) {
  switch (type) {
    case "unanswered_question": return <HelpCircle className="w-4 h-4 text-blue-400" />;
    case "recurring_objection": return <MessageSquare className="w-4 h-4 text-orange-400" />;
    case "draft_article": return <FileText className="w-4 h-4 text-violet-400" />;
    default: return <BookOpen className="w-4 h-4 text-slate-400" />;
  }
}

function typeLabel(type: string) {
  switch (type) {
    case "unanswered_question": return "Unanswered Question";
    case "recurring_objection": return "Recurring Objection";
    case "draft_article": return "Draft Article";
    default: return type.replace(/_/g, " ");
  }
}

function ConfBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let level = "Low";
  let cls = "bg-red-100 text-red-700";
  if (confidence >= 0.7) { level = "High"; cls = "bg-emerald-100 text-emerald-700"; }
  else if (confidence >= 0.4) { level = "Medium"; cls = "bg-amber-100 text-amber-700"; }
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>{level} ({pct}%)</span>;
}

function ProposalSection({
  title, answer, borderColor, sourceType, onApprove, loading,
}: {
  title: string;
  answer: AnswerProposal | null;
  borderColor: string;
  sourceType: "kb" | "transcript" | "merged";
  onApprove: (action: "approve-kb" | "approve-transcript" | "approve-merged") => void;
  loading: boolean;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  if (!answer || answer.status === "insufficient_data") {
    return (
      <div className="bg-muted/10 border border-border rounded-md p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Insufficient Data</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Not enough data available.</p>
      </div>
    );
  }

  return (
    <div className={`bg-card border border-border rounded-md p-3 border-l-4 ${borderColor}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-1.5">
          <ConfBadge confidence={answer.confidence} />
          <Button
            size="sm"
            variant="outline"
            className="h-5 text-[10px] text-emerald-500 border-emerald-600/30 hover:bg-emerald-600/10 px-1.5 gap-0.5"
            onClick={() => {
              const actionMap = { kb: "approve-kb", transcript: "approve-transcript", merged: "approve-merged" } as const;
              onApprove(actionMap[sourceType]);
            }}
            disabled={loading}
          >
            <CheckCircle2 className="w-2.5 h-2.5" /> Approve
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed bg-muted/20 rounded p-2.5 whitespace-pre-wrap">{answer.text}</div>

      {answer.next_best_question && (
        <div className="mt-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground">Next Best Question:</span>
          <p className="text-[11px] text-foreground mt-0.5">{answer.next_best_question}</p>
        </div>
      )}

      {answer.caution_notes && (
        <div className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600 bg-amber-50 rounded p-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{answer.caution_notes}</span>
        </div>
      )}

      {((answer.source_titles && answer.source_titles.length > 0) || (answer.examples && answer.examples.length > 0)) && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            {showEvidence ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            Sources & Examples
          </button>
          {showEvidence && (
            <div className="mt-1.5 space-y-1.5">
              {answer.source_titles && answer.source_titles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {answer.source_titles.map((t, i) => (
                    <span key={i} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-200">{t}</span>
                  ))}
                </div>
              )}
              {answer.examples && answer.examples.map((ex, i) => (
                <div key={i} className="bg-muted/20 rounded p-1.5 text-[11px]">
                  {ex.caller && <p><span className="font-medium text-muted-foreground">Caller:</span> {ex.caller}</p>}
                  {ex.rep && <p className="mt-0.5"><span className="font-medium text-muted-foreground">Rep:</span> {ex.rep}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpsKnowledgeContent() {
  const { data, loading, error, refetch } = useKnowledgeItems({ interval: 60000 });
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  const { toast } = useToast();

  const handleResolve = async (id: number, action: "approve" | "edit" | "reject" | "approve-kb" | "approve-transcript" | "approve-merged") => {
    setActionLoading(id);
    try {
      await resolveKnowledgeItem(id, action);
      refetch();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "Could not complete the action.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateProposals = async (id: number) => {
    setGeneratingId(id);
    try {
      await generateKnowledgeProposals(id);
      toast({ title: "Answer proposals generated" });
      refetch();
    } catch (err) {
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Could not generate proposals.", variant: "destructive" });
    } finally {
      setGeneratingId(null);
    }
  };

  const items = data?.items || [];

  const autoGenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data || items.length === 0) return;
    const needsProposals = items.filter(
      (item) => item.draft_article && !item.answer_proposals?.generation_attempted && !autoGenRef.current.has(item.id)
    );
    if (needsProposals.length === 0) return;

    for (const item of needsProposals.slice(0, 5)) {
      autoGenRef.current.add(item.id);
      generateKnowledgeProposals(item.id)
        .then(() => { autoGenRef.current.delete(item.id); })
        .catch(() => { autoGenRef.current.delete(item.id); });
    }

    const timer = setTimeout(() => refetch(), 5000);
    return () => clearTimeout(timer);
  }, [data]);

  const questions = items.filter((i) => i.type === "unanswered_question");
  const objections = items.filter((i) => i.type === "recurring_objection");
  const drafts = items.filter((i) => i.draft_article);
  const pendingApproval = items.filter((i) => i.status === "pending" && i.draft_article);

  return (
    <div className="p-5 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6 md:space-y-8">
      <PageHeader
        title="Knowledge Review"
        subtitle="Recurring questions, objections, and AI-drafted knowledge base articles with answer proposals"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Unanswered Questions"
          value={questions.length}
          icon={<HelpCircle className="w-4 h-4 text-blue-400" />}
          loading={loading && !data}
          info="Questions specialists couldn't fully answer on calls — surfaced from transcripts where the AI detected hesitation or 'I'll have to check on that'. The KB-drafting workflow turns these into new articles."
        />
        <StatCard
          label="Recurring Objections"
          value={objections.length}
          icon={<MessageSquare className="w-4 h-4 text-orange-400" />}
          loading={loading && !data}
          info="Objection patterns the model has clustered across multiple calls — caller hesitations like 'I want to think about it', 'It's too expensive', insurance concerns. Each cluster has a count + sample quotes."
        />
        <StatCard
          label="Draft Articles"
          value={drafts.length}
          icon={<FileText className="w-4 h-4 text-violet-400" />}
          loading={loading && !data}
          info="KB articles auto-drafted by the model from transcripts and questions, awaiting human review. Each carries a confidence score and a citation list back to the source calls."
        />
        <StatCard
          label="Pending Approval"
          value={pendingApproval.length}
          icon={<CheckCircle2 className="w-4 h-4 text-amber-400" />}
          changeType={pendingApproval.length > 5 ? "negative" : "neutral"}
          loading={loading && !data}
          info="Drafts that have been edited and submitted for final approval but not yet merged into the live KB. Card turns red when > 5 — that's the threshold to push approvals through so the floor isn't running on outdated info."
        />
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
        </div>
      ) : error && !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Unable to load knowledge data. The operations API may not be configured yet.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-lg font-medium">No Knowledge Items</p>
            <p className="text-sm text-muted-foreground mt-1">Knowledge gaps and draft articles will appear here as the system processes calls</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item: KnowledgeItem) => (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      className="shrink-0"
                    >
                      {expandedId === item.id ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                    {typeIcon(item.type)}
                    <span className="text-sm font-medium">{item.title}</span>
                    <Badge variant="outline" className="text-[10px]">{typeLabel(item.type)}</Badge>
                    <StatusBadge status={item.status} />
                    {item.answer_proposals?.generation_attempted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5" /> Proposals
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> {item.frequency}x seen
                    </span>
                  </div>
                </div>

                <div className="pl-7 flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span>Last seen: {item.last_seen ? new Date(item.last_seen).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</span>
                  {item.draft_article && (
                    <ConfidenceIndicator confidence={item.draft_article.confidence} showPercent />
                  )}
                </div>

                {expandedId === item.id && (
                  <div className="pl-7 pt-3 border-t space-y-3">
                    {item.draft_article && (
                      <div>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Draft Article: {item.draft_article.title}
                        </div>
                        <div className="text-xs text-muted-foreground leading-relaxed bg-muted/20 rounded-md p-4 whitespace-pre-wrap">
                          {item.draft_article.content}
                        </div>
                      </div>
                    )}

                    {item.answer_proposals?.generation_attempted ? (
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Answer Proposals
                        </div>
                        <ProposalSection
                          title="Approved KB Answer"
                          answer={item.answer_proposals.kb_answer}
                          borderColor="border-l-blue-400"
                          sourceType="kb"
                          onApprove={(a) => handleResolve(item.id, a)}
                          loading={actionLoading === item.id}
                        />
                        <ProposalSection
                          title="Transcript-Informed Answer"
                          answer={item.answer_proposals.transcript_answer}
                          borderColor="border-l-purple-400"
                          sourceType="transcript"
                          onApprove={(a) => handleResolve(item.id, a)}
                          loading={actionLoading === item.id}
                        />
                        <ProposalSection
                          title="Recommended Final Draft"
                          answer={item.answer_proposals.merged_answer}
                          borderColor="border-l-emerald-400"
                          sourceType="merged"
                          onApprove={(a) => handleResolve(item.id, a)}
                          loading={actionLoading === item.id}
                        />
                      </div>
                    ) : item.draft_article ? (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleGenerateProposals(item.id)}
                          disabled={generatingId === item.id}
                        >
                          {generatingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          Generate Possible Answers
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}

                {item.status === "pending" && item.draft_article && (
                  <div className="pl-7 pt-2 border-t">
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/10 gap-1"
                        onClick={() => handleResolve(item.id, "approve")}
                        disabled={actionLoading === item.id}
                      >
                        {actionLoading === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-blue-400 border-blue-600/30 hover:bg-blue-600/10 gap-1"
                        onClick={() => handleResolve(item.id, "edit")}
                        disabled={actionLoading === item.id}
                      >
                        <Edit className="w-3 h-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-red-400 border-red-600/30 hover:bg-red-600/10 gap-1"
                        onClick={() => handleResolve(item.id, "reject")}
                        disabled={actionLoading === item.id}
                      >
                        <XCircle className="w-3 h-3" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsKnowledge() {
  return <OpsRoleGuard><OpsKnowledgeContent /></OpsRoleGuard>;
}
