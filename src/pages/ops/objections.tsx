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
  CheckCircle2, ExternalLink, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/dashboard/PageShell";

type WindowKey = "all" | "90d" | "30d" | "7d";
const WINDOW_LABEL: Record<WindowKey, string> = {
  all: "All time",
  "90d": "Last 90 days",
  "30d": "Last 30 days",
  "7d":  "Last 7 days",
};
const WINDOW_DAYS: Record<Exclude<WindowKey, "all">, number> = {
  "90d": 90,
  "30d": 30,
  "7d":  7,
};

function windowStartISO(w: WindowKey): string | null {
  if (w === "all") return null;
  return new Date(Date.now() - WINDOW_DAYS[w] * 86_400_000).toISOString();
}
function priorWindowRangeISO(w: WindowKey): { from: string; to: string } | null {
  if (w === "all") return null;
  const days = WINDOW_DAYS[w];
  const now = Date.now();
  return {
    from: new Date(now - 2 * days * 86_400_000).toISOString(),
    to:   new Date(now - days * 86_400_000).toISOString(),
  };
}

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
  prior_total: number;
  share: number;             // 0..1 of all objections in window
  trend_pct: number | null;  // null when prior period has 0
  turn_around_count: number;
  used_in_kb_count: number;
}

export default function OpsObjections() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [priorGrandTotal, setPriorGrandTotal] = useState(0);
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = windowStartISO(windowKey);
    const prior = priorWindowRangeISO(windowKey);

    // Current window — fetch examples to render cards + counts.
    let currentQuery = supabase
      .from("objection_examples")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (since) currentQuery = currentQuery.gte("created_at", since);
    const currentRes = await currentQuery;

    // Prior equal-length window — just need counts by category for the trend chip.
    const priorRes = prior
      ? await supabase
          .from("objection_examples")
          .select("category", { count: "exact" })
          .gte("created_at", prior.from)
          .lt("created_at",  prior.to)
      : { data: [] as { category: string }[], error: null };

    if (currentRes.error) {
      setStatusMsg(currentRes.error.message);
      setLoading(false);
      return;
    }

    const examples = (currentRes.data ?? []) as ObjectionExample[];
    const priorByCat = new Map<string, number>();
    for (const r of priorRes.data ?? []) {
      priorByCat.set(r.category, (priorByCat.get(r.category) ?? 0) + 1);
    }

    // Group by category
    const map = new Map<string, ObjectionExample[]>();
    for (const e of examples) {
      const arr = map.get(e.category) ?? [];
      arr.push(e);
      map.set(e.category, arr);
    }
    const total = examples.length;
    const priorTotal = [...priorByCat.values()].reduce((s, n) => s + n, 0);

    const out: CategoryGroup[] = [];
    for (const [cat, list] of map.entries()) {
      const prior = priorByCat.get(cat) ?? 0;
      out.push({
        category: cat,
        examples: list,
        total: list.length,
        prior_total: prior,
        share: total > 0 ? list.length / total : 0,
        trend_pct: prior > 0 ? (list.length - prior) / prior : null,
        turn_around_count: list.filter((e) => e.turned_around).length,
        used_in_kb_count: list.filter((e) => e.used_in_kb_draft_id).length,
      });
    }
    out.sort((a, b) => b.total - a.total);
    setGroups(out);
    setGrandTotal(total);
    setPriorGrandTotal(priorTotal);
    setLoading(false);
  }, [windowKey]);

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
        <div className="flex gap-2 items-center">
          <Select value={windowKey} onValueChange={(v) => setWindowKey(v as WindowKey)}>
            <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["7d","30d","90d","all"] as WindowKey[]).map((k) => (
                <SelectItem key={k} value={k}>{WINDOW_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <FrequencySummary
        windowKey={windowKey}
        total={grandTotal}
        priorTotal={priorGrandTotal}
        topCategory={groups[0] ?? null}
      />


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
                      <Badge variant="outline" className="text-[10px] font-semibold tabular-nums">
                        {g.total} {g.total === 1 ? "occurrence" : "occurrences"}
                      </Badge>
                      {grandTotal > 0 && (
                        <Badge variant="outline" className="text-[10px] tabular-nums">
                          {Math.round(g.share * 100)}% of total
                        </Badge>
                      )}
                      <TrendChip pct={g.trend_pct} priorTotal={g.prior_total} windowKey={windowKey} />
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

function FrequencySummary({
  windowKey, total, priorTotal, topCategory,
}: {
  windowKey: WindowKey;
  total: number;
  priorTotal: number;
  topCategory: CategoryGroup | null;
}) {
  if (total === 0) return null;
  const deltaPct = priorTotal > 0 ? (total - priorTotal) / priorTotal : null;
  const topShare = topCategory && total > 0 ? Math.round(topCategory.total / total * 100) : 0;
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-6 flex-wrap text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Window</div>
          <div className="font-semibold">{WINDOW_LABEL[windowKey]}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Total objections</div>
          <div className="text-2xl font-bold tabular-nums leading-tight">{total.toLocaleString()}</div>
        </div>
        {deltaPct !== null && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">vs prior period</div>
            <div className="flex items-center gap-1 font-semibold">
              <TrendIcon pct={deltaPct} />
              <span className={deltaPct > 0 ? "text-rose-600 dark:text-rose-400" : deltaPct < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {deltaPct > 0 ? "+" : ""}{(deltaPct * 100).toFixed(0)}%
              </span>
              <span className="text-xs text-muted-foreground font-normal tabular-nums">
                ({priorTotal.toLocaleString()} prior)
              </span>
            </div>
          </div>
        )}
        {topCategory && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Most frequent</div>
            <div className="font-semibold">
              {CATEGORY_LABEL[topCategory.category] ?? topCategory.category}
              <span className="ml-2 text-xs text-muted-foreground font-normal tabular-nums">
                {topShare}% of total
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendIcon({ pct }: { pct: number }) {
  if (pct > 0.05)  return <TrendingUp   className="w-4 h-4 text-rose-500" />;
  if (pct < -0.05) return <TrendingDown className="w-4 h-4 text-emerald-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function TrendChip({
  pct, priorTotal, windowKey,
}: {
  pct: number | null;
  priorTotal: number;
  windowKey: WindowKey;
}) {
  if (windowKey === "all") return null;
  if (pct === null) {
    if (priorTotal === 0) {
      return <Badge variant="outline" className="text-[10px] gap-1">New this period</Badge>;
    }
    return null;
  }
  const isUp   = pct > 0.05;
  const isDown = pct < -0.05;
  const cls = isUp
    ? "border-rose-500/40 text-rose-700 dark:text-rose-400"
    : isDown
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      : "";
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 tabular-nums ${cls}`} title={`${priorTotal} in prior ${WINDOW_LABEL[windowKey].toLowerCase()}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : isDown ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {pct > 0 ? "+" : ""}{(pct * 100).toFixed(0)}% vs prior
    </Badge>
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
