import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Award, AlertTriangle, TrendingDown, Trophy, ShieldAlert, Loader2,
  ChevronRight, Clock, MessageSquare, Save, GraduationCap, Phone,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ScoredCall {
  id: string;
  call_session_id: string;
  composite_score: number | null;
  needs_supervisor_review: boolean;
  compliance_flags: any[] | null;
  coaching_takeaways: { what_went_well?: string[]; what_to_try?: string[] } | null;
  created_at: string;
  call: {
    id: string;
    caller_name: string | null;
    caller_phone_normalized: string | null;
    started_at: string | null;
    talk_seconds: number | null;
    manager_notes: string | null;
    specialist: { id: string; full_name: string | null; email: string | null } | null;
  } | null;
}

interface SpecialistTrend {
  specialist_id: string;
  specialist_name: string;
  avg_7d: number;
  avg_prior_7d: number;
  delta: number;
  call_count_7d: number;
}

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${r}s`;
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

const WORST_THRESHOLD = 50;     // composite <= 50 → worst
const BEST_THRESHOLD = 85;      // composite >= 85 → best
const TREND_DROP_THRESHOLD = 8; // 7d avg dropped by more than this vs prior 7d

export default function OpsCoaching() {
  const [scores, setScores] = useState<ScoredCall[]>([]);
  const [trends, setTrends] = useState<SpecialistTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Pull last 14d of scores so we can build both the curated feeds
    // (which look at last 7d) AND the trend comparison (current 7d vs prior 7d).
    const { data, error: err } = await supabase
      .from("call_scores")
      .select(`
        id, call_session_id, composite_score, needs_supervisor_review,
        compliance_flags, coaching_takeaways, created_at,
        call:call_sessions!inner(
          id, caller_name, caller_phone_normalized, started_at, talk_seconds, manager_notes,
          specialist:profiles!call_sessions_specialist_id_fkey(id, full_name, email)
        )
      `)
      .gte("created_at", since14d)
      .order("created_at", { ascending: false })
      .limit(500);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const rows = ((data ?? []) as any[]).map((r) => ({
      ...r,
      call: r.call ? { ...r.call, specialist: Array.isArray(r.call.specialist) ? r.call.specialist[0] : r.call.specialist } : null,
    })) as ScoredCall[];
    setScores(rows);

    // Build per-specialist trend.
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trendMap = new Map<string, { name: string; cur: number[]; prior: number[] }>();
    for (const s of rows) {
      const sp = s.call?.specialist;
      if (!sp?.id || s.composite_score == null) continue;
      const ts = new Date(s.created_at).getTime();
      const bucket = trendMap.get(sp.id) ?? { name: sp.full_name ?? sp.email ?? "Unknown", cur: [], prior: [] };
      if (ts > sevenDaysAgo) bucket.cur.push(s.composite_score);
      else bucket.prior.push(s.composite_score);
      trendMap.set(sp.id, bucket);
    }
    const trendsBuilt: SpecialistTrend[] = [];
    for (const [id, b] of trendMap.entries()) {
      if (b.cur.length < 3 || b.prior.length < 3) continue; // need enough data
      const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
      const cur = avg(b.cur), prior = avg(b.prior);
      const delta = cur - prior;
      if (delta < -TREND_DROP_THRESHOLD) {
        trendsBuilt.push({ specialist_id: id, specialist_name: b.name, avg_7d: cur, avg_prior_7d: prior, delta, call_count_7d: b.cur.length });
      }
    }
    trendsBuilt.sort((a, b) => a.delta - b.delta);
    setTrends(trendsBuilt);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Audit: this surface exposes caller PHI across many calls at once.
  useEffect(() => { logAudit("view", "coaching_feed", null, { surface: "ops_coaching" }); }, []);

  const buckets = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const last7 = scores.filter((s) => new Date(s.created_at).getTime() > sevenDaysAgo);

    const compliance = last7
      .filter((s) => Array.isArray(s.compliance_flags) && s.compliance_flags.length > 0)
      .slice(0, 12);

    const worst = last7
      .filter((s) => s.composite_score != null && s.composite_score <= WORST_THRESHOLD)
      .sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0))
      .slice(0, 12);

    const best = last7
      .filter((s) => s.composite_score != null && s.composite_score >= BEST_THRESHOLD)
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0))
      .slice(0, 8);

    return { compliance, worst, best, totalLast7: last7.length };
  }, [scores]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Award className="w-6 h-6" /> Coaching feed
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curated coachable moments from the last 7 days. Compliance flags and worst calls first; trends and wins below.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Calls scored (7d)" value={buckets.totalLast7} />
        <Tile label="Compliance flags" value={buckets.compliance.length} accent={buckets.compliance.length > 0 ? "rose" : undefined} />
        <Tile label="Worst calls" value={buckets.worst.length} accent={buckets.worst.length > 0 ? "amber" : undefined} />
        <Tile label="Specialists trending down" value={trends.length} accent={trends.length > 0 ? "rose" : undefined} />
      </div>

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading coaching feed…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {!loading && !error && (
        <>
          {/* Compliance flags — most urgent */}
          <Section
            icon={<ShieldAlert className="w-4 h-4 text-rose-600" />}
            title="Compliance flags"
            subtitle="Anything the AI flagged as a regulatory or HIPAA issue. Triage first."
            empty="No compliance flags in the last 7 days. Nice."
            items={buckets.compliance}
            onSaved={load}
            accentClass="border-l-rose-500"
            highlightFlags
          />

          {/* Worst calls */}
          <Section
            icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            title="Worst calls — likely coachable"
            subtitle={`Composite ≤ ${WORST_THRESHOLD}. Listen first; figure out the pattern; coach the specialist.`}
            empty="No low-score calls in the last 7 days."
            items={buckets.worst}
            onSaved={load}
            accentClass="border-l-amber-500"
          />

          {/* Specialists trending down */}
          {trends.length > 0 && (
            <Card className="border-l-4 border-l-rose-500">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-rose-600" /> Specialists trending down
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {trends.map((t) => (
                  <div key={t.specialist_id} className="border rounded-md p-3 text-sm flex items-center gap-3">
                    <Link href={`/ops/specialist/${t.specialist_id}`} className="flex-1 min-w-0 hover:underline">
                      <div className="font-medium">{t.specialist_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        7d avg <span className={scoreColor(t.avg_7d)}>{t.avg_7d}</span> vs prior 7d <span className="text-foreground">{t.avg_prior_7d}</span>
                        {" · "}{t.call_count_7d} call{t.call_count_7d === 1 ? "" : "s"}
                      </div>
                    </Link>
                    <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">
                      {t.delta} pts
                    </Badge>
                    <Link href={`/ops/training-assignments?specialist=${t.specialist_id}`}>
                      <Button size="sm" variant="outline" className="gap-1 text-xs">
                        <GraduationCap className="w-3 h-3" /> Assign training
                      </Button>
                    </Link>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Best of */}
          <Section
            icon={<Trophy className="w-4 h-4 text-emerald-600" />}
            title="Worth celebrating"
            subtitle={`Composite ≥ ${BEST_THRESHOLD}. Worth a Slack shout-out, or use as exemplar in team training.`}
            empty="No standout calls this week — yet."
            items={buckets.best}
            onSaved={load}
            accentClass="border-l-emerald-500"
          />
        </>
      )}
    </div>
  );
}

function Section({ icon, title, subtitle, empty, items, accentClass, highlightFlags, onSaved }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  empty: string;
  items: ScoredCall[];
  accentClass: string;
  highlightFlags?: boolean;
  onSaved: () => void;
}) {
  return (
    <Card className={`border-l-4 ${accentClass}`}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">{icon} {title}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{empty}</p>
        ) : (
          <div className="space-y-2">
            {items.map((s) => (
              <CoachingRow key={s.id} score={s} highlightFlags={!!highlightFlags} onSaved={onSaved} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoachingRow({ score, highlightFlags, onSaved }: {
  score: ScoredCall;
  highlightFlags: boolean;
  onSaved: () => void;
}) {
  const c = score.call;
  if (!c) return null;
  const callerLabel = c.caller_name ?? c.caller_phone_normalized ?? "Unknown";
  const specialistLabel = c.specialist?.full_name ?? c.specialist?.email ?? "—";
  const specialistId = c.specialist?.id ?? null;
  const flag = (score.compliance_flags as any[] | null)?.[0];

  return (
    <div className="border rounded-md p-3 text-sm space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/live/${c.id}`} className="hover:underline">
              <span className={`text-base font-semibold tabular-nums ${scoreColor(score.composite_score)}`}>{score.composite_score ?? "—"}</span>
            </Link>
            {specialistId
              ? <Link href={`/ops/specialist/${specialistId}`} className="font-medium hover:underline">{specialistLabel}</Link>
              : <span className="font-medium">{specialistLabel}</span>}
            <Badge variant="outline" className="text-[10px]">{callerLabel}</Badge>
            {score.needs_supervisor_review && (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">needs review</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            <Clock className="w-3 h-3" /> {fmtTime(c.started_at)}
            <span>· <Phone className="w-3 h-3 inline-block" /> {fmtDur(c.talk_seconds)}</span>
          </div>
        </div>
      </div>

      {highlightFlags && flag && (
        <div className="text-xs bg-rose-500/10 text-rose-700 dark:text-rose-400 rounded p-2 border border-rose-500/30">
          <div className="font-semibold">{flag.flag ?? "Compliance flag"}</div>
          {flag.evidence && <div className="italic mt-0.5">"{flag.evidence}"</div>}
        </div>
      )}

      {!highlightFlags && score.coaching_takeaways?.what_to_try?.[0] && (
        <div className="text-xs text-muted-foreground italic">
          AI suggests: {score.coaching_takeaways.what_to_try[0]}
        </div>
      )}

      <ManagerNoteEditor callId={c.id} initial={c.manager_notes} onSaved={onSaved} />
    </div>
  );
}

function ManagerNoteEditor({ callId, initial, onSaved }: {
  callId: string;
  initial: string | null;
  onSaved: () => void;
}) {
  const [val, setVal] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const dirty = val.trim() !== (initial ?? "").trim();

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("call_sessions")
      .update({ manager_notes: val.trim() || null })
      .eq("id", callId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Coaching note saved" });
    logAudit("edit", "call_session", callId, { field: "manager_notes", surface: "coaching_feed" });
    onSaved();
  }

  if (!open && !initial) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-primary hover:underline flex items-center gap-1"
      >
        <MessageSquare className="w-3 h-3" /> Add coaching note
      </button>
    );
  }

  return (
    <div className="pt-1 border-t">
      <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
        <MessageSquare className="w-3 h-3" /> Coaching note
      </div>
      <Textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="What should this specialist do differently next time?"
        className="min-h-[60px] text-sm"
      />
      {dirty && (
        <div className="mt-1.5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setVal(initial ?? ""); setOpen(!!initial); }}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={save} className="gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: "amber" | "rose" }) {
  const accentClass = accent === "rose"
    ? "border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/15"
    : accent === "amber"
      ? "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15"
      : "";
  return (
    <div className={`border rounded-lg p-3 ${accentClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}
