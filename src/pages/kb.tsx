import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Plus, MessageSquarePlus, Sparkles, Save, CheckCircle2, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQueryKb } from "@/lib/workspace-api-stub";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const queryKb = useQueryKb();

  const [query, setQuery] = useState("");
  // The query string actually submitted (separate from the live input)
  // so we file the right phrase even if the user keeps typing afterward.
  const [searchedQuery, setSearchedQuery] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  // Auto-file state for the empty-results case. "logged" → just created a
  // new request, "duplicate" → there's already a pending one for this query.
  const [autoFileState, setAutoFileState] = useState<"idle" | "logging" | "logged" | "duplicate" | "error">("idle");
  // The query string the auto-file effect ran against, so we don't fire
  // again for the same search if the component re-renders.
  const lastAutoFiledQuery = useRef<string | null>(null);

  const canAuthor = role === "manager" || role === "admin";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setAutoFileState("idle");
    lastAutoFiledQuery.current = null;
    setSearchedQuery(trimmed);
    queryKb.mutate({ data: { query: trimmed } });
  };

  const sources = (queryKb.data?.sources ?? []) as Array<{
    id: string;
    title: string;
    category: string | null;
    similarity: number;
  }>;
  const topAnswer = queryKb.data?.answer;
  const noResults = !!queryKb.data && !queryKb.isPending && sources.length === 0;

  // When a search returns nothing, auto-file the question into kb_drafts so
  // managers see it without the specialist having to click anything. We
  // skip very short queries (likely typos / single words) and dedupe
  // against pending requests for the same exact phrase in the last 14 days.
  useEffect(() => {
    if (!noResults) return;
    const q = searchedQuery;
    if (!q || q.length < 10) return;
    if (lastAutoFiledQuery.current === q) return;
    lastAutoFiledQuery.current = q;

    (async () => {
      setAutoFileState("logging");
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("kb_drafts")
        .select("id")
        .ilike("problem_statement", q)
        .eq("status", "pending")
        .gte("created_at", fourteenDaysAgo)
        .limit(1);
      if (existing && existing.length > 0) {
        setAutoFileState("duplicate");
        return;
      }
      const { error } = await supabase.from("kb_drafts").insert({
        problem_statement: q,
        recommended_answer: null,
        requested_by: user?.id ?? null,
        requested_query: q,
        status: "pending",
        confidence: null,
      });
      setAutoFileState(error ? "error" : "logged");
    })();
  }, [noResults, searchedQuery, user?.id]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search the Cornerstone admissions playbook. Results are ranked by semantic relevance.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setRequestOpen(true)} className="gap-1.5">
            <MessageSquarePlus className="w-4 h-4" /> Suggest content
          </Button>
          {canAuthor && (
            <Button size="sm" onClick={() => setAuthorOpen(true)} className="gap-1.5">
              <Plus className="w-4 h-4" /> New article
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question — e.g. what insurance does Cornerstone accept"
          className="flex-1"
        />
        <Button type="submit" disabled={queryKb.isPending || !query.trim()}>
          {queryKb.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="ml-2">Search</span>
        </Button>
      </form>

      {queryKb.error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">
            {(queryKb.error as Error).message}
          </CardContent>
        </Card>
      )}

      {queryKb.isPending && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Embedding query and searching…
          </CardContent>
        </Card>
      )}

      {noResults && (
        <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="pt-6 pb-6 space-y-3">
            <p className="text-sm">No matching content found above the relevance threshold.</p>
            {autoFileState === "logging" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending your question to the KB team…
              </p>
            )}
            {autoFileState === "logged" && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sent to the KB team for review. You'll see an answer here once it's approved.
              </p>
            )}
            {autoFileState === "duplicate" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Inbox className="w-3.5 h-3.5" /> This question is already in the KB queue waiting on a manager.
              </p>
            )}
            {autoFileState === "error" && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                Couldn't auto-file your question. Use the button below to send it manually.
              </p>
            )}
            <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)} className="gap-1.5">
              <MessageSquarePlus className="w-4 h-4" /> Add context to this request
            </Button>
          </CardContent>
        </Card>
      )}

      {queryKb.data && !queryKb.isPending && sources.length > 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top match</CardTitle>
            </CardHeader>
            <CardContent className="text-sm whitespace-pre-wrap">{topAnswer}</CardContent>
          </Card>

          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              All ranked results ({sources.length})
            </h2>
            <div className="space-y-2">
              {sources.map((s) => (
                <Card key={s.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{s.title}</div>
                        {s.category && (
                          <Badge variant="secondary" className="mt-1 text-xs">{s.category}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {(s.similarity * 100).toFixed(1)}% match
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      <RequestContentDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        defaultQuery={query.trim()}
        userId={user?.id ?? null}
        onSubmitted={() => toast({ title: "Request sent", description: "A manager will review it in the KB drafts queue." })}
      />

      {canAuthor && (
        <AuthorArticleDialog
          open={authorOpen}
          onOpenChange={setAuthorOpen}
          userId={user?.id ?? null}
          onSaved={() => toast({ title: "Article saved", description: "Submitted to KB drafts. Approve in /ops/kb-drafts to publish." })}
        />
      )}
    </div>
  );
}

function RequestContentDialog({ open, onOpenChange, defaultQuery, userId, onSubmitted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultQuery: string;
  userId: string | null;
  onSubmitted: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the topic from the user's most recent search whenever the
  // dialog opens (only if topic is empty so we don't overwrite typing).
  if (open && !topic && defaultQuery) setTopic(defaultQuery);

  async function submit() {
    const t = topic.trim();
    if (!t) return;
    setSubmitting(true);
    const { error } = await supabase.from("kb_drafts").insert({
      problem_statement: t,
      recommended_answer: null,
      kb_side_proposal: details.trim() || null,
      requested_by: userId,
      requested_query: defaultQuery || null,
      status: "pending",
      confidence: null,
    });
    setSubmitting(false);
    if (!error) {
      onSubmitted();
      setTopic(""); setDetails("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setTopic(""); setDetails(""); } onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggest knowledge content</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">What topic or question should be added?</label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Do we accept patients with service animals?"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Any context that would help (optional)</label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Caller asked about ESA dogs vs service animals; we don't have a clear answer."
              className="mt-1 min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={!topic.trim() || submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send to KB queue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthorArticleDialog({ open, onOpenChange, userId, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generateDraft() {
    const t = title.trim();
    const p = aiPrompt.trim();
    if (!t && !p) return;
    setDrafting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-kb-content`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ topic: t, prompt: p }),
      });
      const json = await res.json();
      if (json.ok && json.draft) setBody(json.draft);
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return;
    setSaving(true);
    const { error } = await supabase.from("kb_drafts").insert({
      problem_statement: t,
      recommended_answer: b,
      requested_by: userId,
      status: "pending",
      confidence: null,
    });
    setSaving(false);
    if (!error) {
      onSaved();
      setTitle(""); setBody(""); setAiPrompt("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setTitle(""); setBody(""); setAiPrompt(""); } onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New knowledge base article</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title / topic</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Insurance verification process for AHCCCS plans"
              className="mt-1"
              autoFocus
            />
          </div>

          <div className="border rounded-md p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" /> Draft with AI (optional)
            </div>
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Briefly describe what the article should cover. e.g. 'Explain how to verify AHCCCS coverage for a new caller, what info to collect, and what to do if it bounces.'"
              className="min-h-[70px] text-sm bg-background"
            />
            <Button size="sm" onClick={generateDraft} disabled={drafting || (!title.trim() && !aiPrompt.trim())} className="gap-1.5">
              {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {drafting ? "Drafting…" : body.trim() ? "Re-generate" : "Generate draft"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              The draft will populate the body below — edit it before saving.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Article body (Markdown)</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the article, or use the AI draft helper above to start."
              className="mt-1 min-h-[280px] font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!title.trim() || !body.trim() || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save to KB drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
