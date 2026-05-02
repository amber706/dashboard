// Objection-handling knowledge mining surface.
//
// Shows the objections callers raised in real transcripts, grouped by
// category. Manager can:
//   1. See top objections by frequency + how many turned around
//   2. Expand a category to see verbatim caller quotes + the responses
//      that worked (turn-around examples first)
//   3. Click "Generate KB entry" to synthesize a manager-facing playbook
//      entry from those examples → lands as a kb_drafts row pending
//      review
//
// Background data flows:
//   - identify-objections-batch (Edge Function) sweeps recent calls
//     and writes objection_examples rows. Auto-scheduled via pg_cron;
//     can also be triggered manually here.
//   - build-objection-handling-kb (Edge Function) clusters and synthesizes
//     a kb_drafts entry per category. Triggered manually via the button
//     here (also schedulable).

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  MessageSquare, Loader2, ChevronDown, ChevronRight, Sparkles, Zap,
  CheckCircle2, ExternalLink, RefreshCw, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

const CATEGORY_LABEL: Record<string, string> = {
  cost: "Cost / Affordability",
  insurance: "Insurance coverage",
  timing: "Timing / not ready",
  family: "Family pressure",
  denial: "Denial of need",
  fear: "Fear / anxiety",
  trust: "Distrust of treatment",
  logistics: "Logistics (transport, work, housing)",
  clinical: "Clinical concerns",
  other: "Other",
};

interface ObjectionExample {
  id: string;
  call_session_id: string;
  category: string;
  caller_quote: string;
  specialist_response: string | null;
  turned_around: boolean;
  confidence: number;
  caller_turn_sequence: number | null;
  tags: string[] | null;
  created_at: string;
  used_in_kb_draft_id: string | null;
}

interface CategoryGroup {
  category: string;
  examples: ObjectionExample[];
  total: number;
  turn_around_count: number;
  used_in_kb_count: number;
}

export default function OpsObjections() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("objection_examples")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setStatusMsg(error.message);
      setLoading(false);
      return;
    }
    const examples = (data ?? []) as ObjectionExample[];
    // Group by category
    const map = new Map<string, ObjectionExample[]>();
    for (const e of examples) {
      const arr = map.get(e.category) ?? [];
      arr.push(e);
      map.set(e.category, arr);
    }
    const out: CategoryGroup[] = [];
    for (const [cat, list] of map.entries()) {
      out.push({
        category: cat,
        examples: list,
        total: list.length,
        turn_around_count: list.filter((e) => e.turned_around).length,
        used_in_kb_count: list.filter((e) => e.used_in_kb_draft_id).length,
      });
    }
    out.sort((a, b) => b.total - a.total);
    setGroups(out);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runBatch() {
    setBatching(true);
    setStatusMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/identify-objections-batch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lookback_days: 30, limit: 5 }),
      });
      const j = await res.json();
      if (!j.ok) {
        setStatusMsg(`Batch failed: ${j.error ?? "unknown"}`);
      } else {
        setStatusMsg(
          `Scanned ${j.examined} calls · processed ${j.processed} · ` +
          `${j.total_extracted} objection moments captured ` +
          `(${j.skipped_no_transcript} no transcript, ${j.skipped_already_processed} already done)`,
        );
        await load();
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBatching(false);
    }
  }

  async function generateKbDraftFor(category: string) {
    setGenerating(category);
    setStatusMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/build-objection-handling-kb`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ category, force: false }),
      });
      const j = await res.json();
      if (!j.ok) {
        setStatusMsg(`Generation failed: ${j.error ?? "unknown"}`);
      } else if (j.drafts_created === 0) {
        const skipped = j.skipped?.[0]?.reason ?? "see logs";
        setStatusMsg(`No new draft created — ${skipped}`);
      } else {
        setStatusMsg(`Created ${j.drafts_created} KB draft. Review at /ops/kb-drafts.`);
        await load();
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  return (
    <PageShell
      eyebrow="OBJECTIONS"
      title="Objection handling — knowledge mining"
      subtitle="Real objections lifted from call transcripts, grouped by type. Turn-around examples (calls that ended in admit/booked-intake) are surfaced first because they show the responses that actually worked. Click 'Generate KB entry' to synthesize a manager-approved playbook entry."
      maxWidth={1400}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button size="sm" onClick={runBatch} disabled={batching} className="gap-1.5 h-9">
            {batching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {batching ? "Mining…" : "Mine new calls now"}
          </Button>
        </div>
      }
    >
      {statusMsg && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="pt-3 pb-3 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <span>{statusMsg}</span>
          </CardContent>
        </Card>
      )}

      {loading && groups.length === 0 ? (
        <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading objection examples…
        </CardContent></Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="pt-8 pb-8 text-center text-sm text-muted-foreground space-y-2">
          <MessageSquare className="w-8 h-8 text-muted-foreground/50 mx-auto" />
          <div>No objection examples mined yet. Click "Mine new calls now" to start the first sweep.</div>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded === g.category;
            const draftableCount = g.total - g.used_in_kb_count;
            return (
              <Card key={g.category}>
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : g.category)}>
                  <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <MessageSquare className="w-4 h-4 text-amber-500" />
                      <span className="truncate">{CATEGORY_LABEL[g.category] ?? g.category}</span>
                    </span>
                    <div className="flex items-center gap-2 flex-wrap shrink-0 text-xs font-normal">
                      <Badge variant="outline" className="text-[10px]">{g.total} examples</Badge>
                      {g.turn_around_count > 0 && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> {g.turn_around_count} turned around
                        </Badge>
                      )}
                      {g.used_in_kb_count > 0 && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {g.used_in_kb_count} already in KB drafts
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); generateKbDraftFor(g.category); }}
                        disabled={generating === g.category || draftableCount < 3}
                        className="h-7 gap-1 text-xs"
                        title={draftableCount < 3 ? "Need at least 3 unused examples" : "Synthesize a KB draft from these"}
                      >
                        {generating === g.category ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Generate KB entry
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0 space-y-2">
                    {/* Turn-around examples first — these are the gold */}
                    {g.examples.filter((e) => e.turned_around).slice(0, 5).map((e) => (
                      <ExampleCard key={e.id} example={e} highlight />
                    ))}
                    {g.examples.filter((e) => !e.turned_around).slice(0, 3).map((e) => (
                      <ExampleCard key={e.id} example={e} />
                    ))}
                    {g.examples.length > 8 && (
                      <div className="text-xs text-muted-foreground text-center pt-1">
                        + {g.examples.length - 8} more (only the strongest 8 shown)
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function ExampleCard({ example, highlight }: { example: ObjectionExample; highlight?: boolean }) {
  return (
    <div className={`border rounded-md p-3 space-y-2 ${highlight ? "border-emerald-500/30 bg-emerald-500/5" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {example.turned_around && (
          <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Turn-around
          </Badge>
        )}
        {(example.tags ?? []).slice(0, 3).map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
        ))}
        <Link href={`/live/${example.call_session_id}`} className="text-[10px] text-muted-foreground hover:underline ml-auto inline-flex items-center gap-1">
          Source call <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      <div className="text-sm">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Caller said</div>
        <div className="border-l-2 border-rose-500/40 pl-3 italic">"{example.caller_quote}"</div>
      </div>
      {example.specialist_response && (
        <div className="text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Specialist response</div>
          <div className="border-l-2 border-emerald-500/40 pl-3">"{example.specialist_response}"</div>
        </div>
      )}
    </div>
  );
}
