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
  Phone, ListTodo, ClipboardCheck, Save, Bookmark, Info,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { loadSavedViews, saveView, deleteView, type BdSavedView } from "@/lib/bd-saved-views";
import { exportCsv, isoToDay } from "@/lib/bd-csv";

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

  // Saved Views — localStorage-backed named filter combos.
  const [savedViews, setSavedViews] = useState<BdSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [savingNew, setSavingNew] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  useEffect(() => { setSavedViews(loadSavedViews()); }, []);

  function applyView(v: BdSavedView) {
    setPreset(v.preset as WindowPreset);
    if (v.customStart) setCustomStart(v.customStart);
    if (v.customEnd) setCustomEnd(v.customEnd);
    setPipelineGroups(new Set(v.pipelines as PipelineGroup[]));
    setSelectedReps(new Set(v.reps));
    setActiveViewId(v.id);
  }
  function commitSaveView() {
    const name = newViewName.trim();
    if (!name) return;
    const v = saveView({
      name,
      preset,
      customStart: preset === "custom" ? customStart : undefined,
      customEnd: preset === "custom" ? customEnd : undefined,
      pipelines: Array.from(pipelineGroups),
      reps: Array.from(selectedReps),
    });
    setSavedViews(loadSavedViews());
    setActiveViewId(v.id);
    setNewViewName("");
    setSavingNew(false);
  }
  function removeView(id: string) {
    deleteView(id);
    setSavedViews(loadSavedViews());
    if (activeViewId === id) setActiveViewId(null);
  }
  // Any manual filter change clears the "active view" indicator since
  // the current state no longer matches a saved view.
  function clearActiveOnEdit() { if (activeViewId) setActiveViewId(null); }

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
    clearActiveOnEdit();
    setPipelineGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }
  function toggleRep(bdRep: string) {
    clearActiveOnEdit();
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
      {/* Top tab bar — Live metrics / Trends. Referrals was promoted
          to its own page at /bd/referrals (see left nav). */}
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
          {/* Saved Views — named filter combos persisted to localStorage */}
          <SavedViewsRow
            views={savedViews}
            activeId={activeViewId}
            apply={applyView}
            remove={removeView}
            savingNew={savingNew}
            setSavingNew={setSavingNew}
            newName={newViewName}
            setNewName={setNewViewName}
            commit={commitSaveView}
          />

          {/* Filters */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
              {PRESETS.map((p) => (
                <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { clearActiveOnEdit(); setPreset(p.key); }} className="h-8 text-xs">
                  {p.label}
                </Button>
              ))}
              <Button size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => { clearActiveOnEdit(); setPreset("custom"); }} className="h-8 text-xs">
                Custom
              </Button>
              {preset === "custom" && (
                <span className="flex items-center gap-1.5 ml-2">
                  <Input type="date" value={customStart} onChange={(e) => { clearActiveOnEdit(); setCustomStart(e.target.value); }} className="h-8 text-xs w-36" />
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Input type="date" value={customEnd} onChange={(e) => { clearActiveOnEdit(); setCustomEnd(e.target.value); }} className="h-8 text-xs w-36" />
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-2">{win.label}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
              <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={() => { clearActiveOnEdit(); setPipelineGroups(new Set()); }} className="h-8 text-xs">
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
            <Kpi label="Referrals in"  value={data?.kpis.referrals_in ?? null} loading={loading} icon={<TrendingUp className="w-4 h-4 text-blue-500" />} sub="Deals w/ Referring Co."
              info="Count of Zoho deals created in this window that have a Referring Company set on the deal. Deduped by deal id (a deal is never double-counted even if it appears on a related list under both an account and a contact). Outbound (referred-out) deals are excluded — those are counted under Referrals out." />
            <Kpi label="VOBs"           value={data?.kpis.vobs ?? null}         loading={loading} icon={<ClipboardCheck className="w-4 h-4 text-cyan-500" />} sub="VOB_Submitted_Date"
              info="Count of deals whose VOB Submitted Date falls inside the window. This is the 'we ran insurance' moment — happens after a referral comes in and before an admit. Filtered by the same Pipeline selection as everything else (DUI/DV are separate service lines, not treatment)." />
            <Kpi label="Admits"         value={data?.kpis.admits ?? null}       loading={loading} icon={<Target className="w-4 h-4 text-emerald-500" />}    sub="From referred-in deals"
              info="Deals that hit an Admitted stage in this window. Counts only deals that originated from a referral in (Referring Company set) — walk-ins and self-referrals are excluded. Use the Conversion KPI to see admit rate against the matching Referrals in cohort." />
            <Kpi label="Referrals out"  value={data?.kpis.referrals_out ?? null} loading={loading} icon={<ArrowRight className="w-4 h-4 text-orange-500" />} sub="Stage + Referred_Out"
              info="Patients we sent elsewhere in this window. Unioned across two Zoho signals and deduped by deal id: (1) Stage = 'Referred Out - Coming Back' or 'Closed - Referred Out Unattached', (2) the Referred_Out lookup field is set with a Refer Out Date in window. Account on each row is where we sent them, NOT the original referrer." />
            <Kpi label="Net balance"    value={data?.kpis.net_referral_balance ?? null} loading={loading} icon={<ArrowLeftRight className="w-4 h-4 text-slate-500" />} sub="In − Out"
              info="Referrals in minus Referrals out. Positive means we netted patients from the referral network this window; negative means we sent more out than we took in. Useful for spotting reciprocity gaps with specific accounts on the Top Referring Accounts page." />
            <Kpi label="Conversion"     value={data?.kpis.conversion_rate != null ? `${data.kpis.conversion_rate}%` : "—"} loading={loading} icon={<Target className="w-4 h-4 text-amber-500" />} sub="Referral → Admit"
              info="Admits ÷ Referrals in for this window, expressed as a percentage. Cohort is the deals counted in the Referrals in tile — same window, same Pipeline filter. Note: an admit can come in a later window than the referral, so very short windows can skew low." />
            <Kpi label="Meetings"       value={data?.kpis.meetings_completed ?? null} loading={loading} icon={<Calendar className="w-4 h-4 text-violet-500" />} sub="Events tied to records"
              info="Completed Zoho Events in the window where the BD rep is the host. Includes outreach meetings, partner check-ins, and lunches. Cancelled / no-show events are excluded. Each event is linked to a Company (What_Id) or Contact (Who_Id) — drill into a rep on Today's Meetings to see the company-by-company breakdown." />
            <Kpi label="Calls"          value={data?.kpis.calls ?? null}        loading={loading} icon={<Phone className="w-4 h-4 text-sky-500" />}        sub="Zoho Calls module"
              info="Logged calls from the Zoho Calls module in this window, attributed to the BD rep. Inbound + outbound, completed only. Voicemails are counted; missed calls without a logged record are not." />
            <Kpi label="Tasks"          value={data?.kpis.tasks ?? null}        loading={loading} icon={<ListTodo className="w-4 h-4 text-rose-500" />}     sub="Created in window"
              info="Zoho Tasks created in this window, owned by the BD rep. Counts creation, not completion — helps measure outreach activity even when follow-ups stretch beyond the window. Status (open / closed) is visible on the per-rep drilldown." />
          </div>

          {/* Top referring accounts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span>Top referring accounts</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-normal text-muted-foreground">grouped by Deal.Referring_Company</span>
                  <Button size="sm" variant="outline" disabled={!data || data.top_accounts.length === 0} onClick={() => {
                    if (!data) return;
                    exportCsv<any>(`bd-top-accounts-${isoToDay(win.startIso)}-to-${isoToDay(win.endIso)}.csv`, [
                      { header: "Rank", value: (_a, i) => i + 1 },
                      { header: "Account", value: (a) => a.account_name },
                      { header: "Account ID", value: (a) => a.account_id },
                      { header: "Referrals in", value: (a) => a.referrals_in },
                      { header: "Referrals out", value: (a) => a.referrals_out },
                      { header: "Net", value: (a) => a.net_balance },
                      { header: "Admits", value: (a) => a.admits },
                      { header: "Conversion %", value: (a) => a.conversion_rate },
                      { header: "Last referral", value: (a) => a.last_referral_at },
                      { header: "Last meeting", value: (a) => a.last_meeting_at },
                    ], data.top_accounts);
                  }} className="h-7 text-[11px] px-2">CSV</Button>
                </span>
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
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span>Per BD rep</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-normal text-muted-foreground">click ▸ to expand LOC · click any number to drill</span>
                  <Button size="sm" variant="outline" disabled={!data || visibleReps.length === 0} onClick={() => {
                    if (!data) return;
                    exportCsv<any>(`bd-per-rep-${isoToDay(win.startIso)}-to-${isoToDay(win.endIso)}.csv`, [
                      { header: "Rep", value: (r) => resolveRep(r.bd_rep).name },
                      { header: "BD_Rep (Zoho picklist)", value: (r) => r.bd_rep },
                      { header: "Referrals in", value: (r) => r.referrals_in },
                      { header: "VOBs", value: (r) => r.vobs },
                      { header: "Admits", value: (r) => r.admits },
                      { header: "Referrals out", value: (r) => r.referrals_out },
                      { header: "Net", value: (r) => r.net_balance },
                      { header: "Conversion %", value: (r) => r.conversion_rate },
                      { header: "Meetings", value: (r) => r.meetings },
                      { header: "Calls", value: (r) => r.calls },
                      { header: "Tasks", value: (r) => r.tasks },
                    ], visibleReps);
                  }} className="h-7 text-[11px] px-2">CSV</Button>
                </span>
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

          {/* Today's meetings — at the bottom of the page so it doesn't
              dominate the metrics view. Grouped by BD rep, collapsible. */}
          <TodaysMeetingsStrip rows={todaysMeetings} users={todaysUsers} loading={loading} resolveRep={resolveRep} />

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

// ── Today's meetings panel ───────────────────────────────────────────
// Grouped by BD rep, collapsible (collapsed by default to keep the
// dashboard compact). Lives at the bottom of the page since today's
// meetings are reference material, not the primary metric view.
//
// Subject column: prefers Zoho's What_Id.name (company) → Who_Id.name
// (contact) → meeting title. Cornerstone BD reps put the partner name
// in the title for unlinked check-ins ("Drop NW Sahuarita", "OV
// Psychiatry"), so the title fallback is usually the most useful
// identifier we have for those rows.
function TodaysMeetingsStrip({
  rows, users, loading, resolveRep,
}: {
  rows: any[];
  users: Record<string, { full_name: string | null; email: string | null }>;
  loading: boolean;
  resolveRep: (s: string) => { name: string; profileId: string | null };
}) {
  const [openReps, setOpenReps] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

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

  // Enrich every meeting with the best available company-ish label.
  const enriched = rows.map((m: any) => {
    const what = m.What_Id;
    const who = m.Who_Id;
    const companyName = typeof what === "string" ? what : (what?.name ?? null);
    const contactName = typeof who === "string" ? who : (who?.name ?? null);
    const ownerId = m["Owner.id"] as string | null;
    const ownerRaw = ownerId ? (users[ownerId]?.full_name ?? users[ownerId]?.email ?? null) : null;
    const ownerKey = ownerRaw ?? "(unassigned)";
    const ownerName = ownerRaw ? resolveRep(ownerRaw).name : "(unassigned)";
    const subject = companyName ?? contactName ?? m.Event_Title ?? "(untitled)";
    const linked = !!(companyName || contactName);
    return {
      m, ownerKey, ownerName,
      subject, companyName, contactName, linked,
      time: m.Start_DateTime ? new Date(m.Start_DateTime) : null,
    };
  });
  enriched.sort((a, b) => (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0));

  // Group by BD rep.
  const byRep = new Map<string, typeof enriched>();
  for (const row of enriched) {
    const list = byRep.get(row.ownerKey) ?? [];
    list.push(row);
    byRep.set(row.ownerKey, list);
  }
  const repGroups = Array.from(byRep.entries())
    .map(([key, list]) => ({ key, name: list[0].ownerName, list }))
    .sort((a, b) => b.list.length - a.list.length); // busiest first

  const fmtTime = (d: Date | null) => d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  function toggle(rep: string) {
    setOpenReps((prev) => { const n = new Set(prev); n.has(rep) ? n.delete(rep) : n.add(rep); return n; });
  }
  const isOpen = (rep: string) => allOpen || openReps.has(rep);

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-500" />
          <span>Today's meetings</span>
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
          <Button
            size="sm" variant="outline"
            onClick={() => { setAllOpen(!allOpen); setOpenReps(new Set()); }}
            className="ml-auto h-7 text-[11px] px-2"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1">
        {repGroups.map((g) => {
          const open = isOpen(g.key);
          const linkedCount = g.list.filter((r) => r.linked).length;
          return (
            <div key={g.key} className="border rounded-md bg-background/50">
              <button
                onClick={() => toggle(g.key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40 transition-colors text-left"
              >
                {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <span className="font-medium">{g.name}</span>
                <Badge variant="outline" className="text-[10px]">{g.list.length}</Badge>
                {linkedCount < g.list.length && (
                  <span className="text-[10px] text-muted-foreground">{linkedCount} linked · {g.list.length - linkedCount} unlinked</span>
                )}
              </button>
              {open && (
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-sm">
                    <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      <tr>
                        <th className="text-left py-1.5 px-3 w-20">Time</th>
                        <th className="text-left py-1.5 pr-3">Company / subject</th>
                        <th className="text-left py-1.5 pr-3">Contact</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.list.map(({ m, subject, contactName, time, linked }) => (
                        <tr key={m.id} className={`border-t hover:bg-accent/20 ${linked ? "" : "opacity-75"}`}>
                          <td className="py-1.5 px-3 text-xs tabular-nums text-muted-foreground">{fmtTime(time)}</td>
                          <td className="py-1.5 pr-3">
                            <span className={linked ? "font-medium" : "italic text-muted-foreground"}>{subject}</span>
                            {!linked && <span className="ml-2 text-[10px] text-muted-foreground" title="No What_Id or Who_Id set in Zoho">unlinked</span>}
                          </td>
                          <td className="py-1.5 pr-3 text-xs">{contactName ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-1.5 pr-3 text-right">
                            <a href={`https://crm.zoho.com/crm/tab/Events/${m.id}`} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                              Zoho <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── KPI ──────────────────────────────────────────────────────────────
function Kpi({ label, value, loading, icon, sub, info }: {
  label: string;
  value: number | string | null;
  loading: boolean;
  icon: React.ReactNode;
  sub?: string;
  /** Plain-English explanation shown on hovering the small "i" badge.
   *  Should describe what's counted, the source field, and any
   *  edge cases (dedupe, window basis, exclusions). */
  info?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
          {info && (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`About ${label}`}
                  className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  <Info className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                {info}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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

  // Export the drilldown rows as CSV. Column set varies by category —
  // deal-shaped rows (in/out/admits/vobs/pipeline) share one schema,
  // meetings/calls/tasks each get their own.
  function downloadCsv() {
    if (!deals || deals.length === 0) return;
    const repSlug = repName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const stamp = `${isoToDay(startIso)}-to-${isoToDay(endIso)}`;
    const cat = drilldown.category;
    const fname = `bd-drilldown-${repSlug}-${cat}${drilldown.loc ? `-${drilldown.loc}` : ""}-${stamp}.csv`;
    if (cat === "meetings") {
      exportCsv<any>(fname, [
        { header: "Title", value: (m) => m.Event_Title ?? "" },
        { header: "Start", value: (m) => m.Start_DateTime ?? "" },
        { header: "End", value: (m) => m.End_DateTime ?? "" },
        { header: "Company (What_Id)", value: (m) => (typeof m.What_Id === "string" ? m.What_Id : (m.What_Id?.name ?? "")) },
        { header: "Contact (Who_Id)", value: (m) => (typeof m.Who_Id === "string" ? m.Who_Id : (m.Who_Id?.name ?? "")) },
        { header: "Venue", value: (m) => m.Venue ?? "" },
        { header: "Zoho ID", value: (m) => m.id },
      ], deals);
    } else if (cat === "calls") {
      exportCsv<any>(fname, [
        { header: "Subject", value: (c) => c.Subject ?? "" },
        { header: "Call type", value: (c) => c.Call_Type ?? "" },
        { header: "Status", value: (c) => c.Call_Status ?? "" },
        { header: "Duration (s)", value: (c) => c.Call_Duration_in_seconds ?? "" },
        { header: "Start", value: (c) => c.Call_Start_Time ?? "" },
        { header: "Related (What_Id)", value: (c) => (typeof c.What_Id === "string" ? c.What_Id : (c.What_Id?.name ?? "")) },
        { header: "Zoho ID", value: (c) => c.id },
      ], deals);
    } else if (cat === "tasks") {
      exportCsv<any>(fname, [
        { header: "Subject", value: (t) => t.Subject ?? "" },
        { header: "Status", value: (t) => t.Status ?? "" },
        { header: "Priority", value: (t) => t.Priority ?? "" },
        { header: "Due", value: (t) => t.Due_Date ?? "" },
        { header: "Created", value: (t) => t.Created_Time ?? "" },
        { header: "Related (What_Id)", value: (t) => (typeof t.What_Id === "string" ? t.What_Id : (t.What_Id?.name ?? "")) },
        { header: "Zoho ID", value: (t) => t.id },
      ], deals);
    } else {
      // Deal-shaped categories: in / out / admits / vobs / pipeline
      exportCsv<any>(fname, [
        { header: "Deal", value: (d) => d.Deal_Name ?? "" },
        { header: cat === "out" ? "Referred to" : "Referring company", value: (d) => cat === "out" ? (d["Referred_Out.Account_Name"] ?? "") : (d["Referring_Company.Account_Name"] ?? "") },
        { header: "Contact", value: (d) => d["Referring_Business_Contact.Full_Name"] ?? "" },
        { header: "Contact email", value: (d) => d["Referring_Business_Contact.Email"] ?? "" },
        { header: "Stage", value: (d) => d.Stage ?? "" },
        { header: "Pipeline", value: (d) => d.Pipeline ?? "" },
        { header: "LOC", value: (d) => d.Admitted_Level_of_Care ?? "" },
        { header: "VOB date", value: (d) => d.VOB_Submitted_Date ?? "" },
        { header: "Refer-out date", value: (d) => d.Refer_Out_Date ?? "" },
        { header: "Modified", value: (d) => d.Modified_Time ?? "" },
        { header: "Zoho ID", value: (d) => d.id },
      ], deals);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {repName}
          <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[drilldown.category]}</Badge>
          {drilldown.loc && <Badge variant="outline" className="text-[10px]">LOC: {drilldown.loc}</Badge>}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-2 flex-wrap">
          <span>
            {deals == null ? "Loading…" : `${deals.length} record${deals.length === 1 ? "" : "s"}`}
            {pipelines && pipelines.length > 0 && <span className="ml-1">· {pipelines.join(", ")}</span>}
          </span>
          {deals && deals.length > 0 && (
            <Button size="sm" variant="outline" onClick={downloadCsv} className="h-7 text-[11px] ml-auto">
              Download CSV
            </Button>
          )}
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
        <tr>
          <th className="text-left py-2 pr-3">Title</th>
          <th className="text-left py-2 pr-3">Company</th>
          <th className="text-left py-2 pr-3">Contact</th>
          <th className="text-left py-2 pr-3">Venue</th>
          <th className="text-right py-2 pr-3">When</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const what = m.What_Id; const who = m.Who_Id;
          const companyName = typeof what === "string" ? what : what?.name ?? null;
          const contactName = typeof who === "string" ? who : who?.name ?? null;
          return (
            <tr key={m.id} className="border-t align-top">
              <td className="py-2 pr-3 font-medium">{m.Event_Title ?? "(untitled)"}</td>
              <td className="py-2 pr-3 text-xs">{companyName ? <span className="text-blue-600 dark:text-blue-400">{companyName}</span> : <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2 pr-3 text-xs">{contactName ? <span className="text-violet-600 dark:text-violet-400">{contactName}</span> : <span className="text-muted-foreground">—</span>}</td>
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

// ── Saved Views row ──────────────────────────────────────────────────
function SavedViewsRow({
  views, activeId, apply, remove, savingNew, setSavingNew, newName, setNewName, commit,
}: {
  views: BdSavedView[]; activeId: string | null;
  apply: (v: BdSavedView) => void; remove: (id: string) => void;
  savingNew: boolean; setSavingNew: (b: boolean) => void;
  newName: string; setNewName: (s: string) => void;
  commit: () => void;
}) {
  if (views.length === 0 && !savingNew) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          <Bookmark className="w-3.5 h-3.5" /> Saved views
        </span>
        <Button size="sm" variant="outline" onClick={() => setSavingNew(true)} className="h-7 text-[11px] px-2 gap-1">
          <Save className="w-3 h-3" /> Save current as…
        </Button>
        <span className="text-[10px] text-muted-foreground">no views yet</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
        <Bookmark className="w-3.5 h-3.5" /> Saved views
      </span>
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center">
          <Button
            size="sm"
            variant={activeId === v.id ? "default" : "outline"}
            onClick={() => apply(v)}
            className="h-7 text-[11px] px-2 rounded-r-none"
            title={`${v.preset}${v.pipelines.length ? " · " + v.pipelines.join("/") : ""}${v.reps.length ? " · reps: " + v.reps.join(", ") : ""}`}
          >
            {v.name}
          </Button>
          <Button
            size="sm" variant={activeId === v.id ? "default" : "outline"}
            onClick={() => { if (confirm(`Delete saved view "${v.name}"?`)) remove(v.id); }}
            className="h-7 px-1.5 rounded-l-none border-l-0"
            title="Delete this saved view"
          >
            <X className="w-3 h-3" />
          </Button>
        </span>
      ))}
      {savingNew ? (
        <span className="inline-flex items-center gap-1">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setSavingNew(false); }}
            placeholder="Name this view…"
            className="h-7 text-[11px] w-44"
          />
          <Button size="sm" onClick={commit} disabled={!newName.trim()} className="h-7 text-[11px] px-2">Save</Button>
          <Button size="sm" variant="outline" onClick={() => setSavingNew(false)} className="h-7 text-[11px] px-2">Cancel</Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setSavingNew(true)} className="h-7 text-[11px] px-2 gap-1">
          <Save className="w-3 h-3" /> Save current
        </Button>
      )}
    </div>
  );
}

// ── Referrals (legacy inline view) ───────────────────────────────────
// Promoted to its own page at /bd/referrals (see src/pages/bd/referrals.tsx
// + the left-nav entry). The inline component below is dead code kept
// only as a quick rollback path — not rendered anywhere. Safe to delete
// once /bd/referrals has been in production for a release or two.
interface BdReferralsList {
  ok: boolean;
  window: { start: string; end: string };
  referrals: Array<{
    id: string;
    direction: "in" | "out";
    deal_name: string | null;
    stage: string | null;
    pipeline: string | null;
    bd_rep: string | null;
    account_id: string | null;
    account_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
    loc: string | null;
    timestamp: string | null;        // event timestamp (Created_Time for in, Refer_Out_Date or Modified_Time for out)
  }>;
}

function ReferralsView({
  startIso, endIso, winLabel, preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd,
  pipelineGroups, togglePipeline, clearPipelines, pipelinesParam, resolveRep,
}: {
  startIso: string; endIso: string; winLabel: string;
  preset: WindowPreset; setPreset: (p: WindowPreset) => void;
  customStart: string; setCustomStart: (s: string) => void;
  customEnd: string; setCustomEnd: (s: string) => void;
  pipelineGroups: Set<PipelineGroup>; togglePipeline: (g: PipelineGroup) => void; clearPipelines: () => void;
  pipelinesParam: string[] | undefined;
  resolveRep: (s: string) => { name: string; profileId: string | null };
}) {
  const [data, setData] = useState<BdReferralsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"timestamp" | "account" | "stage" | "rep">("timestamp");
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-referrals-list`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ start_iso: startIso, end_iso: endIso, pipelines: pipelinesParam }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [startIso, endIso, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  const distinctStatuses = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.referrals) if (r.stage) s.add(r.stage);
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.referrals;
    if (direction !== "all") rows = rows.filter((r) => r.direction === direction);
    if (statusFilter !== "all") rows = rows.filter((r) => r.stage === statusFilter);
    rows = rows.slice().sort((a, b) => {
      const cmp = (() => {
        if (sortKey === "timestamp") return (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
        if (sortKey === "account") return (a.account_name ?? "").localeCompare(b.account_name ?? "");
        if (sortKey === "stage") return (a.stage ?? "").localeCompare(b.stage ?? "");
        if (sortKey === "rep") return (a.bd_rep ?? "").localeCompare(b.bd_rep ?? "");
        return 0;
      })();
      return sortDesc ? -cmp : cmp;
    });
    return rows;
  }, [data, direction, statusFilter, sortKey, sortDesc]);

  function downloadCsv() {
    if (!data) return;
    const header = ["direction", "timestamp", "deal_name", "account", "contact", "stage", "pipeline", "loc", "bd_rep"];
    const rows = filtered.map((r) => [
      r.direction, r.timestamp ?? "", r.deal_name ?? "", r.account_name ?? "",
      r.contact_name ?? "", r.stage ?? "", r.pipeline ?? "", r.loc ?? "", r.bd_rep ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map((v) => {
      const s = String(v); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bd-referrals-${startIso.slice(0, 10)}-to-${endIso.slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function header(key: typeof sortKey, label: string) {
    const active = sortKey === key;
    return (
      <button onClick={() => { if (active) setSortDesc(!sortDesc); else { setSortKey(key); setSortDesc(true); } }}
        className={`text-left inline-flex items-center gap-0.5 ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {label}{active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    );
  }

  return (
    <>
      {/* Date + pipeline filters (shared with Live tab via parent state) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
          {PRESETS.map((p) => (
            <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => setPreset(p.key)} className="h-8 text-xs">{p.label}</Button>
          ))}
          <Button size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => setPreset("custom")} className="h-8 text-xs">Custom</Button>
          {preset === "custom" && (
            <span className="flex items-center gap-1.5 ml-2">
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 text-xs w-36" />
              <span className="text-[10px] text-muted-foreground">→</span>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 text-xs w-36" />
            </span>
          )}
          <span className="text-[10px] text-muted-foreground ml-2">{winLabel}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
          <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={clearPipelines} className="h-8 text-xs">All</Button>
          {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
            <Button key={g} size="sm" variant={pipelineGroups.has(g) ? "default" : "outline"} onClick={() => togglePipeline(g)} className="h-8 text-xs">{g}</Button>
          ))}
        </div>
        {/* Referrals-specific filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Direction</span>
          {(["all", "in", "out"] as const).map((d) => (
            <Button key={d} size="sm" variant={direction === d ? "default" : "outline"} onClick={() => setDirection(d)} className="h-8 text-xs">
              {d === "all" ? "All" : d === "in" ? "Inbound" : "Outbound"}
            </Button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 text-xs px-2 rounded border bg-background"
          >
            <option value="all">All statuses</option>
            {distinctStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-muted-foreground ml-2">
            {data ? `${filtered.length} of ${data.referrals.length}` : ""}
          </span>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!data || filtered.length === 0} className="ml-auto h-8 text-xs gap-1.5">
            Download CSV
          </Button>
        </div>
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}

      {!data && loading && (
        <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading referrals…</CardContent></Card>
      )}

      {data && filtered.length === 0 && !loading && (
        <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No referrals match the current filters.</CardContent></Card>
      )}

      {data && filtered.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-3">Dir</th>
                  <th className="text-left py-2 pr-3">{header("timestamp", "When")}</th>
                  <th className="text-left py-2 pr-3">Deal</th>
                  <th className="text-left py-2 pr-3">{header("account", "Account")}</th>
                  <th className="text-left py-2 pr-3">Contact</th>
                  <th className="text-left py-2 pr-3">{header("stage", "Status")}</th>
                  <th className="text-left py-2 pr-3">Pipeline</th>
                  <th className="text-left py-2 pr-3">LOC</th>
                  <th className="text-left py-2 pr-3">{header("rep", "BD rep")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const repInfo = r.bd_rep ? resolveRep(r.bd_rep) : { name: "—", profileId: null };
                  return (
                    <tr key={`${r.direction}-${r.id}`} className="border-t align-top">
                      <td className="py-2 pr-3"><Badge variant="outline" className={`text-[9px] ${r.direction === "in" ? "border-blue-500/30 text-blue-700 dark:text-blue-300" : "border-orange-500/30 text-orange-700 dark:text-orange-300"}`}>{r.direction === "in" ? "IN" : "OUT"}</Badge></td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums">{r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "—"}</td>
                      <td className="py-2 pr-3 font-medium">{r.deal_name ?? "(no name)"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {r.account_id ? (
                          <Link href={`/bd/account?id=${r.account_id}`} className="text-primary hover:underline">{r.account_name ?? "—"}</Link>
                        ) : (r.account_name ?? "—")}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {r.contact_name ? (
                          <div className="space-y-0.5">
                            <div>{r.contact_name}</div>
                            {r.contact_email && <div className="text-[10px] text-muted-foreground">{r.contact_email}</div>}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[10px]">{r.stage ?? "—"}</Badge></td>
                      <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{r.pipeline ?? "—"}</Badge></td>
                      <td className="py-2 pr-3 text-xs">{r.loc ? <Badge variant="outline" className="text-[9px]">{r.loc}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3 text-xs">{repInfo.name}</td>
                      <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Potentials/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
function isoDay(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
