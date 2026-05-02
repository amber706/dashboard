import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  BookOpen, Loader2, CheckCircle2, XCircle, Edit3, ChevronDown, ChevronRight,
  Phone, FileText, Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type DraftStatus = "pending" | "approved" | "rejected" | "edited_and_approved";

interface Draft {
  id: string;
  problem_statement: string;
  recommended_answer: string | null;
  kb_side_proposal: string | null;
  transcript_side_proposal: string | null;
  merged_answer: string | null;
  source_call_ids: string[] | null;
  similar_existing_kb_ids: string[] | null;
  confidence: number | null;
  status: DraftStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resulting_kb_document_id: string | null;
  requested_by: string | null;
  requested_query: string | null;
  requester: { full_name: string | null; email: string | null } | null;
  created_at: string;
}

const statusClass: Record<DraftStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  edited_and_approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function KBDraftsReview() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DraftStatus | "all">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let q = supabase
      .from("kb_drafts")
      .select("*, requester:profiles!kb_drafts_requested_by_fkey(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) setError(error.message);
    else setDrafts((data ?? []) as Draft[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BookOpen className="w-6 h-6" /> KB drafts review
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-generated drafts from caller questions. Approve, edit, or reject — approved drafts get embedded and added to the searchable KB.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "edited_and_approved", "rejected", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {loading && <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading drafts…</CardContent></Card>}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && drafts.length === 0 && (
        <Card><CardContent className="pt-8 text-center text-sm text-muted-foreground">
          No drafts in this filter. {filter === "pending" && "(Drafts populate from the daily 6 AM scheduled run.)"}
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {drafts.map((d) => (
          <DraftRow
            key={d.id}
            draft={d}
            expanded={expandedId === d.id}
            onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
            currentUserId={user?.id ?? null}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function DraftRow({
  draft, expanded, onToggle, currentUserId, onChanged,
}: {
  draft: Draft; expanded: boolean; onToggle: () => void;
  currentUserId: string | null; onChanged: () => void;
}) {
  const [title, setTitle] = useState(draft.problem_statement);
  const [content, setContent] = useState(draft.merged_answer ?? "");
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function approve(edited: boolean) {
    setWorking("approve"); setActionError(null);
    try {
      // 1. Insert into kb_documents (status=pending so seeder/approver pipelines re-embed it)
      const { data: doc, error: insErr } = await supabase
        .from("kb_documents")
        .insert({
          title: title.trim() || draft.problem_statement,
          content: content.trim() || draft.merged_answer || "",
          category: "playbook",
          source: "kb_draft_approval",
          status: "approved",
          owner_id: currentUserId,
          last_reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);

      // 2. Mark the draft as approved/edited and link to the new doc
      const { error: updErr } = await supabase
        .from("kb_drafts")
        .update({
          status: edited ? "edited_and_approved" : "approved",
          reviewed_by: currentUserId,
          reviewed_at: new Date().toISOString(),
          resulting_kb_document_id: doc.id,
          merged_answer: content.trim() || draft.merged_answer,
        })
        .eq("id", draft.id);
      if (updErr) throw new Error(updErr.message);

      // 3. Fire embedding for the new doc so it's immediately searchable.
      // We re-use seed-kb-playbook by sending just this one chunk of text;
      // it'll embed and replace its source='kb_draft_approval' rows. We only
      // do this if the draft text is substantial enough to embed.
      if (content.length > 30) {
        await supabase.functions.invoke("kb-embed-single", {
          body: { kb_document_id: doc.id },
        }).catch(() => {/* embedding is best-effort; doc still searchable via title later */});
      }

      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  async function reject() {
    setWorking("reject"); setActionError(null);
    const { error } = await supabase
      .from("kb_drafts")
      .update({
        status: "rejected",
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    setWorking(null);
    if (error) setActionError(error.message);
    else onChanged();
  }

  return (
    <Card className={draft.status === "pending" ? "border-l-4 border-l-amber-500" : ""}>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <Badge className={statusClass[draft.status]} variant="secondary">{draft.status.replace(/_/g, " ")}</Badge>
              {draft.confidence != null && (
                <span className="text-xs text-muted-foreground">{(Number(draft.confidence) * 100).toFixed(0)}% confident</span>
              )}
              <span className="text-xs text-muted-foreground">{fmtTime(draft.created_at)}</span>
              {draft.source_call_ids && draft.source_call_ids.length > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {draft.source_call_ids.length} source call{draft.source_call_ids.length > 1 ? "s" : ""}
                </span>
              )}
              {draft.requested_by && (
                <Badge variant="outline" className="text-[10px]">
                  requested by {draft.requester?.full_name ?? draft.requester?.email ?? "specialist"}
                </Badge>
              )}
            </div>
            <div className="font-medium">{draft.problem_statement}</div>
            {draft.requested_query && draft.requested_query !== draft.problem_statement && (
              <div className="text-xs text-muted-foreground">searched: "{draft.requested_query}"</div>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {draft.kb_side_proposal && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" /> From existing KB
              </h4>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground border-l-2 border-muted pl-3">
                {draft.kb_side_proposal}
              </p>
            </div>
          )}

          {draft.transcript_side_proposal && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> From specialist's actual answer
              </h4>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground border-l-2 border-muted pl-3">
                {draft.transcript_side_proposal}
              </p>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Recommended merged answer
              {draft.status === "pending" && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setEditing(!editing)}>
                  <Edit3 className="w-3 h-3 mr-1" /> {editing ? "Stop editing" : "Edit"}
                </Button>
              )}
            </h4>
            {editing ? (
              <div className="space-y-2">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="KB entry title" className="text-sm" />
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="text-sm"
                  placeholder="Final answer that goes into the KB"
                />
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap border-l-2 border-primary/30 pl-3">
                {content}
              </p>
            )}
          </div>

          {actionError && <div className="text-xs text-destructive">{actionError}</div>}

          {draft.status === "pending" && (
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={reject} disabled={working !== null}>
                {working === "reject" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <XCircle className="w-3 h-3 mr-1.5" />}
                Reject
              </Button>
              <Button size="sm" onClick={() => approve(editing)} disabled={working !== null}>
                {working === "approve" ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1.5" />}
                {editing ? "Save edits & approve" : "Approve as-is"}
              </Button>
            </div>
          )}

          {draft.status !== "pending" && draft.resulting_kb_document_id && (
            <div className="text-xs text-muted-foreground border-t pt-2">
              Reviewed {fmtTime(draft.reviewed_at)} · KB doc ID: <span className="font-mono">{draft.resulting_kb_document_id}</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
