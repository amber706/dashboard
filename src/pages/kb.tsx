import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Plus, MessageSquarePlus, Sparkles, Save, CheckCircle2, Inbox, ChevronRight, ShieldCheck, Building2, FileText, DollarSign, Phone, Brain } from "lucide-react";
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

// Curated KB quicklinks. Each row pre-fills the search and runs it, so
// a specialist can hit the most common topics in one click without
// remembering exact phrasing. Grouped into operational buckets.
//
// Add or remove entries here as the KB evolves; nothing else needs to change.
interface QuickLink {
  label: string;
  query: string;
  description: string;
}
interface QuickLinkSection {
  title: string;
  icon: typeof ShieldCheck;
  links: QuickLink[];
}

const KB_QUICKLINKS: QuickLinkSection[] = [
  {
    title: "Insurance & coverage",
    icon: ShieldCheck,
    links: [
      { label: "What insurance does Cornerstone accept?",
        query: "what insurance does Cornerstone accept",
        description: "Full list of in-network carriers + AHCCCS plans" },
      { label: "AHCCCS plans we cover",
        query: "AHCCCS plans Mercy Care Banner Molina",
        description: "Arizona Medicaid plan details" },
      { label: "Out-of-network / single-case agreements",
        query: "out of network single case agreement OON",
        description: "What to do when a carrier isn't in-network" },
      { label: "Self-pay pricing",
        query: "self pay private pay cost pricing",
        description: "Cost structure for uninsured patients" },
    ],
  },
  {
    title: "Programs & levels of care",
    icon: Building2,
    links: [
      { label: "BHRF / residential",
        query: "BHRF residential inpatient",
        description: "Highest level of care — 24/7 supervised housing" },
      { label: "PHP — Partial Hospitalization",
        query: "PHP partial hospitalization program",
        description: "5+ days/week, structured daytime program" },
      { label: "IOP — Intensive Outpatient",
        query: "IOP intensive outpatient three day five day",
        description: "3-day or 5-day weekly intensive outpatient" },
      { label: "Virtual IOP / telehealth",
        query: "virtual IOP VIOP telehealth remote",
        description: "Online intensive outpatient option" },
      { label: "Court-ordered DUI / DV",
        query: "court ordered DUI DV violation",
        description: "Court services and judge-ordered intake" },
    ],
  },
  {
    title: "Intake & scripting",
    icon: FileText,
    links: [
      { label: "Pre-assessment checklist",
        query: "pre-assessment intake checklist",
        description: "What to capture before scheduling intake" },
      { label: "Crisis / safety screening",
        query: "crisis safety suicide self harm screening",
        description: "When to escalate vs continue intake" },
      { label: "Withdrawal / detox triage",
        query: "withdrawal detox medical alcohol benzo opioid",
        description: "Symptoms that need detox before residential" },
      { label: "Scheduling intake",
        query: "schedule intake admit appointment",
        description: "Walk-in vs. scheduled, address, what to bring" },
    ],
  },
  {
    title: "Caller scenarios",
    icon: Phone,
    links: [
      { label: "Caller is on probation",
        query: "probation court paper court ordered treatment",
        description: "Court paperwork, signature loops, judge requirements" },
      { label: "Family member calling",
        query: "family member calling on behalf relationship to patient",
        description: "What to do when caller isn't the patient" },
      { label: "Polysubstance use",
        query: "polysubstance multiple substances opioid alcohol",
        description: "Triage when caller uses more than one substance" },
      { label: "SMI / serious mental illness",
        query: "SMI serious mental illness schizophrenia bipolar",
        description: "Co-occurring mental health and SUD" },
    ],
  },
  {
    title: "Pricing & policies",
    icon: DollarSign,
    links: [
      { label: "Refund / cancellation policy",
        query: "refund cancellation policy",
        description: "What happens if a patient leaves early" },
      { label: "Service animals / ESA",
        query: "service animal emotional support animal ESA",
        description: "What we accept on the housing side" },
      { label: "Children in state foster care",
        query: "children state foster care Arizona",
        description: "Special intake handling for foster kids" },
    ],
  },
  {
    title: "Clinical & other",
    icon: Brain,
    links: [
      { label: "Suboxone / MAT continuity",
        query: "Suboxone MAT medication assisted continuity",
        description: "Patients already on MAT — what to confirm" },
      { label: "Psychiatric meds at admission",
        query: "psychiatric medications Seroquel current meds admission",
        description: "What to capture for the intake nurse" },
      { label: "Adolescent / minor intake",
        query: "adolescent minor under 18 parent guardian",
        description: "Consent + guardian requirements for minors" },
    ],
  },
];

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
  // Whether the latest search came from an explicit Enter/click vs the
  // debounced live-search effect. Only explicit submissions should
  // auto-file unanswered questions — typing word by word shouldn't.
  const [isExplicitSubmit, setIsExplicitSubmit] = useState(false);

  const canAuthor = role === "manager" || role === "admin";

  function runSearch(q: string, explicit: boolean) {
    setAutoFileState("idle");
    lastAutoFiledQuery.current = null;
    setSearchedQuery(q);
    setIsExplicitSubmit(explicit);
    queryKb.mutate({ data: { query: q } });
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    runSearch(trimmed, true);
  };

  // Live search-as-you-type. Debounce 400ms after the last keystroke,
  // then fire a search if the query is at least 4 chars long. Skips
  // if the query is identical to the last one we searched (handles
  // the case where the user submits then keeps the same text).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 4) return;
    if (trimmed === searchedQuery) return;
    const t = setTimeout(() => runSearch(trimmed, false), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sources = (queryKb.data?.sources ?? []) as Array<{
    id: string;
    title: string;
    category: string | null;
    similarity: number;
  }>;
  const topAnswer = queryKb.data?.answer;
  const noResults = !!queryKb.data && !queryKb.isPending && sources.length === 0;

  // When a search returns nothing, auto-file the question into kb_drafts so
  // managers see it without the specialist having to click anything. Only
  // fires for explicit submits (Enter / button), not the debounced live
  // search — otherwise typing a long question word-by-word would file
  // multiple partial requests. Dedupes against pending requests for the
  // same phrase in the last 14 days.
  useEffect(() => {
    if (!noResults) return;
    if (!isExplicitSubmit) return;
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
      const { data: inserted, error } = await supabase.from("kb_drafts").insert({
        problem_statement: q,
        recommended_answer: null,
        requested_by: user?.id ?? null,
        requested_query: q,
        status: "pending",
        confidence: null,
      }).select("id").single();
      setAutoFileState(error ? "error" : "logged");
      // Fire-and-forget: ask the AI to draft an answer using existing KB +
      // recent transcript hits. Manager will see the draft populated when
      // they next visit /ops/kb-drafts. Don't block the search UI.
      if (!error && inserted?.id) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-topic-draft`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ kb_draft_id: inserted.id }),
        }).catch(() => { /* best-effort */ });
      }
    })();
  }, [noResults, isExplicitSubmit, searchedQuery, user?.id]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
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

      {/* Quicklinks — show when there's no active search to give specialists
          a fast path to the most common questions without remembering the
          exact phrasing. Hidden as soon as a search runs. */}
      {!searchedQuery && !queryKb.isPending && !queryKb.data && (
        <div className="space-y-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick links
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {KB_QUICKLINKS.map((section) => {
              const Icon = section.icon;
              return (
                <Card key={section.title}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border">
                      {section.links.map((l) => (
                        <button
                          key={l.query}
                          onClick={() => { setQuery(l.query); runSearch(l.query, true); }}
                          className="w-full text-left py-2.5 first:pt-0 last:pb-0 flex items-start gap-3 group hover:bg-accent/30 -mx-3 px-3 rounded-md transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium group-hover:text-foreground">{l.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{l.description}</div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

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
    const { data: inserted, error } = await supabase.from("kb_drafts").insert({
      problem_statement: t,
      recommended_answer: null,
      kb_side_proposal: details.trim() || null,
      requested_by: userId,
      requested_query: defaultQuery || null,
      status: "pending",
      confidence: null,
    }).select("id").single();
    // Fire the AI drafter in the background — manager sees a populated
    // recommended_answer when they open /ops/kb-drafts, instead of an
    // empty stub they'd have to write themselves.
    if (!error && inserted?.id) {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-topic-draft`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kb_draft_id: inserted.id }),
      }).catch(() => { /* best-effort */ });
    }
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
