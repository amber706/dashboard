import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import {
  BookOpen, CheckCircle, XCircle, AlertTriangle, Clock,
  ChevronDown, ChevronRight, FileText, Merge, Eye,
  RefreshCw, Send, BarChart3, Filter, Search
} from "lucide-react";

interface AnswerProposal {
  text: string | null;
  confidence: number;
  status: string;
  source_ids?: number[];
  source_titles?: string[];
  examples?: { caller: string; rep: string; call_id: string }[];
  pattern_summary?: string | null;
  next_best_question?: string | null;
  caution_notes?: string | null;
}

interface AnswerProposals {
  has_proposals: boolean;
  generation_attempted: boolean;
  kb_answer: AnswerProposal | null;
  transcript_answer: AnswerProposal | null;
  merged_answer: AnswerProposal | null;
}

interface DraftItem {
  id: number;
  title: string;
  draft_type: string;
  problem_statement: string;
  recommended_answer: string;
  approved_style_wording?: string;
  next_best_question?: string;
  caution_notes?: string;
  confidence: number;
  status: string;
  source_call_count: number;
  source_call_ids: string[];
  similar_existing: { id: number; title: string }[];
  topic_candidate_ids: number[];
  review_batch_id?: number;
  revision_history: any[];
  original_content?: any;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_at?: string;
  updated_at?: string;
  answer_proposals?: AnswerProposals;
  recent_actions: { reviewer_id: string; action: string; notes?: string; created_at?: string }[];
}

interface Analytics {
  draft_volume: { total: number; pending: number; approved: number; rejected: number; merged: number };
  approval_rate: number;
  top_recurring_gaps: { topic_type: string; count: number }[];
  transcript_derived_articles: number;
  email_batches: { total: number; sent: number };
  review_actions: Record<string, number>;
  avg_review_time_hours: number | null;
  top_unresolved_gaps: { topic_type: string; total_frequency: number }[];
}

type Tab = "inbox" | "approved" | "rejected" | "analytics";

const TYPE_COLORS: Record<string, string> = {
  faq: "bg-blue-100 text-blue-800",
  objection_handling: "bg-orange-100 text-orange-800",
  q_and_a: "bg-purple-100 text-purple-800",
  process_guidance: "bg-green-100 text-green-800",
  insurance_edge_case: "bg-red-100 text-red-800",
  escalation_guidance: "bg-yellow-100 text-yellow-800",
  training_notes: "bg-indigo-100 text-indigo-800",
  call_flow_gap: "bg-teal-100 text-teal-800",
  script_gap: "bg-pink-100 text-pink-800",
  knowledge_gap: "bg-gray-100 text-gray-800",
};

function confidenceColor(c: number) {
  if (c >= 0.7) return "text-emerald-600";
  if (c >= 0.4) return "text-amber-600";
  return "text-red-500";
}

