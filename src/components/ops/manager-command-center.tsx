// Manager Command Center sections.
//
// Five focused cards that replace the older 10-MetricCard grid on
// /ops/overview. Each card owns its own data fetch and refresh cycle —
// keeps blast radius small if any one query gets slow.
//
// Cadence: poll every 15s. Lighter than realtime channels for V1 and
// trivially predictable. Move to channels later if cost becomes an issue.

import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Phone, PhoneIncoming, ShieldAlert, AlertTriangle, ShieldCheck,
  TrendingDown, Clock, GraduationCap, Sparkles, Loader2, Users,
  Coffee, PhoneOff, ChevronRight, Activity, Trophy,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const POLL_INTERVAL_MS = 15_000;

// =============================================================================
// LIVE FLOOR
// Who's working right now + what they're doing.
// =============================================================================

interface AgentRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_ai_agent: boolean;
  status: "on_call" | "available" | "offline";
  current_call_id: string | null;
  current_call_started_at: string | null;
  current_caller_label: string | null;
}

interface ActiveCall {
  id: string;
  ctm_call_id: string;
  caller_name: string | null;
  caller_phone_normalized: string | null;
  started_at: string;
  specialist_id: string | null;
  specialist_name: string | null;
}

function fmtElapsed(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function LiveFloor() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  // Re-render every second for elapsed-time tickers without re-fetching.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    // Active calls: started_at within last 60 minutes AND ended_at is null.
    // (We don't have a true "in_progress" channel from CTM during the call;
    // call_sessions row is created on call start and updated on call end.)
    const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [callsRes, agentsRes] = await Promise.all([
      supabase
        .from("call_sessions")
        .select("id, ctm_call_id, caller_name, caller_phone_normalized, started_at, specialist_id, ended_at")
        .gte("started_at", sixtyAgo)
        .is("ended_at", null)
        .order("started_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, full_name, email, is_ai_agent")
        .eq("is_active", true)
        .in("role", ["specialist", "manager"]),
    ]);

    const calls = (callsRes.data ?? []) as any[];
    // Resolve specialist names for each active call
    const specIds = [...new Set(calls.map((c) => c.specialist_id).filter(Boolean) as string[])];
    const nameById = new Map<string, string>();
    if (specIds.length > 0) {
      const { data: specs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", specIds);
      for (const s of (specs ?? []) as any[]) {
        nameById.set(s.id, s.full_name ?? s.email ?? "Unknown");
      }
    }

    const activeCallList: ActiveCall[] = calls.map((c) => ({
      id: c.id,
      ctm_call_id: c.ctm_call_id,
      caller_name: c.caller_name,
      caller_phone_normalized: c.caller_phone_normalized,
      started_at: c.started_at,
      specialist_id: c.specialist_id,
      specialist_name: c.specialist_id ? nameById.get(c.specialist_id) ?? null : null,
    }));

    // Build agent presence by joining active calls back onto profiles.
    const onCallSpecIds = new Set(specIds);
    const agentList: AgentRow[] = ((agentsRes.data ?? []) as any[]).map((p) => {
      const onCall = onCallSpecIds.has(p.id);
      const myCall = activeCallList.find((c) => c.specialist_id === p.id);
      return {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        is_ai_agent: !!p.is_ai_agent,
        status: onCall ? "on_call"
          : p.is_ai_agent ? "available" // AI agents are always "on" — they pick up automatically
          : "available",
        current_call_id: myCall?.id ?? null,
        current_call_started_at: myCall?.started_at ?? null,
        current_caller_label: myCall?.caller_name ?? myCall?.caller_phone_normalized ?? null,
      };
    });
    // Sort: on-call first (active = most interesting), then alpha
    agentList.sort((a, b) => {
      if (a.status === "on_call" && b.status !== "on_call") return -1;
      if (b.status === "on_call" && a.status !== "on_call") return 1;
      return (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "");
    });

    setAgents(agentList);
    setActiveCalls(activeCallList);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, [load]);

  // Tick once per second to keep elapsed-time tickers fresh.
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const onCall = agents.filter((a) => a.status === "on_call");
  const available = agents.filter((a) => a.status === "available" && !a.is_ai_agent);
  const aiAgents = agents.filter((a) => a.is_ai_agent);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            Live floor
          </span>
          <span className="text-xs text-muted-foreground font-normal flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {onCall.length} on call
            </span>
            <span>{available.length} available</span>
            <span>{activeCalls.length} active call{activeCalls.length === 1 ? "" : "s"}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading floor…
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            {/* Active calls (left) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Phone className="w-3 h-3" /> Active calls
              </div>
              {activeCalls.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">No calls in progress.</div>
              ) : (
                <div className="space-y-1.5">
                  {activeCalls.map((c) => (
                    <Link key={c.id} href={`/live/${c.id}`} className="block">
                      <div className="border rounded-md p-2.5 text-sm hover:bg-accent/30 transition-colors flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.caller_name ?? c.caller_phone_normalized ?? "Unknown caller"}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {c.specialist_name ?? "Unassigned"}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs tabular-nums shrink-0 flex items-center gap-2">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium">{fmtElapsed(c.started_at)}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Agent presence (right) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3 h-3" /> Specialists
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {agents.filter((a) => !a.is_ai_agent).map((a) => (
                  <Link key={a.id} href={`/ops/specialist/${a.id}`} className="block">
                    <div className="border rounded-md p-2 text-xs hover:bg-accent/30 transition-colors flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status === "on_call" ? "bg-emerald-500" : "bg-zinc-500"}`} />
                        <span className="truncate">{a.full_name ?? a.email}</span>
                      </div>
                      {a.status === "on_call" && a.current_call_started_at && (
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {fmtElapsed(a.current_call_started_at)}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
              {aiAgents.length > 0 && (
                <div className="text-[10px] text-muted-foreground pt-1">
                  + {aiAgents.length} AI agent{aiAgents.length === 1 ? "" : "s"} (always-on receptionist)
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// TODAY'S NUMBERS
// 4 KPIs that fit on one row. Click to drill.
// =============================================================================

export function TodayKpis() {
  const [data, setData] = useState<{
    inbound: number;
    answered: number;
    answer_rate: number | null;
    avg_qa: number | null;
    callbacks_pending: number;
  }>({ inbound: 0, answered: 0, answer_rate: null, avg_qa: null, callbacks_pending: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const startISO = startOfDay.toISOString();
      const [inboundRes, answeredRes, scoresRes, callbackRes] = await Promise.all([
        supabase.from("call_sessions").select("id", { count: "exact", head: true }).gte("started_at", startISO),
        supabase.from("call_sessions").select("id", { count: "exact", head: true })
          .gte("started_at", startISO)
          .in("status", ["completed", "in_progress", "transferred"]),
        supabase.from("call_scores").select("composite_score").gte("created_at", startISO),
        supabase.from("call_sessions").select("id", { count: "exact", head: true }).eq("callback_status", "pending"),
      ]);
      if (cancelled) return;
      const scores = (scoresRes.data ?? []).map((s: any) => s.composite_score).filter((n: number | null): n is number => typeof n === "number");
      const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const inbound = inboundRes.count ?? 0;
      const answered = answeredRes.count ?? 0;
      setData({
        inbound,
        answered,
        answer_rate: inbound > 0 ? Math.round((answered / inbound) * 100) : null,
        avg_qa: avg,
        callbacks_pending: callbackRes.count ?? 0,
      });
      setLoading(false);
    }
    load();
    const i = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const kpis = [
    { href: "/ctm-calls?date=today", label: "Inbound today", value: data.inbound, sub: undefined as string | undefined, icon: PhoneIncoming, accent: undefined as "amber" | "rose" | undefined },
    { href: "/ctm-calls?date=today", label: "Answer rate",
      value: data.answer_rate == null ? "—" : `${data.answer_rate}%`,
      sub: `${data.answered} answered`, icon: Phone,
      accent: data.answer_rate != null && data.answer_rate < 60 ? "rose" : data.answer_rate != null && data.answer_rate < 80 ? "amber" : undefined },
    { href: "/ops/qa-review", label: "Avg QA today",
      value: data.avg_qa ?? "—",
      sub: data.avg_qa == null ? "no scores yet" : undefined, icon: ShieldAlert,
      accent: data.avg_qa != null && data.avg_qa < 60 ? "rose" : data.avg_qa != null && data.avg_qa < 75 ? "amber" : undefined },
    { href: "/ops/callbacks", label: "Callbacks pending", value: data.callbacks_pending, sub: undefined, icon: PhoneOff,
      accent: data.callbacks_pending > 10 ? "rose" : data.callbacks_pending > 0 ? "amber" : undefined },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {kpis.map((k) => {
        const accentClass = k.accent === "rose"
          ? "border-rose-500/30 bg-rose-500/5"
          : k.accent === "amber"
            ? "border-amber-500/30 bg-amber-500/5"
            : "";
        const Icon = k.icon;
        return (
          <Link key={k.label} href={k.href} className="block">
            <Card className={`hover:bg-accent/40 transition-colors cursor-pointer ${accentClass}`}>
              <CardContent className="pt-4 pb-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" /> {k.label}
                </div>
                <div className="text-2xl font-semibold mt-1 tabular-nums">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : k.value}
                </div>
                {k.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</div>}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

// =============================================================================
// NEEDS YOUR ATTENTION
// One-line callouts for: critical alerts, compliance flags today, specialists
// trending down, pending VOBs, overdue training assignments.
// =============================================================================

export function AttentionStrip() {
  const [data, setData] = useState<{
    critical_alerts_60min: number;
    compliance_flags_today: number;
    trending_down_specialists: number;
    vob_pending: number;
    overdue_training: number;
  }>({ critical_alerts_60min: 0, compliance_flags_today: 0, trending_down_specialists: 0, vob_pending: 0, overdue_training: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const startISO = startOfDay.toISOString();
      const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      // Trending-down specialists: avg score last 7d minus avg score days 8-14
      // — count how many dropped >8pt. Computed client-side because we don't
      // have a materialized view yet.
      const { data: scoresRecent } = await supabase
        .from("call_scores")
        .select("composite_score, created_at, call:call_sessions(specialist_id)")
        .gte("created_at", fourteenAgo);
      const sevenAgoMs = new Date(sevenAgo).getTime();
      const bySpecRecent = new Map<string, number[]>();
      const bySpecPrior = new Map<string, number[]>();
      for (const row of (scoresRecent ?? []) as any[]) {
        const sId = (Array.isArray(row.call) ? row.call[0] : row.call)?.specialist_id;
        if (!sId || row.composite_score == null) continue;
        const target = new Date(row.created_at).getTime() >= sevenAgoMs ? bySpecRecent : bySpecPrior;
        const arr = target.get(sId) ?? [];
        arr.push(row.composite_score);
        target.set(sId, arr);
      }
      let trendingDown = 0;
      for (const [sId, recent] of bySpecRecent.entries()) {
        const prior = bySpecPrior.get(sId);
        if (!prior || prior.length === 0 || recent.length === 0) continue;
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
        if (priorAvg - recentAvg > 8) trendingDown++;
      }

      const [alertsRes, complianceRes, vobRes, overdueRes] = await Promise.all([
        supabase.from("high_priority_alerts").select("id", { count: "exact", head: true })
          .eq("status", "pending").gte("classified_at", sixtyAgo),
        supabase.from("call_scores").select("id, compliance_flags").gte("created_at", startISO),
        supabase.from("leads").select("id", { count: "exact", head: true }).in("vob_status", ["pending", "in_progress"]),
        supabase.from("training_assignments").select("id", { count: "exact", head: true })
          .in("status", ["assigned", "in_progress"]).lt("due_at", new Date().toISOString()),
      ]);
      if (cancelled) return;

      const complianceFlagged = ((complianceRes.data ?? []) as any[])
        .filter((r) => Array.isArray(r.compliance_flags) && r.compliance_flags.length > 0)
        .length;

      setData({
        critical_alerts_60min: alertsRes.count ?? 0,
        compliance_flags_today: complianceFlagged,
        trending_down_specialists: trendingDown,
        vob_pending: vobRes.count ?? 0,
        overdue_training: overdueRes.count ?? 0,
      });
      setLoading(false);
    }
    load();
    const i = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const items = [
    { label: "Critical alerts (last 60 min)", value: data.critical_alerts_60min, href: "/ops/alerts?filter=pending", icon: AlertTriangle, tone: "rose" as const },
    { label: "Compliance flags today", value: data.compliance_flags_today, href: "/ops/qa-review?filter=flagged", icon: ShieldAlert, tone: "rose" as const },
    { label: "Specialists trending down (7d)", value: data.trending_down_specialists, href: "/ops/coaching", icon: TrendingDown, tone: "amber" as const },
    { label: "VOBs pending", value: data.vob_pending, href: "/ops/vob", icon: ShieldCheck, tone: "amber" as const },
    { label: "Overdue training", value: data.overdue_training, href: "/ops/training-assignments?filter=overdue", icon: GraduationCap, tone: "amber" as const },
  ];

  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Needs your attention
          </span>
          <Badge variant="outline" className="text-[10px]">{total}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : total === 0 ? (
          <div className="text-sm text-muted-foreground py-2">All clear right now.</div>
        ) : (
          <div className="space-y-1">
            {items.filter((i) => i.value > 0).map((i) => {
              const Icon = i.icon;
              const toneText = i.tone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400";
              return (
                <Link key={i.label} href={i.href} className="block">
                  <div className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-accent/30 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${toneText}`} />
                      <span className="text-sm truncate">{i.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-semibold tabular-nums ${toneText}`}>{i.value}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// TRAINING WATCHLIST
// New hires (first 30d) with completion %, overdue assignees, low scorers.
// =============================================================================

interface WatchlistRow {
  id: string;
  name: string;
  reason: string;
  detail: string;
  href: string;
  tone: "amber" | "rose" | "blue";
}

export function TrainingWatchlist() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [newHiresRes, overdueRes, lowScorersRes] = await Promise.all([
        // New hires: profiles created in last 30 days, role specialist
        supabase.from("profiles")
          .select("id, full_name, email, created_at, is_ai_agent")
          .gte("created_at", thirtyAgo)
          .eq("role", "specialist")
          .eq("is_active", true),
        // Specialists with overdue assignments
        supabase.from("training_assignments")
          .select("specialist_id, due_at, specialist:profiles!training_assignments_specialist_id_fkey(full_name, email)")
          .in("status", ["assigned", "in_progress"])
          .lt("due_at", new Date().toISOString()),
        // Low scorers: avg composite < 60 over last 7 days, min 3 scored calls
        supabase.from("call_scores")
          .select("composite_score, call:call_sessions(specialist_id, specialist:profiles(full_name, email))")
          .gte("created_at", sevenAgo),
      ]);
      if (cancelled) return;

      const list: WatchlistRow[] = [];

      // New hires
      const newHires = ((newHiresRes.data ?? []) as any[]).filter((p) => !p.is_ai_agent);
      for (const p of newHires) {
        const ageDays = Math.floor((Date.now() - new Date(p.created_at).getTime()) / (24 * 60 * 60 * 1000));
        list.push({
          id: `new:${p.id}`,
          name: p.full_name ?? p.email,
          reason: "New hire",
          detail: `Day ${ageDays + 1} of 30`,
          href: `/ops/specialist/${p.id}`,
          tone: "blue",
        });
      }

      // Overdue training (group by specialist + count)
      const overdueBySpec = new Map<string, { name: string; count: number }>();
      for (const a of (overdueRes.data ?? []) as any[]) {
        if (!a.specialist_id) continue;
        const spec = Array.isArray(a.specialist) ? a.specialist[0] : a.specialist;
        const cur = overdueBySpec.get(a.specialist_id) ?? { name: spec?.full_name ?? spec?.email ?? "Unknown", count: 0 };
        cur.count++;
        overdueBySpec.set(a.specialist_id, cur);
      }
      for (const [sId, info] of overdueBySpec.entries()) {
        list.push({
          id: `overdue:${sId}`,
          name: info.name,
          reason: "Overdue training",
          detail: `${info.count} drill${info.count === 1 ? "" : "s"} past due`,
          href: `/ops/specialist/${sId}`,
          tone: "amber",
        });
      }

      // Low scorers
      const scoreBySpec = new Map<string, { name: string; total: number; count: number }>();
      for (const sc of (lowScorersRes.data ?? []) as any[]) {
        if (sc.composite_score == null) continue;
        const call = Array.isArray(sc.call) ? sc.call[0] : sc.call;
        if (!call?.specialist_id) continue;
        const spec = Array.isArray(call.specialist) ? call.specialist[0] : call.specialist;
        const cur = scoreBySpec.get(call.specialist_id) ?? { name: spec?.full_name ?? spec?.email ?? "Unknown", total: 0, count: 0 };
        cur.total += sc.composite_score;
        cur.count++;
        scoreBySpec.set(call.specialist_id, cur);
      }
      for (const [sId, info] of scoreBySpec.entries()) {
        if (info.count < 3) continue;
        const avg = Math.round(info.total / info.count);
        if (avg >= 60) continue;
        list.push({
          id: `low:${sId}`,
          name: info.name,
          reason: "Low avg score (7d)",
          detail: `${avg} avg · ${info.count} scored`,
          href: `/ops/specialist/${sId}`,
          tone: "rose",
        });
      }

      // Dedupe by id, keeping the first reason
      const seen = new Set<string>();
      const deduped = list.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      // Sort by tone severity (rose → amber → blue)
      const toneOrder: Record<string, number> = { rose: 0, amber: 1, blue: 2 };
      deduped.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

      setRows(deduped);
      setLoading(false);
    }
    load();
    const i = setInterval(load, POLL_INTERVAL_MS * 4); // slower poll — these don't move minute-to-minute
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-blue-500" />
            Training & coaching watchlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  const toneClass: Record<string, string> = {
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-blue-500" />
            Training & coaching watchlist
          </span>
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {rows.slice(0, 10).map((r) => (
            <Link key={r.id} href={r.href} className="block">
              <div className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-sm font-medium truncate">{r.name}</span>
                  <Badge variant="secondary" className={`text-[10px] ${toneClass[r.tone]}`}>{r.reason}</Badge>
                  <span className="text-xs text-muted-foreground truncate">{r.detail}</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
            </Link>
          ))}
          {rows.length > 10 && (
            <div className="text-xs text-muted-foreground text-center pt-1">
              + {rows.length - 10} more
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
