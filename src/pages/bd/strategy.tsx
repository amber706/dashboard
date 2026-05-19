// /bd/strategy — BD Strategy Command Center.
//
// Pick a growth goal; the page ranks every referring account by the
// goal-specific score and surfaces each account's segment, scores,
// strongest lag pattern, recommended next action, and the plain-English
// reasoning behind it. Backed by bd-account-strategy.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, RefreshCw, ArrowLeft, Target, Sparkles, ChevronDown, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

interface LagResult {
  lag_0: number; lag_30: number; lag_60: number; lag_90: number;
  best_lag: number | null; pair_count: number;
}
interface AccountStrategy {
  id: string; name: string;
  total_referrals_in: number; total_admits: number;
  total_refer_outs: number; total_meetings: number;
  total_calls?: number;
  admits_by_loc: Record<string, number>;
  last_meeting: string | null; last_call?: string | null;
  last_referral_in: string | null;
  last_refer_out: string | null; last_admit: string | null;
  recent_referrals_in: number; prior_referrals_in: number;
  recent_admits: number; prior_admits: number;
  months_with_data: number;
  correlations: Record<string, LagResult>;
  scores: {
    relationship_effectiveness: number;
    reciprocity: number;
    admit_potential: number;
    php_admit_potential: number;
    residential_admit_potential: number;
    iop_admit_potential: number;
    follow_up_priority: number;
    dormancy_risk: number;
    effort_to_return: number;
    strategic_fit: number;
  };
  segment: string;
  confidence: "High" | "Moderate" | "Low";
  // v2 — the BD activity (call/meeting/refer-out) whose historical
  // correlation with outcomes is strongest for this account. null when
  // no driver clears the minimum signal bar; recommended_action then
  // falls back to a segment-based default.
  primary_driver?: "call" | "meeting" | "refer_out" | null;
  primary_driver_reason?: string;
  insight: string;
  recommended_action: string;
  action_detail: string;
  talking_points: string[];
}
interface StrategyResponse {
  ok: boolean; window: { months: number; start: string; end: string };
  months: string[]; accounts: AccountStrategy[];
}

// Goal definitions. Each goal picks the primary score to rank by + a
// short rationale shown on each row + a filter to exclude accounts the
// goal isn't about (e.g. PHP goal excludes accounts with zero PHP signal).
const GOALS = [
  { key: "php",         label: "Drive more PHP admits",       sortBy: "php_admit_potential",         minScore: 1,  description: "Ranks accounts by historical PHP admits + meeting/refer-out correlation to PHP." },
  { key: "residential", label: "Drive more Residential admits", sortBy: "residential_admit_potential", minScore: 1, description: "Ranks accounts by historical Residential admits + correlation signals." },
  { key: "iop",         label: "Drive more IOP admits",        sortBy: "iop_admit_potential",         minScore: 1,  description: "Ranks accounts by historical IOP admits + correlation signals." },
  { key: "referrals",   label: "Increase referrals in",        sortBy: "admit_potential",             minScore: 0,  description: "Ranks by overall admit potential — accounts most likely to keep producing referrals." },
  { key: "reciprocity", label: "Improve referral reciprocity", sortBy: "reciprocity",                 minScore: 20, description: "Accounts where refer-outs are associated with referrals/admits coming back." },
  { key: "dormant",     label: "Reactivate dormant accounts",  sortBy: "dormancy_risk",               minScore: 30, description: "High historical value, low recent activity. Re-engagement candidates." },
  { key: "low_return",  label: "Reduce low-return BD activity", sortBy: "effort_to_return",           minScore: 60, description: "Accounts consuming BD time without meaningful return. Candidates to deprioritize." },
  { key: "followup",    label: "Top accounts for follow-up this week", sortBy: "follow_up_priority", minScore: 0,  description: "Combines admit potential + meeting recency + recent referrals." },
] as const;
type GoalKey = typeof GOALS[number]["key"];

// Available segment chips for the filter row.
const SEGMENTS = [
  "High-Value Converter",
  "PHP Growth Account",
  "Residential Growth Account",
  "Reciprocity Opportunity",
  "Active but Not Converting",
  "Referral Volume, Low Admit Conversion",
  "Dormant but Historically Valuable",
  "High Effort, Low Return",
  "Low Activity, High Potential",
  "New Relationship, Insufficient Data",
];

