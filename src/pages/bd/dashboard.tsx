// /bd — BD Performance Dashboard.
//
// Phase 2 surface:
//   - Date presets including Today, Last 24h, WTD, MTD, plus 7/30/90/YTD
//     and a custom range. Window passes through as start_iso/end_iso.
//   - Pipeline chips (DUI / DV / Commercial / AHCCCS), multi-select.
//   - "Today's meetings" strip — always-visible regardless of window.
//   - KPI cards: referrals_in, referrals_out, net_balance, admits,
//     conversion, vobs, meetings, calls, tasks.
//   - Top referring accounts table.
//   - Per-BD-rep table with expandable LOC breakdown and click-to-drill
//     on every numeric cell (in / out / admits / vobs / meetings / calls
//     / tasks). Drilldown sheet hits bd-rep-deals.
//   - Trends tab — vertical toggle that swaps the dashboard for a
//     rolling-90-day sparkline grid (bd-rep-trend).

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, RefreshCw, TrendingUp, Calendar, Target,
  ArrowRight, Search, ArrowLeftRight, ExternalLink, X,
  ChevronRight, ChevronDown, BarChart3, Activity,
  Phone, ListTodo, ClipboardCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

// ── Pipeline grouping (frontend label → Zoho Pipeline values) ────────
const PIPELINE_GROUPS = {
  DUI: ["DUI", "DUI - Cash"],
  DV: ["DV - Cash"],
  Commercial: ["Commercial-Cash"],
  AHCCCS: ["AHCCCS"],
} as const;
type PipelineGroup = keyof typeof PIPELINE_GROUPS;

// ── Window presets ───────────────────────────────────────────────────
type WindowPreset =
  | "today" | "last_24h" | "wtd" | "mtd"
  | "last_7" | "last_30" | "last_90" | "ytd" | "custom";

function computeWindow(preset: WindowPreset, customStart?: string, customEnd?: string): { startIso: string; endIso: string; label: string } {
  const now = new Date();
  const isoUtc = (d: Date) => d.toISOString().slice(0, 19) + "+00:00";
  const startOfTodayUtc = () => {
    // Today in *local* (Phoenix) time — translate to UTC ISO. We approximate
    // by taking now's local YYYY-MM-DD, then 00:00:00 in local TZ → UTC.
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return t;
  };
  const endOfTodayUtc = () => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const startOfWeek = () => {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const dow = t.getDay(); // 0 Sun, 1 Mon …
    const diff = dow === 0 ? -6 : 1 - dow; // Monday-start
    t.setDate(t.getDate() + diff);
    return t;
  };
  const startOfMonth = () => new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const startOfYear = () => new Date(now.getFullYear(), 0, 1, 0, 0, 0);
  const subDays = (n: number) => new Date(now.getTime() - n * 86400_000);

  switch (preset) {
    case "today":    return { startIso: isoUtc(startOfTodayUtc()), endIso: isoUtc(endOfTodayUtc()), label: "Today" };
    case "last_24h": return { startIso: isoUtc(subDays(1)), endIso: isoUtc(now), label: "Last 24h" };
    case "wtd":      return { startIso: isoUtc(startOfWeek()), endIso: isoUtc(endOfTodayUtc()), label: "Week to date" };
    case "mtd":      return { startIso: isoUtc(startOfMonth()), endIso: isoUtc(endOfTodayUtc()), label: "Month to date" };
    case "last_7":   return { startIso: isoUtc(subDays(7)), endIso: isoUtc(now), label: "Last 7 days" };
    case "last_30":  return { startIso: isoUtc(subDays(30)), endIso: isoUtc(now), label: "Last 30 days" };
    case "last_90":  return { startIso: isoUtc(subDays(90)), endIso: isoUtc(now), label: "Last 90 days" };
    case "ytd":      return { startIso: isoUtc(startOfYear()), endIso: isoUtc(endOfTodayUtc()), label: "Year to date" };
    case "custom": {
      const s = customStart ? new Date(customStart + "T00:00:00") : subDays(7);
      const e = customEnd ? new Date(customEnd + "T23:59:59") : now;
      return { startIso: isoUtc(s), endIso: isoUtc(e), label: `${customStart} → ${customEnd}` };
    }
  }
}