function confidenceBg(c: number) {
  if (c >= 0.7) return "bg-emerald-100 text-emerald-800";
  if (c >= 0.4) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function statusIcon(status: string) {
  switch (status) {
    case "approved": return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    case "rejected": return <XCircle className="w-4 h-4 text-red-500" />;
    case "merged": return <Merge className="w-4 h-4 text-blue-500" />;
    case "review_ready": return <Eye className="w-4 h-4 text-amber-500" />;
    default: return <Clock className="w-4 h-4 text-slate-400" />;
  }
}

export default function KnowledgeReview() {
  const { toast } = useToast();
  const { user } = useAuth();
  const reviewerName = user?.username || "admin";
  const [tab, setTab] = useState<Tab>("inbox");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [runningReview, setRunningReview] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  const statusForTab = (t: Tab) => {
    switch (t) {
      case "inbox": return undefined;
      case "approved": return "approved";
      case "rejected": return "rejected";
      default: return undefined;
    }
  };

  async function loadItems() {
    setLoading(true);
    try {
      const status = statusForTab(tab);
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (typeFilter) params.set("draft_type", typeFilter);
      const resp = await apiFetch(`/kb-review/inbox?${params.toString()}`);
      const data = await resp.json();
      setItems(data.items || []);
      setPendingCount(data.pending_count || 0);
    } catch {
      toast({ title: "Failed to load review items", variant: "destructive" });
    }
    setLoading(false);
  }

  async function loadAnalytics() {
    try {
      const resp = await apiFetch("/kb-review/analytics");
      const data = await resp.json();
      setAnalytics(data);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (tab === "analytics") {
      loadAnalytics();
    } else {
      loadItems();
    }
  }, [tab, typeFilter]);

  const generatingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (tab !== "inbox" || items.length === 0) return;
    const needsProposals = items.filter(
      (item) =>
        !item.answer_proposals?.generation_attempted &&
        !generatingRef.current.has(item.id) &&
        !["approved", "rejected", "merged"].includes(item.status)
    );
    if (needsProposals.length === 0) return;

    for (const item of needsProposals.slice(0, 5)) {
      generatingRef.current.add(item.id);
      apiFetch(`/kb-review/draft/${item.id}/generate-proposals`, { method: "POST" })
        .then(() => {
          generatingRef.current.delete(item.id);
        })
        .catch(() => {
          generatingRef.current.delete(item.id);
        });
    }

    const timer = setTimeout(() => loadItems(), 5000);
    return () => clearTimeout(timer);
  }, [items, tab]);

  async function handleApprove(id: number) {
    setActionLoading(id);
    try {
      await apiFetch(`/kb-review/draft/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: reviewerName, notes: reviewNotes || undefined }),
      });
      toast({ title: "Draft approved and published to KB" });
      setReviewNotes("");
      loadItems();
    } catch {
      toast({ title: "Failed to approve draft", variant: "destructive" });
    }
    setActionLoading(null);
  }

  async function handleApproveVariant(id: number, sourceType: "kb" | "transcript" | "merged") {
    setActionLoading(id);
    try {
      await apiFetch(`/kb-review/draft/${id}/approve-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: reviewerName, source_type: sourceType, notes: reviewNotes || undefined }),
      });
      const labels = { kb: "KB", transcript: "Transcript", merged: "Merged" };
      toast({ title: `${labels[sourceType]} answer approved and published` });
      setReviewNotes("");
      loadItems();
    } catch {
      toast({ title: "Failed to approve variant", variant: "destructive" });
    }
    setActionLoading(null);
  }

  async function handleGenerateProposals(id: number) {
    setActionLoading(id);
    try {
      await apiFetch(`/kb-review/draft/${id}/generate-proposals`, { method: "POST" });
      toast({ title: "Answer proposals generated" });
      loadItems();
    } catch {
      toast({ title: "Failed to generate proposals", variant: "destructive" });
    }
    setActionLoading(null);
  }

  async function handleReject(id: number) {
    setActionLoading(id);
    try {
      await apiFetch(`/kb-review/draft/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejected_by: reviewerName,
          reason: rejectReason || "Rejected during review",
          notes: reviewNotes || undefined,
        }),
      });
      toast({ title: "Draft rejected" });
      setRejectReason("");
      setReviewNotes("");
      loadItems();
    } catch {
      toast({ title: "Failed to reject draft", variant: "destructive" });
    }
    setActionLoading(null);
  }

  async function handleRunReview() {
    setRunningReview(true);
    try {
      const resp = await apiFetch("/kb-review/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send_email: true }),
      });
      const data = await resp.json();
      const msg = `Found ${data.discovery?.total_gaps_found || 0} gaps, generated ${data.drafts_generated || 0} drafts`;
      toast({ title: "Review cycle complete", description: msg });
      loadItems();
    } catch {
      toast({ title: "Failed to run review cycle", variant: "destructive" });
    }
    setRunningReview(false);
  }

  const filteredItems = items.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.problem_statement || "").toLowerCase().includes(q) ||
      item.draft_type.toLowerCase().includes(q)
    );
  });

  const allTypes = [...new Set(items.map((i) => i.draft_type))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Knowledge Review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review transcript-derived KB drafts before they go live
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRunReview}
            disabled={runningReview}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {runningReview ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {runningReview ? "Running..." : "Run Review Cycle"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Pending</span>
          </div>
          <span className="text-2xl font-semibold">{pendingCount}</span>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Approved</span>
          </div>
          <span className="text-2xl font-semibold">{analytics?.draft_volume?.approved ?? "—"}</span>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Rejected</span>
          </div>
          <span className="text-2xl font-semibold">{analytics?.draft_volume?.rejected ?? "—"}</span>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Approval Rate</span>
          </div>
          <span className="text-2xl font-semibold">{analytics?.approval_rate ?? "—"}%</span>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: "inbox" as Tab, label: "Review Inbox", icon: <BookOpen className="w-4 h-4" />, count: pendingCount },
          { key: "approved" as Tab, label: "Approved", icon: <CheckCircle className="w-4 h-4" /> },
          { key: "rejected" as Tab, label: "Rejected", icon: <XCircle className="w-4 h-4" /> },
          { key: "analytics" as Tab, label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "analytics" ? (
        <AnalyticsPanel analytics={analytics} />
      ) : (
        <>
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search drafts..."
                className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">All types</option>
                {allTypes.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
            <button onClick={loadItems} className="p-2 text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading drafts...</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                {tab === "inbox" ? "No drafts pending review" : `No ${tab} drafts`}
              </p>
              {tab === "inbox" && (
                <p className="text-muted-foreground/70 text-xs mt-1">
                  Run a review cycle to scan transcripts for new KB gaps
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <DraftCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  onApprove={() => handleApprove(item.id)}
                  onApproveVariant={(sourceType) => handleApproveVariant(item.id, sourceType)}
                  onGenerateProposals={() => handleGenerateProposals(item.id)}
                  onReject={() => handleReject(item.id)}
                  actionLoading={actionLoading === item.id}
                  isInbox={tab === "inbox"}
                  rejectReason={rejectReason}
                  onRejectReasonChange={setRejectReason}
                  reviewNotes={reviewNotes}
                  onReviewNotesChange={setReviewNotes}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence, label }: { confidence: number; label?: string }) {
  const pct = Math.round(confidence * 100);
  let level = "Low";
  let cls = "bg-red-100 text-red-800";
  if (confidence >= 0.7) { level = "High"; cls = "bg-emerald-100 text-emerald-800"; }
  else if (confidence >= 0.4) { level = "Medium"; cls = "bg-amber-100 text-amber-800"; }
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>
      {label ? `${label}: ` : ""}{level} ({pct}%)
    </span>
  );
}

function AnswerPanel({
  title, answer, sourceType, isInbox, actionLoading, onApproveVariant,
}: {
  title: string;
  answer: AnswerProposal | null;
  sourceType: "kb" | "transcript" | "merged";
  isInbox: boolean;
  actionLoading: boolean;
  onApproveVariant: (t: "kb" | "transcript" | "merged") => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  if (!answer || answer.status === "insufficient_data") {
    return (
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h5>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">Insufficient Data</span>
        </div>
        <p className="text-xs text-muted-foreground">Not enough data to generate this answer type.</p>
      </div>
    );
  }

  const borderColor = sourceType === "kb" ? "border-l-blue-400" : sourceType === "transcript" ? "border-l-purple-400" : "border-l-emerald-400";

  return (
    <div className={`bg-card border border-border rounded-lg p-3 border-l-4 ${borderColor}`}>
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h5>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={answer.confidence} />
          {isInbox && answer.text && (
            <button
              onClick={() => onApproveVariant(sourceType)}
              disabled={actionLoading}
              className="text-[10px] px-2 py-0.5 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve This
            </button>
          )}
        </div>
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap bg-accent/10 rounded p-2.5">{answer.text}</div>

      {answer.next_best_question && (
        <div className="mt-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Next Best Question</span>
          <p className="text-xs text-foreground mt-0.5">{answer.next_best_question}</p>
        </div>
      )}

      {answer.caution_notes && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{answer.caution_notes}</span>
        </div>
      )}

      {((answer.source_titles && answer.source_titles.length > 0) || (answer.examples && answer.examples.length > 0)) && (
        <div className="mt-2">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            {showEvidence ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Supporting Sources / Transcript Examples
          </button>
          {showEvidence && (
            <div className="mt-2 space-y-2">
              {answer.source_titles && answer.source_titles.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground">KB Sources:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {answer.source_titles.map((t, i) => (
                      <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {answer.examples && answer.examples.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground">Transcript Excerpts:</span>
                  <div className="space-y-1.5 mt-1">
                    {answer.examples.map((ex, i) => (
                      <div key={i} className="bg-accent/10 rounded p-2 text-xs">
                        {ex.caller && <p><span className="font-medium text-muted-foreground">Caller:</span> {ex.caller}</p>}
                        {ex.rep && <p className="mt-0.5"><span className="font-medium text-muted-foreground">Rep:</span> {ex.rep}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftCard({
  item, expanded, onToggle, onApprove, onApproveVariant, onGenerateProposals, onReject, actionLoading, isInbox,
  rejectReason, onRejectReasonChange, reviewNotes, onReviewNotesChange,
}: {
  item: DraftItem;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onApproveVariant: (sourceType: "kb" | "transcript" | "merged") => void;
  onGenerateProposals: () => void;
  onReject: () => void;
  actionLoading: boolean;
  isInbox: boolean;
  rejectReason: string;
  onRejectReasonChange: (v: string) => void;
  reviewNotes: string;
  onReviewNotesChange: (v: string) => void;
}) {
  const typeLabel = item.draft_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const confidencePct = Math.round((item.confidence || 0) * 100);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        {statusIcon(item.status)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{item.title}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[item.draft_type] || "bg-gray-100 text-gray-800"}`}>
              {typeLabel}
            </span>
            <span className={`text-xs font-medium ${confidenceColor(item.confidence)}`}>
              {confidencePct}% confidence
            </span>
            <span className="text-xs text-muted-foreground">
              {item.source_call_count} call{item.source_call_count !== 1 ? "s" : ""}
            </span>
            {item.created_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {isInbox && (
          <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onApprove}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {actionLoading ? "..." : "Approve"}
            </button>
            <button
              onClick={onReject}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-red-500/10 text-red-600 rounded-lg text-xs font-medium hover:bg-red-500/20 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4 bg-accent/5">
          {item.problem_statement && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Problem Statement</h4>
              <p className="text-sm text-foreground whitespace-pre-wrap">{item.problem_statement}</p>
            </div>
          )}

          {item.answer_proposals?.generation_attempted ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Answer Proposals</h4>
              <AnswerPanel
                title="Approved KB Answer"
                answer={item.answer_proposals.kb_answer}
                sourceType="kb"
                isInbox={isInbox}
                actionLoading={actionLoading}
                onApproveVariant={onApproveVariant}
              />
              <AnswerPanel
                title="Transcript-Informed Answer"
                answer={item.answer_proposals.transcript_answer}
                sourceType="transcript"
                isInbox={isInbox}
                actionLoading={actionLoading}
                onApproveVariant={onApproveVariant}
              />
              <AnswerPanel
                title="Recommended Final Draft"
                answer={item.answer_proposals.merged_answer}
                sourceType="merged"
                isInbox={isInbox}
                actionLoading={actionLoading}
                onApproveVariant={onApproveVariant}
              />
            </div>
          ) : (
            <>
              {item.recommended_answer && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recommended Answer</h4>
                  <div className="text-sm text-foreground bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">
                    {item.recommended_answer}
                  </div>
                </div>
              )}
              {isInbox && (
                <button
                  onClick={onGenerateProposals}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-medium hover:bg-primary/20 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? "animate-spin" : ""}`} />
                  Generate Possible Answers
                </button>
              )}
            </>
          )}

          {item.similar_existing.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Related KB Articles</h4>
              <div className="flex flex-wrap gap-2">
                {item.similar_existing.map((kb) => (
                  <span key={kb.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md border border-blue-200">
                    {kb.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.recent_actions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Review History</h4>
              <div className="space-y-1">
                {item.recent_actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{a.reviewer_id}</span>
                    <span className={`px-1.5 py-0.5 rounded ${a.action === "approved" ? "bg-emerald-100 text-emerald-800" : a.action === "rejected" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}>
                      {a.action}
                    </span>
                    {a.notes && <span className="truncate max-w-xs">{a.notes}</span>}
                    {a.created_at && <span>{new Date(a.created_at).toLocaleString()}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.rejected_by && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <span className="text-xs font-medium text-red-700">Rejected by {item.rejected_by}</span>
              {item.rejection_reason && <p className="text-sm text-red-600 mt-1">{item.rejection_reason}</p>}
            </div>
          )}

          {item.approved_by && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <span className="text-xs font-medium text-emerald-700">Approved by {item.approved_by}</span>
              {item.approved_at && <span className="text-xs text-emerald-600 ml-2">{new Date(item.approved_at).toLocaleString()}</span>}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`px-2 py-0.5 rounded-full ${confidenceBg(item.confidence)}`}>{confidencePct}%</span>
            <span>&bull; {item.source_call_count} supporting calls</span>
            {item.review_batch_id && <span>&bull; Batch #{item.review_batch_id}</span>}
          </div>

          {isInbox && (
            <div className="border-t border-border pt-3 space-y-3">
              <textarea
                value={reviewNotes}
                onChange={(e) => onReviewNotesChange(e.target.value)}
                placeholder="Reviewer notes (optional)..."
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm resize-none h-16"
              />
              <div className="flex gap-2">
                <button
                  onClick={onApprove}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Approve & Publish
                </button>
                <div className="flex-1 flex gap-2 items-center">
                  <input
                    value={rejectReason}
                    onChange={(e) => onRejectReasonChange(e.target.value)}
                    placeholder="Rejection reason..."
                    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={onReject}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalyticsPanel({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Loading analytics...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Drafts" value={analytics.draft_volume.total} />
        <StatCard label="Pending Review" value={analytics.draft_volume.pending} accent="amber" />
        <StatCard label="Approved" value={analytics.draft_volume.approved} accent="emerald" />
        <StatCard label="Merged" value={analytics.draft_volume.merged} accent="blue" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Approval Rate" value={`${analytics.approval_rate}%`} />
        <StatCard label="Avg Review Time" value={analytics.avg_review_time_hours ? `${analytics.avg_review_time_hours}h` : "—"} />
        <StatCard label="KB from Transcripts" value={analytics.transcript_derived_articles} accent="purple" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3">Top Recurring Gaps</h3>
          {analytics.top_recurring_gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gaps detected yet</p>
          ) : (
            <div className="space-y-2">
              {analytics.top_recurring_gaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[g.topic_type] || "bg-gray-100 text-gray-800"}`}>
                    {g.topic_type.replace(/_/g, " ")}
                  </span>
                  <span className="text-sm font-medium">{g.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3">Unresolved Gaps by Frequency</h3>
          {analytics.top_unresolved_gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unresolved gaps</p>
          ) : (
            <div className="space-y-2">
              {analytics.top_unresolved_gaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm">{g.topic_type.replace(/_/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min((g.total_frequency / 20) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{g.total_frequency}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3">Email Review Batches</h3>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Total Batches:</span>
            <span className="ml-2 font-medium">{analytics.email_batches.total}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Emails Sent:</span>
            <span className="ml-2 font-medium">{analytics.email_batches.sent}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  const accentClass = accent === "emerald" ? "text-emerald-600" : accent === "amber" ? "text-amber-600" : accent === "blue" ? "text-blue-600" : accent === "purple" ? "text-purple-600" : "";
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`text-2xl font-semibold mt-1 ${accentClass}`}>{value}</div>
    </div>
  );
}