const SEGMENT_TONE: Record<string, string> = {
  "High-Value Converter":              "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5",
  "PHP Growth Account":                "border-blue-500/40 text-blue-700 dark:text-blue-400 bg-blue-500/5",
  "Residential Growth Account":        "border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/5",
  "Reciprocity Opportunity":           "border-cyan-500/40 text-cyan-700 dark:text-cyan-400 bg-cyan-500/5",
  "Active but Not Converting":         "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5",
  "Referral Volume, Low Admit Conversion": "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5",
  "Dormant but Historically Valuable": "border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-500/5",
  "High Effort, Low Return":           "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5",
  "Low Activity, High Potential":      "border-indigo-500/40 text-indigo-700 dark:text-indigo-400 bg-indigo-500/5",
  "New Relationship, Insufficient Data": "border-slate-500/40 text-slate-600 dark:text-slate-400 bg-slate-500/5",
};

const CONFIDENCE_TONE: Record<string, string> = {
  High:     "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  Moderate: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  Low:      "border-slate-500/40 text-slate-600 dark:text-slate-400",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function BdStrategy() {
  const [goal, setGoal] = useState<GoalKey>("php");
  const [months, setMonths] = useState<number>(18);
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [data, setData] = useState<StrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-strategy`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ months }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [months]);
  useEffect(() => { load(); }, [load]);

  const activeGoal = useMemo(() => GOALS.find((g) => g.key === goal) ?? GOALS[0], [goal]);

  // Ranked + filtered accounts for the current goal.
  const ranked = useMemo(() => {
    if (!data) return [];
    const sortKey = activeGoal.sortBy as keyof AccountStrategy["scores"];
    const minScore = activeGoal.minScore;
    let rows = data.accounts.filter((a) => (a.scores[sortKey] ?? 0) >= minScore);
    if (segmentFilter !== "all") rows = rows.filter((a) => a.segment === segmentFilter);
    if (confidenceFilter !== "all") rows = rows.filter((a) => a.confidence === confidenceFilter);
    rows = rows.slice().sort((a, b) => (b.scores[sortKey] ?? 0) - (a.scores[sortKey] ?? 0));
    return rows.slice(0, 50);
  }, [data, activeGoal, segmentFilter, confidenceFilter]);

  // Segment distribution for the chip row.
  const segmentCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const a of data.accounts) m.set(a.segment, (m.get(a.segment) ?? 0) + 1);
    return m;
  }, [data]);

  function toggleExpand(id: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Strategy Command Center"
      subtitle="Pick a growth goal — the engine ranks accounts by where BD attention will move the needle. Segments, scores, and recommended actions are derived from 18 months of meeting / referral / admit history."
      maxWidth={1700}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd"><Button variant="outline" size="sm" className="gap-1.5 h-9"><ArrowLeft className="w-3.5 h-3.5" /> Performance</Button></Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </Button>
        </div>
      }
    >
      {/* Goal + time-frame picker */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" /> Pick your goal
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Window</span>
              {[6, 12, 18, 24].map((n) => (
                <Button
                  key={n} size="sm"
                  variant={months === n ? "default" : "outline"}
                  onClick={() => setMonths(n)}
                  className="h-7 text-[10px] px-2"
                  disabled={loading}
                >
                  {n}mo
                </Button>
              ))}
            </div>
          </CardTitle>
          <p className="text-xs text-muted-foreground">{activeGoal.description} Scoring + correlations are recomputed across the selected window — shorter windows surface recent shifts, longer windows give more stable signal.</p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            {GOALS.map((g) => (
              <Button
                key={g.key} size="sm"
                variant={goal === g.key ? "default" : "outline"}
                onClick={() => setGoal(g.key)}
                className="h-8 text-xs"
              >
                {g.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Segment</span>
        <Button size="sm" variant={segmentFilter === "all" ? "default" : "outline"} onClick={() => setSegmentFilter("all")} className="h-7 text-xs">All</Button>
        {SEGMENTS.map((s) => {
          const n = segmentCounts.get(s) ?? 0;
          if (n === 0) return null;
          return (
            <Button key={s} size="sm" variant={segmentFilter === s ? "default" : "outline"} onClick={() => setSegmentFilter(s)} className="h-7 text-xs gap-1">
              {s} <Badge variant="outline" className="text-[9px]">{n}</Badge>
            </Button>
          );
        })}
        <span className="mx-2 h-4 w-px bg-border" />
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Confidence</span>
        {["all", "High", "Moderate", "Low"].map((c) => (
          <Button key={c} size="sm" variant={confidenceFilter === c ? "default" : "outline"} onClick={() => setConfidenceFilter(c)} className="h-7 text-xs">{c}</Button>
        ))}
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}
      {!data && loading && <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Crunching 18 months of activity…</CardContent></Card>}

      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" /> Recommended accounts
              <Badge variant="outline" className="text-[10px]">{ranked.length} shown of {data.accounts.length} analyzed</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked by <span className="font-medium">{activeGoal.label}</span>. Click any row to expand the reasoning, scores, and talking points.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {ranked.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No accounts match the current filters. Loosen segment or confidence.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-2 w-8">#</th>
                    <th className="text-left py-2 pr-2 w-6"></th>
                    <th className="text-left py-2 pr-3">Account</th>
                    <th className="text-left py-2 pr-3">Segment</th>
                    <th className="text-right py-2 pr-3">Score</th>
                    <th className="text-right py-2 pr-3">R / A</th>
                    <th className="text-right py-2 pr-3">Calls / Mtg / RO</th>
                    <th className="text-left py-2 pr-3">Best lag</th>
                    <th className="text-left py-2 pr-3">Driver</th>
                    <th className="text-left py-2 pr-3">Recommended action</th>
                    <th className="text-left py-2 pr-3">Conf</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((a, i) => {
                    const isOpen = expanded.has(a.id);
                    const sortKey = activeGoal.sortBy as keyof AccountStrategy["scores"];
                    const score = a.scores[sortKey] ?? 0;
                    // Pick the most relevant best-lag value for the active goal.
                    const goalLagKey =
                      goal === "php" ? "meetings_to_php" :
                      goal === "residential" ? "meetings_to_residential" :
                      goal === "iop" ? "meetings_to_iop" :
                      goal === "reciprocity" ? "refer_outs_to_admits" :
                      "meetings_to_admits";
                    const bestLag = a.correlations[goalLagKey]?.best_lag;
                    return (
                      <>
                        <tr key={a.id} className={`border-t cursor-pointer hover:bg-accent/30 ${isOpen ? "bg-accent/20" : ""}`} onClick={() => toggleExpand(a.id)}>
                          <td className="py-2 pr-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-2">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                          <td className="py-2 pr-3 font-medium">{a.name}</td>
                          <td className="py-2 pr-3"><Badge variant="outline" className={`text-[10px] ${SEGMENT_TONE[a.segment] ?? ""}`}>{a.segment}</Badge></td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold">{score}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{a.total_referrals_in} / {a.total_admits}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{a.total_calls ?? 0} / {a.total_meetings} / {a.total_refer_outs}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{bestLag ? `${bestLag}d` : "—"}</td>
                          <td className="py-2 pr-3"><DriverChip driver={a.primary_driver ?? null} /></td>
                          <td className="py-2 pr-3 text-xs">{a.recommended_action}</td>
                          <td className="py-2 pr-3"><Badge variant="outline" className={`text-[10px] ${CONFIDENCE_TONE[a.confidence] ?? ""}`}>{a.confidence}</Badge></td>
                          <td className="py-2 pr-3 text-right">
                            <Link href={`/bd/account?id=${a.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline">Open →</Link>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-accent/10">
                            <td colSpan={12} className="py-3 pl-10 pr-4">
                              <ExpandedDetail a={a} goal={goal} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// Expanded row: insight + scores + correlations + talking points.
function ExpandedDetail({ a, goal }: { a: AccountStrategy; goal: GoalKey }) {
  // Pick the two most relevant correlation pairs for the active goal.
  const focusPairs: Array<{ key: keyof AccountStrategy["correlations"]; label: string }> =
    goal === "php" ? [
      { key: "meetings_to_php", label: "Meetings → PHP admits" },
      { key: "refer_outs_to_php", label: "Refer-outs → PHP admits" },
    ]
    : goal === "residential" ? [
      { key: "meetings_to_residential", label: "Meetings → Residential admits" },
      { key: "refer_outs_to_residential", label: "Refer-outs → Residential admits" },
    ]
    : goal === "iop" ? [
      { key: "meetings_to_iop", label: "Meetings → IOP admits" },
      { key: "refer_outs_to_iop", label: "Refer-outs → IOP admits" },
    ]
    : goal === "reciprocity" ? [
      { key: "refer_outs_to_referrals_in", label: "Refer-outs → Referrals in" },
      { key: "refer_outs_to_admits", label: "Refer-outs → Admits" },
    ]
    : [
      { key: "meetings_to_referrals_in", label: "Meetings → Referrals in" },
      { key: "meetings_to_admits", label: "Meetings → Admits" },
    ];

  return (
    <div className="space-y-3">
      <p className="text-sm">{a.insight}</p>
      {a.primary_driver && (
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span className="font-medium uppercase tracking-wide text-[10px]">Primary driver:</span>
          <DriverChip driver={a.primary_driver} />
          <span>{a.primary_driver_reason}</span>
        </div>
      )}
      <p className="text-sm text-muted-foreground italic">{a.action_detail}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Scores</h4>
          <ul className="space-y-0.5 text-xs">
            <ScoreRow label="Admit potential"           value={a.scores.admit_potential} />
            <ScoreRow label="Relationship effectiveness" value={a.scores.relationship_effectiveness} />
            <ScoreRow label="Reciprocity"                 value={a.scores.reciprocity} />
            <ScoreRow label="PHP potential"               value={a.scores.php_admit_potential} />
            <ScoreRow label="Residential potential"       value={a.scores.residential_admit_potential} />
            <ScoreRow label="IOP potential"               value={a.scores.iop_admit_potential} />
            <ScoreRow label="Follow-up priority"          value={a.scores.follow_up_priority} />
            <ScoreRow label="Dormancy risk"               value={a.scores.dormancy_risk} />
            <ScoreRow label="Effort-to-return (lower=better)" value={a.scores.effort_to_return} invert />
          </ul>
        </section>

        <section>
          <h4
            className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 cursor-help"
            title={
              "Each percentage = of the months where this account had the activity, what % of those months also had the outcome at that lag.\n\n" +
              "0d  = same month (coincided, not caused)\n" +
              "30d = activity precedes outcome by ~1 month\n" +
              "60d = ~2 months\n" +
              "90d = ~3 months\n\n" +
              "'X obs' = months with the activity in the window — small samples are unreliable, hence the Confidence chip. The green highlight is the strongest lag the engine could find (≥25% rate, ≥2 observations)."
            }
          >
            Lag patterns (goal-relevant) ⓘ
          </h4>
          <ul className="space-y-1.5 text-xs">
            {focusPairs.map((p) => {
              const c = a.correlations[p.key];
              return (
                <li key={p.key}>
                  <div className="font-medium">{p.label}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <LagPill label="0d"  rate={c.lag_0}  active={c.best_lag === 0} />
                    <LagPill label="30d" rate={c.lag_30} active={c.best_lag === 30} />
                    <LagPill label="60d" rate={c.lag_60} active={c.best_lag === 60} />
                    <LagPill label="90d" rate={c.lag_90} active={c.best_lag === 90} />
                    <span className="text-muted-foreground text-[10px]">{c.pair_count} obs</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Talking points</h4>
          {a.talking_points.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-0.5 text-xs list-disc pl-4">
              {a.talking_points.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <div className="mt-3 text-[10px] text-muted-foreground space-y-0.5">
            <div>Last meeting: {fmtDate(a.last_meeting)}</div>
            <div>Last referral in: {fmtDate(a.last_referral_in)}</div>
            <div>Last admit: {fmtDate(a.last_admit)}</div>
            <div>Last refer-out: {fmtDate(a.last_refer_out)}</div>
            <div>Months with data: {a.months_with_data}</div>
          </div>
        </section>
      </div>

      {Object.keys(a.admits_by_loc).length > 0 && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Admits by LOC</h4>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.entries(a.admits_by_loc).sort((x, y) => y[1] - x[1]).map(([loc, n]) => (
              <Badge key={loc} variant="outline" className="text-[10px]">{loc}: {n}</Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ScoreRow({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  // Tone: by default high = good. `invert` flips it (used for effort-to-return).
  const goodHigh = !invert;
  const tone =
    (goodHigh && value >= 60) || (!goodHigh && value <= 30) ? "text-emerald-600 dark:text-emerald-400"
    : (goodHigh && value <= 25) || (!goodHigh && value >= 70) ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";
  return (
    <li className="flex items-center gap-2">
      <span className="flex-1 truncate">{label}</span>
      <span className={`tabular-nums font-medium ${tone}`}>{value}</span>
    </li>
  );
}

function LagPill({ label, rate, active }: { label: string; rate: number; active: boolean }) {
  const pct = Math.round(rate * 100);
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border tabular-nums ${active ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold" : "border-border text-muted-foreground"}`}>
      {label}: {pct}%
    </span>
  );
}

// Color-coded chip for the primary BD driver. "—" when no driver has a
// strong enough signal — those rows fall back to a segment-based action.
function DriverChip({ driver }: { driver: "call" | "meeting" | "refer_out" | null }) {
  if (!driver) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<string, { label: string; tone: string }> = {
    call:      { label: "Call",      tone: "border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/5" },
    meeting:   { label: "Meeting",   tone: "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/5" },
    refer_out: { label: "Refer-out", tone: "border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-500/5" },
  };
  const m = map[driver];
  return <Badge variant="outline" className={`text-[10px] ${m.tone}`}>{m.label}</Badge>;
}
