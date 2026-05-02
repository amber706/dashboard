import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Users, Loader2, Trophy, TrendingUp, TrendingDown, Phone,
  GraduationCap, Activity, Bot, ChevronUp, ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/dashboard/PageShell";

interface Specialist {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_ai_agent: boolean;
  // Computed:
  calls_30d: number;
  avg_score_30d: number | null;
  won_30d: number;
  lost_30d: number;
  conversion_rate_30d: number | null;
  open_assignments: number;
  completed_assignments_30d: number;
  last_call_at: string | null;
  avg_days_to_admit: number | null;
}

type SortKey = "calls" | "score" | "conversion" | "training" | "name";

function fmtTime(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function scoreColor(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-rose-700 dark:text-rose-400";
}

export default function TeamPage() {
  const [rows, setRows] = useState<Specialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("calls");
  const [sortAsc, setSortAsc] = useState(false);
  const [showBots, setShowBots] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Pull every active specialist/manager/admin profile.
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_ai_agent")
      .eq("is_active", true)
      .in("role", ["specialist", "manager", "admin"])
      .order("full_name");
    if (pErr || !profiles) {
      setError(pErr?.message ?? "no profiles");
      setLoading(false);
      return;
    }

    // For each profile, batch-pull their stats. We do this client-side
    // with N small queries — not ideal at scale but fine for the ~15
    // person Cornerstone team. Optimize via a view if it grows.
    const enriched: Specialist[] = await Promise.all(profiles.map(async (p: any) => {
      const [callsRes, scoresRes, leadsRes, openAssignRes, completedAssignRes, lastCallRes] = await Promise.all([
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .eq("specialist_id", p.id).gte("started_at", since),
        supabase.from("call_scores")
          .select("composite_score, call:call_sessions!inner(specialist_id, started_at)")
          .eq("call.specialist_id", p.id)
          .gte("call.started_at", since),
        // Closed leads attributed via last_touch_call_id to this specialist.
        // Also pull first_touch_call.started_at + outcome_set_at so we can
        // compute speed-to-admit in the same pass.
        supabase.from("leads")
          .select(`outcome_category, outcome_set_at,
            last_touch_call:call_sessions!leads_last_touch_call_id_fkey(specialist_id),
            first_touch_call:call_sessions!leads_first_touch_call_id_fkey(started_at)`)
          .in("outcome_category", ["won", "lost"])
          .gte("outcome_set_at", since),
        supabase.from("training_assignments").select("id", { count: "exact", head: true })
          .eq("specialist_id", p.id).in("status", ["assigned", "in_progress"]),
        supabase.from("training_assignments").select("id", { count: "exact", head: true })
          .eq("specialist_id", p.id).eq("status", "completed").gte("completed_at", since),
        supabase.from("call_sessions").select("started_at")
          .eq("specialist_id", p.id).order("started_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      ]);

      const scoreVals = ((scoresRes.data ?? []) as any[]).map((r) => r.composite_score).filter((n): n is number => n != null);
      const avg = scoreVals.length > 0 ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : null;

      // Filter the closed-leads result by last_touch_call.specialist_id.
      // Same loop also collects days-to-admit for won leads with both timestamps.
      let won = 0, lost = 0;
      const daysToAdmit: number[] = [];
      for (const l of (leadsRes.data ?? []) as any[]) {
        const ltc = Array.isArray(l.last_touch_call) ? l.last_touch_call[0] : l.last_touch_call;
        if (ltc?.specialist_id !== p.id) continue;
        if (l.outcome_category === "won") {
          won++;
          const ftc = Array.isArray(l.first_touch_call) ? l.first_touch_call[0] : l.first_touch_call;
          if (l.outcome_set_at && ftc?.started_at) {
            const d = (new Date(l.outcome_set_at).getTime() - new Date(ftc.started_at).getTime()) / (1000 * 60 * 60 * 24);
            if (d >= 0) daysToAdmit.push(d);
          }
        } else if (l.outcome_category === "lost") {
          lost++;
        }
      }
      const closed = won + lost;
      const conv = closed > 0 ? Math.round((won / closed) * 100) : null;
      const avgDaysToAdmit = daysToAdmit.length > 0
        ? Math.round(daysToAdmit.reduce((a, b) => a + b, 0) / daysToAdmit.length * 10) / 10
        : null;

      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        role: p.role,
        is_ai_agent: !!p.is_ai_agent,
        calls_30d: callsRes.count ?? 0,
        avg_score_30d: avg,
        won_30d: won,
        lost_30d: lost,
        conversion_rate_30d: conv,
        open_assignments: openAssignRes.count ?? 0,
        completed_assignments_30d: completedAssignRes.count ?? 0,
        last_call_at: (lastCallRes.data as any)?.started_at ?? null,
        avg_days_to_admit: avgDaysToAdmit,
      };
    }));

    setRows(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const teamConv = useMemo(() => {
    const w = rows.reduce((a, r) => a + r.won_30d, 0);
    const l = rows.reduce((a, r) => a + r.lost_30d, 0);
    return (w + l) > 0 ? Math.round((w / (w + l)) * 100) : null;
  }, [rows]);

  const filtered = useMemo(() => {
    return showBots ? rows : rows.filter((r) => !r.is_ai_agent);
  }, [rows, showBots]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return ((a.full_name ?? a.email ?? "") < (b.full_name ?? b.email ?? "") ? 1 : -1) * dir * -1;
        case "calls":
          return (a.calls_30d - b.calls_30d) * dir;
        case "score":
          return ((a.avg_score_30d ?? -1) - (b.avg_score_30d ?? -1)) * dir;
        case "conversion":
          return ((a.conversion_rate_30d ?? -1) - (b.conversion_rate_30d ?? -1)) * dir;
        case "training":
          return (a.open_assignments - b.open_assignments) * dir;
      }
    });
  }, [filtered, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortHeader({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" | "center" }) {
    const active = sortKey === k;
    return (
      <th className={`p-2 text-${align}`}>
        <button
          onClick={() => toggleSort(k)}
          className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground inline-flex items-center gap-1"
        >
          {label}
          {active && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
      </th>
    );
  }

  return (
    <PageShell
      number="01"
      eyebrow="ROSTER"
      title="Team"
      subtitle={<>Active specialists, managers, and admins. All stats are last 30 days. Team conversion rate: <span className="font-medium text-[#F4EFE6]">{teamConv == null ? "—" : `${teamConv}%`}</span>.</>}
      actions={
        <Button size="sm" variant={showBots ? "default" : "outline"} onClick={() => setShowBots(!showBots)} className="gap-1.5 h-9">
          <Bot className="w-3.5 h-3.5" /> {showBots ? "Hide bots" : "Show bots"}
        </Button>
      }
    >

      {loading && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading team stats…
        </CardContent></Card>
      )}
      {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <SortHeader label="Specialist" k="name" align="left" />
                    <SortHeader label="Calls (30d)" k="calls" />
                    <SortHeader label="Avg score" k="score" />
                    <SortHeader label="Conversion" k="conversion" />
                    <th className="p-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Wins / Losses</th>
                    <th className="p-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Days to admit</th>
                    <SortHeader label="Open training" k="training" />
                    <th className="p-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Last call</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sorted.map((r) => {
                    const aboveTeam = r.conversion_rate_30d != null && teamConv != null && r.conversion_rate_30d > teamConv;
                    const belowTeam = r.conversion_rate_30d != null && teamConv != null && r.conversion_rate_30d < teamConv;
                    return (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {r.is_ai_agent && <Bot className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                            <div className="min-w-0">
                              <Link href={`/ops/specialist/${r.id}`} className="text-sm font-medium truncate hover:underline block">
                                {r.full_name ?? r.email ?? "Unknown"}
                              </Link>
                              <div className="text-[11px] text-muted-foreground capitalize">{r.role}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 text-right tabular-nums">{r.calls_30d}</td>
                        <td className={`p-2 text-right tabular-nums font-medium ${scoreColor(r.avg_score_30d)}`}>{r.avg_score_30d ?? "—"}</td>
                        <td className="p-2 text-right">
                          <span className="inline-flex items-center gap-1 tabular-nums font-medium">
                            {r.conversion_rate_30d == null ? "—" : `${r.conversion_rate_30d}%`}
                            {aboveTeam && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                            {belowTeam && <TrendingDown className="w-3 h-3 text-rose-500" />}
                          </span>
                        </td>
                        <td className="p-2 text-right text-xs text-muted-foreground tabular-nums">
                          <span className="text-emerald-700 dark:text-emerald-400">{r.won_30d}</span>
                          <span> / </span>
                          <span className="text-rose-700 dark:text-rose-400">{r.lost_30d}</span>
                        </td>
                        <td className="p-2 text-right tabular-nums text-xs text-muted-foreground">
                          {r.avg_days_to_admit == null ? "—" : `${r.avg_days_to_admit}d`}
                        </td>
                        <td className="p-2 text-right">
                          {r.open_assignments > 0
                            ? <Badge variant="outline" className="gap-1 text-[10px]">
                                <GraduationCap className="w-3 h-3" /> {r.open_assignments}
                              </Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-2 text-right text-xs">
                          <ActivityBadge lastCallAt={r.last_call_at} />
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtTime(r.last_call_at)}</div>
                        </td>
                      </tr>
                    );
                  })}
                  {sorted.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">No team members.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// Surfaces call-activity recency as a colored dot.
// active = last call <1h ago, idle short = 1-4h, idle long = 4-24h, cold = >24h or never
function ActivityBadge({ lastCallAt }: { lastCallAt: string | null }) {
  if (!lastCallAt) {
    return <Badge variant="outline" className="text-[10px] border-slate-500/40 text-slate-600 dark:text-slate-400">never called</Badge>;
  }
  const ageMs = Date.now() - new Date(lastCallAt).getTime();
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) {
    return <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 gap-1">
      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> active
    </Badge>;
  }
  if (hours < 4) {
    return <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">idle {Math.floor(hours)}h</Badge>;
  }
  if (hours < 24) {
    return <Badge variant="outline" className="text-[10px] border-slate-500/40 text-slate-600 dark:text-slate-400">idle {Math.floor(hours)}h</Badge>;
  }
  const days = Math.floor(hours / 24);
  return <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-700 dark:text-rose-400">cold {days}d</Badge>;
}