const PRESETS: Array<{ key: WindowPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "last_24h", label: "Last 24h" },
  { key: "wtd", label: "WTD" },
  { key: "mtd", label: "MTD" },
  { key: "last_7", label: "7d" },
  { key: "last_30", label: "30d" },
  { key: "last_90", label: "90d" },
  { key: "ytd", label: "YTD" },
];

// ── Types ────────────────────────────────────────────────────────────
interface BdSummary {
  ok: boolean;
  window: { days: number; start: string; end: string };
  kpis: {
    referrals_in: number; admits: number; conversion_rate: number | null;
    meetings_completed: number; referrals_out: number; net_referral_balance: number;
    vobs: number; calls: number; tasks: number;
  };
  top_accounts: Array<{
    account_id: string; account_name: string;
    referrals_in: number; admits: number; referrals_out: number;
    net_balance: number; conversion_rate: number | null;
    last_referral_at: string | null; last_meeting_at: string | null;
    bd_owner_count: number;
  }>;
  reps: Array<{
    bd_rep: string; zoho_user_id: string | null; owner_ids: string[];
    referrals_in: number; admits: number; referrals_out: number; vobs: number;
    meetings: number; calls: number; tasks: number;
    net_balance: number; conversion_rate: number | null; meetings_completed: number;
    by_loc: Array<{ loc: string; referrals_in: number; vobs: number; admits: number }>;
  }>;
}

interface RepProfile { id: string; full_name: string | null; email: string | null; zoho_user_id: string | null; }

type DrilldownCategory = "in" | "out" | "admits" | "vobs" | "meetings" | "calls" | "tasks";
interface Drilldown { bd_rep: string; category: DrilldownCategory; zoho_user_id: string | null; owner_ids: string[]; loc?: string; }

// ── Component ────────────────────────────────────────────────────────
export default function BdDashboard() {
  const [tab, setTab] = useState<"live" | "trends">("live");

  // Window state
  const [preset, setPreset] = useState<WindowPreset>("mtd"); // default per Amber: MTD
  const [customStart, setCustomStart] = useState<string>(() => isoDay(new Date(Date.now() - 7 * 86400_000)));
  const [customEnd, setCustomEnd] = useState<string>(() => isoDay(new Date()));
  const win = useMemo(() => computeWindow(preset, customStart, customEnd), [preset, customStart, customEnd]);

  // Pipeline + rep filters
  const [pipelineGroups, setPipelineGroups] = useState<Set<PipelineGroup>>(new Set());
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set());
  const [expandedReps, setExpandedReps] = useState<Set<string>>(new Set());
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

  const [data, setData] = useState<BdSummary | null>(null);
  const [todaysMeetings, setTodaysMeetings] = useState<any[]>([]);
  const [todaysUsers, setTodaysUsers] = useState<Record<string, { full_name: string | null; email: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<RepProfile[]>([]);

  const pipelinesParam = useMemo(() => {
    if (pipelineGroups.size === 0) return undefined;
    const out: string[] = [];
    for (const g of pipelineGroups) out.push(...PIPELINE_GROUPS[g]);
    return out;
  }, [pipelineGroups]);

  // Load summary + today's meetings in parallel (today's-meetings is its
  // own window separate from the dashboard window picker).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
      const todayWin = computeWindow("today");
      const [sumRes, mtgRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-summary`, {
          method: "POST", headers,
          body: JSON.stringify({ start_iso: win.startIso, end_iso: win.endIso, pipelines: pipelinesParam }),
        }).then((r) => r.json()),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-meetings`, {
          method: "POST", headers,
          body: JSON.stringify({ start_iso: todayWin.startIso, end_iso: todayWin.endIso }),
        }).then((r) => r.json()),
      ]);
      if (!sumRes.ok) throw new Error(sumRes.error ?? "summary load failed");
      setData(sumRes);
      // Combine upcoming + recent (today only) so the strip shows both
      // morning meetings already done and afternoon meetings still ahead.
      setTodaysMeetings([...(mtgRes.upcoming ?? []), ...(mtgRes.recent ?? [])]);
      setTodaysUsers(mtgRes.users ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [win.startIso, win.endIso, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true);
      setProfiles((data ?? []) as RepProfile[]);
    })();
  }, []);

  function resolveRep(bdRep: string): { name: string; profileId: string | null } {
    const trimmed = bdRep.trim();
    if (!trimmed || trimmed === "(unassigned)" || trimmed === "None") return { name: trimmed || "(unassigned)", profileId: null };
    const target = trimmed.toLowerCase();
    const exact = profiles.find((p) => (p.full_name ?? "").trim().toLowerCase() === target);
    if (exact) return { name: exact.full_name ?? trimmed, profileId: exact.id };
    const firstName = profiles.find((p) => {
      const fn = (p.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
      return fn && fn === target;
    });
    if (firstName) return { name: firstName.full_name ?? trimmed, profileId: firstName.id };
    return { name: trimmed, profileId: null };
  }

  function togglePipeline(g: PipelineGroup) {
    setPipelineGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }
  function toggleRep(bdRep: string) {
    setSelectedReps((prev) => { const n = new Set(prev); n.has(bdRep) ? n.delete(bdRep) : n.add(bdRep); return n; });
  }
  function toggleExpand(bdRep: string) {
    setExpandedReps((prev) => { const n = new Set(prev); n.has(bdRep) ? n.delete(bdRep) : n.add(bdRep); return n; });
  }

  const visibleReps = useMemo(() => {
    if (!data) return [];
    if (selectedReps.size === 0) return data.reps;
    return data.reps.filter((r) => selectedReps.has(r.bd_rep));
  }, [data, selectedReps]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Performance Dashboard"
      subtitle="Team and individual BD performance — referrals in & out, VOBs, admits, calls, tasks, meetings. Live from Zoho CRM."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd/account">
            <Button variant="outline" size="sm" className="gap-1.5 h-9"><Search className="w-3.5 h-3.5" /> Account Intelligence</Button>
          </Link>
          <Link href="/bd/meetings">
            <Button variant="outline" size="sm" className="gap-1.5 h-9"><Calendar className="w-3.5 h-3.5" /> Meetings</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
        </div>
      }
    >
      {/* Top tab bar — Live metrics vs Trends */}
      <div className="flex items-center gap-1 border-b">
        <button
          onClick={() => setTab("live")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "live" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="w-4 h-4" /> Live metrics
        </button>
        <button
          onClick={() => setTab("trends")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "trends" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Trends · rolling 90d
        </button>
      </div>

      {tab === "trends" ? (
        <TrendsView pipelinesParam={pipelinesParam} resolveRep={resolveRep} />
      ) : (
        <>
          {/* Today's meetings strip — always visible regardless of window */}
          <TodaysMeetingsStrip rows={todaysMeetings} users={todaysUsers} loading={loading} />

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
              {PRESETS.map((p) => (
                <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => setPreset(p.key)} className="h-8 text-xs">
                  {p.label}
                </Button>
              ))}
              <Button size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => setPreset("custom")} className="h-8 text-xs">
                Custom
              </Button>
              {preset === "custom" && (
                <span className="flex items-center gap-1.5 ml-2">
                  <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 text-xs w-36" />
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 text-xs w-36" />
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-2">{win.label}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
              <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={() => setPipelineGroups(new Set())} className="h-8 text-xs">
                All
              </Button>
              {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
                <Button key={g} size="sm" variant={pipelineGroups.has(g) ? "default" : "outline"} onClick={() => togglePipeline(g)} className="h-8 text-xs"
                        title={`Includes Zoho values: ${PIPELINE_GROUPS[g].join(", ")}`}>
                  {g}
                </Button>
              ))}
            </div>
          </div>

          {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Referrals in"  value={data?.kpis.referrals_in ?? null} loading={loading} icon={<TrendingUp className="w-4 h-4 text-blue-500" />} sub="Deals w/ Referring Co." />
            <Kpi label="VOBs"           value={data?.kpis.vobs ?? null}         loading={loading} icon={<ClipboardCheck className="w-4 h-4 text-cyan-500" />} sub="VOB_Submitted_Date" />
            <Kpi label="Admits"         value={data?.kpis.admits ?? null}       loading={loading} icon={<Target className="w-4 h-4 text-emerald-500" />}    sub="From referred-in deals" />
            <Kpi label="Referrals out"  value={data?.kpis.referrals_out ?? null} loading={loading} icon={<ArrowRight className="w-4 h-4 text-orange-500" />} sub="Stage + Referred_Out" />
            <Kpi label="Net balance"    value={data?.kpis.net_referral_balance ?? null} loading={loading} icon={<ArrowLeftRight className="w-4 h-4 text-slate-500" />} sub="In − Out" />
            <Kpi label="Conversion"     value={data?.kpis.conversion_rate != null ? `${data.kpis.conversion_rate}%` : "—"} loading={loading} icon={<Target className="w-4 h-4 text-amber-500" />} sub="Referral → Admit" />
            <Kpi label="Meetings"       value={data?.kpis.meetings_completed ?? null} loading={loading} icon={<Calendar className="w-4 h-4 text-violet-500" />} sub="Events tied to records" />
            <Kpi label="Calls"          value={data?.kpis.calls ?? null}        loading={loading} icon={<Phone className="w-4 h-4 text-sky-500" />}        sub="Zoho Calls module" />
            <Kpi label="Tasks"          value={data?.kpis.tasks ?? null}        loading={loading} icon={<ListTodo className="w-4 h-4 text-rose-500" />}     sub="Created in window" />
          </div>

          {/* Top referring accounts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Top referring accounts</span>
                <span className="text-xs font-normal text-muted-foreground">grouped by Deal.Referring_Company</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data && data.top_accounts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="text-left py-2 pr-3">#</th>
                        <th className="text-left py-2 pr-3">Account</th>
                        <th className="text-right py-2 pr-3">In</th>
                        <th className="text-right py-2 pr-3">Out</th>
                        <th className="text-right py-2 pr-3">Net</th>
                        <th className="text-right py-2 pr-3">Admits</th>
                        <th className="text-right py-2 pr-3">Conv</th>
                        <th className="text-right py-2 pr-3">Last referral</th>
                        <th className="text-right py-2 pr-3">Last meeting</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_accounts.map((a, i) => (
                        <tr key={a.account_id} className="border-t">
                          <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-3 font-medium">{a.account_name}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.referrals_in}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-orange-600 dark:text-orange-400">{a.referrals_out}</td>
                          <td className={`py-2 pr-3 text-right tabular-nums ${a.net_balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{a.net_balance > 0 ? `+${a.net_balance}` : a.net_balance}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.admits}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.conversion_rate != null ? `${a.conversion_rate}%` : "—"}</td>
                          <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{a.last_referral_at ? new Date(a.last_referral_at).toLocaleDateString() : "—"}</td>
                          <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{a.last_meeting_at ? new Date(a.last_meeting_at).toLocaleDateString() : "—"}</td>
                          <td className="py-2 pr-3 text-right"><Link href={`/bd/account?id=${a.account_id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Open <ArrowRight className="w-3 h-3" /></Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No referrals in this window.</p>}
            </CardContent>
          </Card>

          {/* Per-rep table */}
          <Card>
            <CardHeader className="space-y-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Per BD rep</span>
                <span className="text-xs font-normal text-muted-foreground">click ▸ to expand LOC breakdown · click any number to drill into the underlying records</span>
              </CardTitle>
              {data && data.reps.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Show only</span>
                  <Button size="sm" variant={selectedReps.size === 0 ? "default" : "outline"} onClick={() => setSelectedReps(new Set())} className="h-7 text-[11px] px-2">
                    All ({data.reps.length})
                  </Button>
                  {data.reps.map((r) => {
                    const { name } = resolveRep(r.bd_rep);
                    return (
                      <Button key={r.bd_rep} size="sm" variant={selectedReps.has(r.bd_rep) ? "default" : "outline"} onClick={() => toggleRep(r.bd_rep)} className="h-7 text-[11px] px-2 gap-1">
                        {name} {selectedReps.has(r.bd_rep) && <X className="w-3 h-3" />}
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {data && visibleReps.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="w-6"></th>
                        <th className="text-left py-2 pr-3">Rep</th>
                        <th className="text-right py-2 pr-3">In</th>
                        <th className="text-right py-2 pr-3">VOBs</th>
                        <th className="text-right py-2 pr-3">Admits</th>
                        <th className="text-right py-2 pr-3">Out</th>
                        <th className="text-right py-2 pr-3">Net</th>
                        <th className="text-right py-2 pr-3">Conv</th>
                        <th className="text-right py-2 pr-3">Meetings</th>
                        <th className="text-right py-2 pr-3">Calls</th>
                        <th className="text-right py-2 pr-3">Tasks</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReps.map((r) => {
                        const { name, profileId } = resolveRep(r.bd_rep);
                        const expanded = expandedReps.has(r.bd_rep);
                        const drill = (category: DrilldownCategory, loc?: string) =>
                          setDrilldown({ bd_rep: r.bd_rep, category, zoho_user_id: r.zoho_user_id, owner_ids: r.owner_ids, loc });
                        return (
                          <>
                            <tr key={r.bd_rep} className="border-t">
                              <td className="py-2 pr-1">
                                <button onClick={() => toggleExpand(r.bd_rep)} className="text-muted-foreground hover:text-foreground" aria-label={expanded ? "Collapse" : "Expand"}>
                                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </button>
                              </td>
                              <td className="py-2 pr-3 font-medium">{name}</td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.referrals_in} onClick={() => drill("in")} /></td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.vobs} onClick={() => drill("vobs")} /></td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.admits} onClick={() => drill("admits")} /></td>
                              <td className="py-2 pr-3 text-right tabular-nums text-orange-600 dark:text-orange-400"><DrillBtn n={r.referrals_out} onClick={() => drill("out")} /></td>
                              <td className={`py-2 pr-3 text-right tabular-nums ${r.net_balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{r.net_balance > 0 ? `+${r.net_balance}` : r.net_balance}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{r.conversion_rate != null ? `${r.conversion_rate}%` : "—"}</td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.meetings} onClick={() => drill("meetings")} /></td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.calls} onClick={() => drill("calls")} /></td>
                              <td className="py-2 pr-3 text-right tabular-nums"><DrillBtn n={r.tasks} onClick={() => drill("tasks")} /></td>
                              <td className="py-2 pr-3 text-right">
                                {profileId && <Link href={`/ops/specialist/${profileId}`} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Profile <ArrowRight className="w-3 h-3" /></Link>}
                              </td>
                            </tr>
                            {expanded && r.by_loc.length > 0 && (
                              <tr key={`${r.bd_rep}-loc`} className="bg-muted/30">
                                <td></td>
                                <td colSpan={11} className="py-2 px-3">
                                  <div className="space-y-1">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">By Level of Care</div>
                                    <table className="w-full text-xs">
                                      <thead className="text-muted-foreground">
                                        <tr><th className="text-left py-1 pr-3">LOC</th><th className="text-right py-1 pr-3">In</th><th className="text-right py-1 pr-3">VOBs</th><th className="text-right py-1 pr-3">Admits</th><th className="text-right py-1 pr-3">Conv</th></tr>
                                      </thead>
                                      <tbody>
                                        {r.by_loc.map((l) => {
                                          const conv = l.referrals_in > 0 ? Math.round((l.admits / l.referrals_in) * 100) : null;
                                          return (
                                            <tr key={l.loc} className="border-t">
                                              <td className="py-1 pr-3"><Badge variant="outline" className="text-[10px]">{l.loc}</Badge></td>
                                              <td className="py-1 pr-3 text-right tabular-nums"><DrillBtn n={l.referrals_in} onClick={() => drill("in", l.loc)} /></td>
                                              <td className="py-1 pr-3 text-right tabular-nums"><DrillBtn n={l.vobs} onClick={() => drill("vobs", l.loc)} /></td>
                                              <td className="py-1 pr-3 text-right tabular-nums"><DrillBtn n={l.admits} onClick={() => drill("admits", l.loc)} /></td>
                                              <td className="py-1 pr-3 text-right tabular-nums">{conv != null ? `${conv}%` : "—"}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No rep activity in this window.</p>}
            </CardContent>
          </Card>

          {/* Drilldown sheet */}
          <Sheet open={drilldown != null} onOpenChange={(o) => { if (!o) setDrilldown(null); }}>
            <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
              {drilldown && (
                <RepDrilldown drilldown={drilldown} startIso={win.startIso} endIso={win.endIso}
                  pipelines={pipelinesParam} repName={resolveRep(drilldown.bd_rep).name} />
              )}
            </SheetContent>
          </Sheet>
        </>
      )}
    </PageShell>
  );
}

// ── Today's meetings strip ───────────────────────────────────────────
function TodaysMeetingsStrip({ rows, users, loading }: { rows: any[]; users: Record<string, { full_name: string | null; email: string | null }>; loading: boolean }) {
  if (loading && rows.length === 0) {
    return (
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-3 pb-3 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading today's meetings…
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) return null;
  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's meetings</span>
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {rows.slice(0, 12).map((m: any) => {
            const ownerId = m["Owner.id"] as string | null;
            const owner = ownerId ? (users[ownerId]?.full_name ?? users[ownerId]?.email ?? "—") : "—";
            const what = m.What_Id;
            const linked = typeof what === "string" ? what : (what?.name ?? null);
            const start = m.Start_DateTime ? new Date(m.Start_DateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
            return (
              <a key={m.id} href={`https://crm.zoho.com/crm/tab/Events/${m.id}`} target="_blank" rel="noopener noreferrer"
                className="text-xs px-2 py-1 rounded border bg-background hover:bg-accent/40 transition-colors inline-flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">{start}</span>
                <span className="font-medium">{m.Event_Title ?? "(untitled)"}</span>
                {linked && <span className="text-muted-foreground">· {linked}</span>}
                <span className="text-[10px] text-muted-foreground">— {owner}</span>
              </a>
            );
          })}
          {rows.length > 12 && <Link href="/bd/meetings" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">+ {rows.length - 12} more</Link>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── KPI ──────────────────────────────────────────────────────────────
function Kpi({ label, value, loading, icon, sub }: { label: string; value: number | string | null; loading: boolean; icon: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{loading && value == null ? <Loader2 className="w-4 h-4 animate-spin" /> : (value ?? "—")}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function DrillBtn({ n, onClick }: { n: number; onClick: () => void }) {
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return <button onClick={onClick} className="text-primary hover:underline tabular-nums">{n}</button>;
}

// ── Drilldown ────────────────────────────────────────────────────────
const CATEGORY_LABEL: Record<DrilldownCategory, string> = {
  in: "Referrals in", out: "Referrals out", admits: "Admits",
  vobs: "VOBs", meetings: "Meetings", calls: "Calls", tasks: "Tasks",
};

function RepDrilldown({ drilldown, startIso, endIso, pipelines, repName }: {
  drilldown: Drilldown; startIso: string; endIso: string;
  pipelines: string[] | undefined; repName: string;
}) {
  const [deals, setDeals] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-rep-deals`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            bd_rep: drilldown.bd_rep, category: drilldown.category,
            start_iso: startIso, end_iso: endIso, pipelines,
            zoho_user_id: drilldown.zoho_user_id,
            owner_ids: drilldown.owner_ids,
            loc: drilldown.loc,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "load failed");
        setDeals(json.deals ?? []);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setLoading(false); }
    })();
  }, [drilldown, startIso, endIso, pipelines]);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {repName}
          <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[drilldown.category]}</Badge>
          {drilldown.loc && <Badge variant="outline" className="text-[10px]">LOC: {drilldown.loc}</Badge>}
        </SheetTitle>
        <SheetDescription>
          {deals == null ? "Loading…" : `${deals.length} record${deals.length === 1 ? "" : "s"}`}
          {pipelines && pipelines.length > 0 && <span className="ml-1">· {pipelines.join(", ")}</span>}
        </SheetDescription>
      </SheetHeader>

      {loading && <div className="mt-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading from Zoho…</div>}
      {error && <div className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {deals && deals.length === 0 && !loading && <p className="mt-6 text-sm text-muted-foreground">No records.</p>}

      {deals && deals.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          {drilldown.category === "meetings" ? <MeetingsList rows={deals} />
            : drilldown.category === "calls" ? <CallsList rows={deals} />
            : drilldown.category === "tasks" ? <TasksList rows={deals} />
            : <DealsList rows={deals} category={drilldown.category} />}
        </div>
      )}
    </>
  );
}

function DealsList({ rows, category }: { rows: any[]; category: DrilldownCategory }) {
  const showContact = category === "in" || category === "admits";
  const showVobDate = category === "vobs";
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr>
          <th className="text-left py-2 pr-3">Deal</th>
          <th className="text-left py-2 pr-3">{category === "out" ? "Referred to" : "Referring co."}</th>
          {showContact && <th className="text-left py-2 pr-3">Contact</th>}
          <th className="text-left py-2 pr-3">{showVobDate ? "VOB date" : category === "out" ? "Refer-out" : "Stage"}</th>
          <th className="text-left py-2 pr-3">LOC</th>
          <th className="text-left py-2 pr-3">Pipeline</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const account = category === "out"
            ? (d["Referred_Out.Account_Name"] as string) ?? "—"
            : (d["Referring_Company.Account_Name"] as string) ?? "—";
          const middle = showVobDate
            ? (d.VOB_Submitted_Date ? new Date(d.VOB_Submitted_Date).toLocaleDateString() : "—")
            : category === "out"
              ? (d.Refer_Out_Date ? new Date(d.Refer_Out_Date).toLocaleDateString() : "—")
              : (d.Stage as string) ?? "—";
          const contactName = d["Referring_Business_Contact.Full_Name"] as string | null;
          const contactEmail = d["Referring_Business_Contact.Email"] as string | null;
          const contactPhone = d["Referring_Business_Contact.Phone"] as string | null;
          return (
            <tr key={d.id} className="border-t align-top">
              <td className="py-2 pr-3 font-medium">{d.Deal_Name ?? "(no name)"}</td>
              <td className="py-2 pr-3 text-xs">{account}</td>
              {showContact && (
                <td className="py-2 pr-3 text-xs">
                  {contactName ? (
                    <div className="space-y-0.5">
                      <div>{contactName}</div>
                      {(contactEmail || contactPhone) && <div className="text-[10px] text-muted-foreground">{contactEmail}{contactEmail && contactPhone ? " · " : ""}{contactPhone}</div>}
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              )}
              <td className="py-2 pr-3 text-xs">{middle}</td>
              <td className="py-2 pr-3 text-xs">{d.Admitted_Level_of_Care ? <Badge variant="outline" className="text-[9px]">{d.Admitted_Level_of_Care}</Badge> : <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{d.Pipeline ?? "—"}</Badge></td>
              <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Potentials/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MeetingsList({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr><th className="text-left py-2 pr-3">Title</th><th className="text-left py-2 pr-3">With</th><th className="text-left py-2 pr-3">Venue</th><th className="text-right py-2 pr-3">When</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const what = m.What_Id; const linked = typeof what === "string" ? what : what?.name ?? "—";
          return (
            <tr key={m.id} className="border-t align-top">
              <td className="py-2 pr-3 font-medium">{m.Event_Title ?? "(untitled)"}</td>
              <td className="py-2 pr-3 text-xs">{linked}</td>
              <td className="py-2 pr-3 text-xs">{m.Venue ?? "—"}</td>
              <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{m.Start_DateTime ? new Date(m.Start_DateTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
              <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Events/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CallsList({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr><th className="text-left py-2 pr-3">Subject</th><th className="text-left py-2 pr-3">Type</th><th className="text-left py-2 pr-3">Result</th><th className="text-right py-2 pr-3">Duration</th><th className="text-right py-2 pr-3">When</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t">
            <td className="py-2 pr-3 font-medium">{c.Subject ?? "(no subject)"}</td>
            <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{c.Call_Type ?? "—"}</Badge></td>
            <td className="py-2 pr-3 text-xs">{c.Call_Result ?? "—"}</td>
            <td className="py-2 pr-3 text-right text-xs tabular-nums">{c.Call_Duration ?? "—"}</td>
            <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{c.Call_Start_Time ? new Date(c.Call_Start_Time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
            <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Calls/${c.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TasksList({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
        <tr><th className="text-left py-2 pr-3">Subject</th><th className="text-left py-2 pr-3">Status</th><th className="text-left py-2 pr-3">Linked</th><th className="text-right py-2 pr-3">Due</th><th className="text-right py-2 pr-3">Created</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const what = t.What_Id; const linked = typeof what === "string" ? what : what?.name ?? null;
          return (
            <tr key={t.id} className="border-t">
              <td className="py-2 pr-3 font-medium">{t.Subject ?? "(no subject)"}</td>
              <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{t.Status ?? "—"}</Badge></td>
              <td className="py-2 pr-3 text-xs">{linked ?? "—"}</td>
              <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{t.Due_Date ? new Date(t.Due_Date).toLocaleDateString() : "—"}</td>
              <td className="py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">{t.Created_Time ? new Date(t.Created_Time).toLocaleDateString() : "—"}</td>
              <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Tasks/${t.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Trends tab ───────────────────────────────────────────────────────
interface BdTrend {
  ok: boolean;
  window: { days: number; start: string; end: string };
  dates: string[];
  reps: Array<{
    bd_rep: string;
    zoho_user_id: string | null;
    totals: { referrals_in: number; vobs: number; admits: number; meetings: number; calls: number; tasks: number };
    daily: { referrals_in: number[]; vobs: number[]; admits: number[]; meetings: number[]; calls: number[]; tasks: number[] };
  }>;
}

function TrendsView({ pipelinesParam, resolveRep }: { pipelinesParam: string[] | undefined; resolveRep: (s: string) => { name: string; profileId: string | null } }) {
  const [data, setData] = useState<BdTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-rep-trend`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ days, pipelines: pipelinesParam }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [days, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
        {[30, 60, 90, 180].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)} className="h-8 text-xs">{d}d</Button>
        ))}
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-2 h-8 gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}

      {!data && loading && (
        <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading rolling-{days}d trend…</CardContent></Card>
      )}

      {data && data.reps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Rolling {days}-day trend per rep</span>
              <span className="text-xs font-normal text-muted-foreground">{data.dates.length} day axis · {data.reps.length} reps</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="text-left py-2 pr-3 sticky left-0 bg-background">Rep</th>
                    <th className="text-left py-2 pr-3">Referrals in</th>
                    <th className="text-left py-2 pr-3">VOBs</th>
                    <th className="text-left py-2 pr-3">Admits</th>
                    <th className="text-left py-2 pr-3">Meetings</th>
                    <th className="text-left py-2 pr-3">Calls</th>
                    <th className="text-left py-2 pr-3">Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reps.map((r) => {
                    const { name } = resolveRep(r.bd_rep);
                    return (
                      <tr key={r.bd_rep} className="border-t">
                        <td className="py-2 pr-3 font-medium sticky left-0 bg-background">
                          <div>{name}</div>
                          <div className="text-[10px] text-muted-foreground">total · {r.totals.referrals_in + r.totals.vobs + r.totals.admits + r.totals.meetings + r.totals.calls + r.totals.tasks}</div>
                        </td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.referrals_in} total={r.totals.referrals_in} stroke="rgb(59,130,246)" /></td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.vobs}         total={r.totals.vobs}         stroke="rgb(6,182,212)" /></td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.admits}       total={r.totals.admits}       stroke="rgb(16,185,129)" /></td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.meetings}     total={r.totals.meetings}     stroke="rgb(139,92,246)" /></td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.calls}        total={r.totals.calls}        stroke="rgb(14,165,233)" /></td>
                        <td className="py-2 pr-3"><Sparkline values={r.daily.tasks}        total={r.totals.tasks}        stroke="rgb(244,63,94)" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// Tiny inline SVG sparkline. Stroked area chart with the running total
// printed as a label below. No chart library.
function Sparkline({ values, total, stroke }: { values: number[]; total: number; stroke: string }) {
  const w = 120, h = 32, pad = 2;
  const max = Math.max(1, ...values);
  const dx = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * dx;
    const y = h - pad - ((h - pad * 2) * (v / max));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPath = `M ${pad},${h - pad} L ${points.replace(/ /g, " L ")} L ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} Z`;
  return (
    <div className="space-y-0.5">
      <svg width={w} height={h} className="block">
        <path d={areaPath} fill={stroke} fillOpacity={0.12} />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} />
      </svg>
      <div className="text-[10px] text-muted-foreground tabular-nums">total {total} · peak {max}</div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
function isoDay(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
