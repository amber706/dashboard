// /bd/referrals — flat list of every referral, in or out, across the
// selected window. Promoted from a tab inside /bd to its own page so
// it lives in the left nav and has room to breathe.
//
// Top tabs: Referrals in / Referrals out (replaces the old "Direction"
// radio). Each tab shows the deal-level rows for that direction with
// status, BD rep, admissions rep, account, contact, LOC, pipeline.
//
// Filters:
//   - Window presets (Today, Last 24h, WTD, MTD, 7d / 30d / 90d / YTD,
//     Custom)
//   - Pipeline multi-select (DUI / DV / Commercial / AHCCCS)
//   - Status (Stage) dropdown — populated from the result set
//
// Sortable headers, CSV export, link out to Zoho per row.

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, RefreshCw, ArrowLeft, ExternalLink,
  TrendingUp, ArrowRight, BarChart3,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/dashboard/PageShell";
import { exportCsv, isoToDay } from "@/lib/bd-csv";

const PIPELINE_GROUPS = {
  DUI: ["DUI", "DUI - Cash"],
  DV: ["DV - Cash"],
  Commercial: ["Commercial-Cash"],
  AHCCCS: ["AHCCCS"],
} as const;
type PipelineGroup = keyof typeof PIPELINE_GROUPS;

type WindowPreset =
  | "today" | "last_24h" | "wtd" | "mtd"
  | "last_7" | "last_30" | "last_90" | "ytd" | "custom";

function computeWindow(preset: WindowPreset, customStart?: string, customEnd?: string): { startIso: string; endIso: string; label: string } {
  const now = new Date();
  const isoUtc = (d: Date) => d.toISOString().slice(0, 19) + "+00:00";
  const startOfToday = () => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = () => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const startOfWeek = () => {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const dow = t.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    t.setDate(t.getDate() + diff);
    return t;
  };
  const startOfMonth = () => new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const startOfYear = () => new Date(now.getFullYear(), 0, 1, 0, 0, 0);
  const subDays = (n: number) => new Date(now.getTime() - n * 86400_000);

  switch (preset) {
    case "today":    return { startIso: isoUtc(startOfToday()), endIso: isoUtc(endOfToday()), label: "Today" };
    case "last_24h": return { startIso: isoUtc(subDays(1)), endIso: isoUtc(now), label: "Last 24h" };
    case "wtd":      return { startIso: isoUtc(startOfWeek()), endIso: isoUtc(endOfToday()), label: "Week to date" };
    case "mtd":      return { startIso: isoUtc(startOfMonth()), endIso: isoUtc(endOfToday()), label: "Month to date" };
    case "last_7":   return { startIso: isoUtc(subDays(7)), endIso: isoUtc(now), label: "Last 7 days" };
    case "last_30":  return { startIso: isoUtc(subDays(30)), endIso: isoUtc(now), label: "Last 30 days" };
    case "last_90":  return { startIso: isoUtc(subDays(90)), endIso: isoUtc(now), label: "Last 90 days" };
    case "ytd":      return { startIso: isoUtc(startOfYear()), endIso: isoUtc(endOfToday()), label: "Year to date" };
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

interface RefRow {
  id: string;
  direction: "in" | "out";
  deal_name: string | null;
  stage: string | null;
  pipeline: string | null;
  bd_rep: string | null;
  owner_id: string | null;
  account_id: string | null;
  account_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  loc: string | null;
  timestamp: string | null;
  // Outbound-only fields. Null on inbound rows.
  refer_out_type?: string | null;       // why we sent them out
  admitted_at_referred?: boolean | null; // did they admit at the destination
}

interface BdReferralsList {
  ok: boolean;
  window: { start: string; end: string };
  referrals: RefRow[];
  users: Record<string, { full_name: string | null; email: string | null }>;
}

interface RepProfile { id: string; full_name: string | null; email: string | null; zoho_user_id: string | null; }

export default function BdReferrals() {
  // Filters — same shape as the dashboard's, defaulting to MTD.
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [preset, setPreset] = useState<WindowPreset>("mtd");
  const [customStart, setCustomStart] = useState<string>(() => isoDay(new Date(Date.now() - 7 * 86400_000)));
  const [customEnd, setCustomEnd] = useState<string>(() => isoDay(new Date()));
  const win = useMemo(() => computeWindow(preset, customStart, customEnd), [preset, customStart, customEnd]);
  // Default to Commercial + AHCCCS — the two treatment service lines.
  // DUI / DV are separate service lines and skew the numbers if mixed in.
  const [pipelineGroups, setPipelineGroups] = useState<Set<PipelineGroup>>(new Set(["Commercial", "AHCCCS"]));
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // LOC filter — applies to the flat list. The By-LOC view ignores it
  // because that view's whole job is to break the data out per LOC.
  const [locFilter, setLocFilter] = useState<string>("all");
  // View toggle. "list" is the flat sortable table; "by_loc" is the new
  // per-level-of-care breakdown with the current-vs-prior comparison and
  // the stacked bar chart.
  const [view, setView] = useState<"list" | "by_loc">("list");
  const [sortKey, setSortKey] = useState<"timestamp" | "account" | "stage" | "rep" | "owner">("timestamp");
  const [sortDesc, setSortDesc] = useState(true);

  const [data, setData] = useState<BdReferralsList | null>(null);
  const [priorData, setPriorData] = useState<BdReferralsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<RepProfile[]>([]);

  const pipelinesParam = useMemo(() => {
    if (pipelineGroups.size === 0) return undefined;
    const out: string[] = [];
    for (const g of pipelineGroups) out.push(...PIPELINE_GROUPS[g]);
    return out;
  }, [pipelineGroups]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-referrals-list`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ start_iso: win.startIso, end_iso: win.endIso, pipelines: pipelinesParam }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [win.startIso, win.endIso, pipelinesParam]);

  useEffect(() => { load(); }, [load]);

  // Prior-window fetch for the By-LOC comparison view. Same length as
  // the current window, shifted back so we can show "Apr referred X, May
  // referring Y" deltas per account. Skipped until the user opens the
  // By-LOC tab to avoid extra Zoho COQL pages on every page load.
  useEffect(() => {
    if (view !== "by_loc") return;
    const startMs = new Date(win.startIso).getTime();
    const endMs = new Date(win.endIso).getTime();
    const span = endMs - startMs;
    if (!Number.isFinite(span) || span <= 0) return;
    const priorEnd = new Date(startMs - 1).toISOString().slice(0, 19) + "+00:00";
    const priorStart = new Date(startMs - 1 - span).toISOString().slice(0, 19) + "+00:00";
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-referrals-list`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ start_iso: priorStart, end_iso: priorEnd, pipelines: pipelinesParam }),
        });
        const json = await res.json();
        if (json.ok) setPriorData(json);
      } catch { /* non-fatal — the view still works without prior */ }
    })();
  }, [view, win.startIso, win.endIso, pipelinesParam]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, zoho_user_id")
        .eq("is_active", true);
      setProfiles((data ?? []) as RepProfile[]);
    })();
  }, []);

  function resolveBdRep(bdRep: string | null): string {
    if (!bdRep) return "—";
    const trimmed = bdRep.trim();
    if (!trimmed || trimmed === "(unassigned)" || trimmed === "None") return "(unassigned)";
    const target = trimmed.toLowerCase();
    const exact = profiles.find((p) => (p.full_name ?? "").trim().toLowerCase() === target);
    if (exact) return exact.full_name ?? trimmed;
    const firstNameMatch = profiles.find((p) => {
      const fn = (p.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
      return fn && fn === target;
    });
    return firstNameMatch?.full_name ?? trimmed;
  }
  // Admissions rep resolved from the deal's Owner.id via the embedded
  // Zoho users map (full_name / email). Falls back to the local
  // profiles table by zoho_user_id if Zoho's name is missing.
  function resolveAdmissionsRep(ownerId: string | null): string {
    if (!ownerId) return "—";
    const u = data?.users?.[ownerId];
    if (u?.full_name) return u.full_name;
    const p = profiles.find((p) => p.zoho_user_id === ownerId);
    if (p?.full_name) return p.full_name;
    if (u?.email) return u.email;
    return `(zoho ${ownerId.slice(-6)})`;
  }

  function togglePipeline(g: PipelineGroup) {
    setPipelineGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }

  const distinctStatuses = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.referrals) {
      if (r.direction === direction && r.stage) s.add(r.stage);
    }
    return Array.from(s).sort();
  }, [data, direction]);

  // LOC dropdown values — every distinct Admitted_Level_of_Care seen on
  // the current-direction referrals, plus a "(no LOC)" bucket for rows
  // missing the field. Sorted alphabetically.
  const distinctLocs = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.referrals) {
      if (r.direction === direction) s.add(normLoc(r.loc));
    }
    return Array.from(s).sort();
  }, [data, direction]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.referrals.filter((r) => r.direction === direction);
    if (statusFilter !== "all") rows = rows.filter((r) => r.stage === statusFilter);
    if (locFilter !== "all") rows = rows.filter((r) => normLoc(r.loc) === locFilter);
    rows = rows.slice().sort((a, b) => {
      const cmp = (() => {
        if (sortKey === "timestamp") return (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
        if (sortKey === "account") return (a.account_name ?? "").localeCompare(b.account_name ?? "");
        if (sortKey === "stage") return (a.stage ?? "").localeCompare(b.stage ?? "");
        if (sortKey === "rep") return (a.bd_rep ?? "").localeCompare(b.bd_rep ?? "");
        if (sortKey === "owner") return resolveAdmissionsRep(a.owner_id).localeCompare(resolveAdmissionsRep(b.owner_id));
        return 0;
      })();
      return sortDesc ? -cmp : cmp;
    });
    return rows;
  }, [data, direction, statusFilter, locFilter, sortKey, sortDesc]);

  function header(key: typeof sortKey, label: string) {
    const active = sortKey === key;
    return (
      <button onClick={() => { if (active) setSortDesc(!sortDesc); else { setSortKey(key); setSortDesc(true); } }}
        className={`text-left inline-flex items-center gap-0.5 ${active ? "text-foreground" : "text-muted-foreground"}`}>
        {label}{active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    );
  }

  function downloadCsv() {
    if (!data) return;
    exportCsv<RefRow>(`bd-referrals-${direction}-${isoToDay(win.startIso)}-to-${isoToDay(win.endIso)}.csv`, [
      { header: "Direction", value: (r) => r.direction },
      { header: direction === "out" ? "Refer-out date" : "When", value: (r) => r.timestamp ?? "" },
      { header: "Deal", value: (r) => r.deal_name ?? "" },
      { header: direction === "out" ? "Referred to" : "Referring company", value: (r) => r.account_name ?? "" },
      { header: "Account ID", value: (r) => r.account_id ?? "" },
      { header: "Contact", value: (r) => r.contact_name ?? "" },
      { header: "Contact email", value: (r) => r.contact_email ?? "" },
      { header: "Status (Stage)", value: (r) => r.stage ?? "" },
      { header: "Pipeline", value: (r) => r.pipeline ?? "" },
      { header: "LOC", value: (r) => r.loc ?? "" },
      { header: "Refer-out reason", value: (r) => r.refer_out_type ?? "" },
      { header: "Admitted at referred facility", value: (r) => r.admitted_at_referred === true ? "yes" : r.admitted_at_referred === false ? "no" : "" },
      { header: "BD rep", value: (r) => resolveBdRep(r.bd_rep) },
      { header: "Admissions rep", value: (r) => resolveAdmissionsRep(r.owner_id) },
    ], filtered);
  }

  const inCount = data?.referrals.filter((r) => r.direction === "in").length ?? 0;
  const outCount = data?.referrals.filter((r) => r.direction === "out").length ?? 0;

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Referrals"
      subtitle="Every referral in & out across the selected window. Status, BD rep, admissions rep, account, contact, LOC."
      maxWidth={1600}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/bd"><Button variant="outline" size="sm" className="gap-1.5 h-9"><ArrowLeft className="w-3.5 h-3.5" /> Performance</Button></Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-9">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </Button>
        </div>
      }
    >
      {/* Top tabs: In / Out / By LOC. "By LOC" pivots the inbound list
          into a per-level-of-care breakdown with current-vs-prior account
          comparison and a stacked bar chart over time. */}
      <div className="flex items-center gap-1 border-b">
        <button
          onClick={() => { setDirection("in"); setStatusFilter("all"); setLocFilter("all"); setView("list"); }}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${view === "list" && direction === "in" ? "border-blue-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <TrendingUp className="w-4 h-4 text-blue-500" /> Referrals in
          <Badge variant="outline" className="text-[10px] ml-1">{inCount}</Badge>
        </button>
        <button
          onClick={() => { setDirection("out"); setStatusFilter("all"); setLocFilter("all"); setView("list"); }}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${view === "list" && direction === "out" ? "border-orange-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <ArrowRight className="w-4 h-4 text-orange-500" /> Referrals out
          <Badge variant="outline" className="text-[10px] ml-1">{outCount}</Badge>
        </button>
        <button
          onClick={() => { setView("by_loc"); setDirection("in"); }}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${view === "by_loc" ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <BarChart3 className="w-4 h-4 text-emerald-500" /> By LOC
        </button>
      </div>

      {/* Filters */}
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
          <span className="text-[10px] text-muted-foreground ml-2">{win.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
          <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={() => setPipelineGroups(new Set())} className="h-8 text-xs">All</Button>
          {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
            <Button key={g} size="sm" variant={pipelineGroups.has(g) ? "default" : "outline"} onClick={() => togglePipeline(g)} className="h-8 text-xs">{g}</Button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 text-xs px-2 rounded border bg-background">
            <option value="all">All statuses</option>
            {distinctStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-2">LOC</span>
          <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)} className="h-8 text-xs px-2 rounded border bg-background">
            <option value="all">All LOCs</option>
            {distinctLocs.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-xs text-muted-foreground ml-2">
            {data && view === "list" ? `${filtered.length} of ${direction === "in" ? inCount : outCount}` : ""}
          </span>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!data || filtered.length === 0 || view === "by_loc"} className="ml-auto h-8 text-xs">
            Download CSV
          </Button>
        </div>
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}
      {!data && loading && <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading referrals…</CardContent></Card>}
      {view === "list" && data && filtered.length === 0 && !loading && <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">No referrals match the current filters.</CardContent></Card>}

      {view === "by_loc" && data && (
        <ByLocView
          current={data.referrals.filter((r) =>
            r.direction === "in" &&
            (statusFilter === "all" || r.stage === statusFilter) &&
            (locFilter === "all" || normLoc(r.loc) === locFilter)
          )}
          prior={priorData?.referrals.filter((r) =>
            r.direction === "in" &&
            (statusFilter === "all" || r.stage === statusFilter) &&
            (locFilter === "all" || normLoc(r.loc) === locFilter)
          ) ?? null}
          windowStart={win.startIso}
          windowEnd={win.endIso}
          locFilter={locFilter}
        />
      )}

      {view === "list" && data && filtered.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-3">{header("timestamp", direction === "out" ? "Refer-out date" : "When")}</th>
                  <th className="text-left py-2 pr-3">Deal</th>
                  <th className="text-left py-2 pr-3">{header("account", direction === "in" ? "Referring company" : "Referred to")}</th>
                  {direction === "in" && <th className="text-left py-2 pr-3">Contact</th>}
                  {direction === "out" && <th className="text-left py-2 pr-3">Refer-out reason</th>}
                  {direction === "out" && <th className="text-left py-2 pr-3">Admitted there?</th>}
                  <th className="text-left py-2 pr-3">{header("stage", "Status")}</th>
                  <th className="text-left py-2 pr-3">Pipeline</th>
                  <th className="text-left py-2 pr-3">LOC</th>
                  <th className="text-left py-2 pr-3">{header("rep", "BD rep")}</th>
                  <th className="text-left py-2 pr-3">{header("owner", "Admissions rep")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.direction}-${r.id}`} className="border-t align-top">
                    <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums">{r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "—"}</td>
                    <td className="py-2 pr-3 font-medium">{r.deal_name ?? "(no name)"}</td>
                    <td className="py-2 pr-3 text-xs">
                      {r.account_id ? (
                        <Link href={`/bd/account?id=${r.account_id}`} className="text-primary hover:underline">{r.account_name ?? "—"}</Link>
                      ) : (r.account_name ?? "—")}
                    </td>
                    {direction === "in" && (
                      <td className="py-2 pr-3 text-xs">
                        {r.contact_name ? (
                          <div className="space-y-0.5">
                            <div>{r.contact_name}</div>
                            {r.contact_email && <div className="text-[10px] text-muted-foreground">{r.contact_email}</div>}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    )}
                    {direction === "out" && (
                      <td className="py-2 pr-3 text-xs">
                        {r.refer_out_type ? (
                          <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-700 dark:text-orange-300">{r.refer_out_type}</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    )}
                    {direction === "out" && (
                      <td className="py-2 pr-3 text-xs">
                        {r.admitted_at_referred === true ? (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5">Yes</Badge>
                        ) : r.admitted_at_referred === false ? (
                          <span className="text-muted-foreground">No</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[10px]">{r.stage ?? "—"}</Badge></td>
                    <td className="py-2 pr-3 text-xs"><Badge variant="outline" className="text-[9px]">{r.pipeline ?? "—"}</Badge></td>
                    <td className="py-2 pr-3 text-xs">{r.loc ? <Badge variant="outline" className="text-[9px]">{r.loc}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 pr-3 text-xs">{resolveBdRep(r.bd_rep)}</td>
                    <td className="py-2 pr-3 text-xs">{resolveAdmissionsRep(r.owner_id)}</td>
                    <td className="py-2 pr-3"><a href={`https://crm.zoho.com/crm/tab/Potentials/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Zoho <ExternalLink className="w-3 h-3" /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function isoDay(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Canonicalize the LOC label. Empty/null becomes "(no LOC)" so it falls
// into a single bucket instead of multiple invisible-empty groups.
function normLoc(loc: string | null | undefined): string {
  const v = (loc ?? "").trim();
  return v || "(no LOC)";
}

// Bucket granularity for the stacked bar chart — depends on the window
// width. Very short windows render daily bars, MTD/30d renders weekly,
// longer windows roll up to monthly so the chart stays legible.
function bucketKey(iso: string, granularity: "day" | "week" | "month"): string {
  const d = new Date(iso);
  if (granularity === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (granularity === "day")   return d.toISOString().slice(0, 10);
  // Week: ISO week start (Monday)
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

// 7-color palette for stacked LOC bars and per-LOC card headers. Cycles
// for orgs with more than 7 active LOCs.
const LOC_COLORS = [
  "hsl(210, 80%, 55%)", "hsl(160, 70%, 45%)", "hsl(45, 85%, 55%)",
  "hsl(280, 55%, 55%)", "hsl(340, 65%, 55%)", "hsl(20, 80%, 55%)",
  "hsl(190, 70%, 50%)",
];

function ByLocView({ current, prior, windowStart, windowEnd, locFilter }: {
  current: RefRow[];
  prior: RefRow[] | null;
  windowStart: string;
  windowEnd: string;
  locFilter: string;
}) {
  const spanDays = Math.max(1, Math.round((new Date(windowEnd).getTime() - new Date(windowStart).getTime()) / 86_400_000));
  const granularity: "day" | "week" | "month" = spanDays <= 21 ? "day" : spanDays <= 95 ? "week" : "month";

  // Aggregate per-LOC totals + per-account-per-LOC counts for the current
  // window. Mirror the same shape for the prior window so we can show
  // current vs. prior side-by-side.
  const currentByLoc = useMemo(() => groupByLoc(current), [current]);
  const priorByLoc   = useMemo(() => prior ? groupByLoc(prior) : null, [prior]);

  // Order LOCs by current referral volume, descending. LOCs that only
  // exist in prior data still get a row so a drop to zero is visible.
  const locKeys = useMemo(() => {
    const all = new Set<string>([...Object.keys(currentByLoc), ...Object.keys(priorByLoc ?? {})]);
    return Array.from(all).sort((a, b) => (currentByLoc[b]?.total ?? 0) - (currentByLoc[a]?.total ?? 0));
  }, [currentByLoc, priorByLoc]);

  // Stacked-bar chart data — one row per bucket, with a numeric series
  // per LOC. We cap the series to top-7 LOCs by volume so the legend
  // stays readable; anything else rolls into "Other".
  const chartData = useMemo(() => {
    const topLocs = locKeys.slice(0, 7);
    const otherSet = new Set(locKeys.slice(7));
    const buckets = new Map<string, Record<string, number | string>>();
    for (const r of current) {
      if (!r.timestamp) continue;
      const key = bucketKey(r.timestamp, granularity);
      let row = buckets.get(key);
      if (!row) { row = { bucket: key }; buckets.set(key, row); }
      const loc = normLoc(r.loc);
      const series = otherSet.has(loc) ? "Other" : loc;
      row[series] = ((row[series] as number | undefined) ?? 0) + 1;
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
  }, [current, locKeys, granularity]);
  const chartLocs = useMemo(() => {
    const top = locKeys.slice(0, 7);
    const hasOther = locKeys.length > 7;
    return hasOther ? [...top, "Other"] : top;
  }, [locKeys]);

  if (current.length === 0) {
    const msg = locFilter !== "all"
      ? `No inbound referrals match the current filters (LOC: ${locFilter}).`
      : "No inbound referrals match the current filters.";
    return <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground text-center">{msg}</CardContent></Card>;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inbound referrals by level of care</CardTitle>
          <p className="text-xs text-muted-foreground">Stacked by LOC, bucketed {granularity === "day" ? "daily" : granularity === "week" ? "weekly" : "monthly"}. Top 7 LOCs shown.</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {chartLocs.map((loc, i) => (
                <Bar key={loc} dataKey={loc} stackId="a" fill={LOC_COLORS[i % LOC_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {locKeys.map((loc, i) => {
          const cur = currentByLoc[loc] ?? { total: 0, byAccount: {} };
          const prv = priorByLoc?.[loc] ?? { total: 0, byAccount: {} };
          const color = LOC_COLORS[i % LOC_COLORS.length];
          const totalDelta = cur.total - prv.total;
          // Rank accounts by max(current, prior) so accounts that dropped
          // to zero still surface in the comparison.
          const accountKeys = Array.from(new Set([...Object.keys(cur.byAccount), ...Object.keys(prv.byAccount)]))
            .sort((a, b) => Math.max(cur.byAccount[b] ?? 0, prv.byAccount[b] ?? 0) - Math.max(cur.byAccount[a] ?? 0, prv.byAccount[a] ?? 0))
            .slice(0, 8);
          return (
            <Card key={loc}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  {loc}
                  <Badge variant="outline" className="text-[10px]">{cur.total} now</Badge>
                  {prior && (
                    <Badge variant="outline" className={`text-[10px] ${totalDelta > 0 ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : totalDelta < 0 ? "border-rose-500/40 text-rose-700 dark:text-rose-400" : ""}`}>
                      {totalDelta >= 0 ? "+" : ""}{totalDelta} vs prior
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {accountKeys.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No accounts.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left py-1.5 pr-2">Account</th>
                        <th className="text-right py-1.5 pr-2">Now</th>
                        {prior && <th className="text-right py-1.5 pr-2">Prior</th>}
                        {prior && <th className="text-right py-1.5">Δ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {accountKeys.map((acctKey) => {
                        const curN = cur.byAccount[acctKey] ?? 0;
                        const prvN = prv.byAccount[acctKey] ?? 0;
                        const delta = curN - prvN;
                        const [acctId, acctName] = acctKey.split("|", 2);
                        return (
                          <tr key={acctKey} className="border-t">
                            <td className="py-1.5 pr-2">
                              {acctId ? (
                                <Link href={`/bd/account?id=${acctId}`} className="text-primary hover:underline">{acctName || "—"}</Link>
                              ) : (acctName || "—")}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{curN}</td>
                            {prior && <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{prvN}</td>}
                            {prior && (
                              <td className={`py-1.5 text-right tabular-nums ${delta > 0 ? "text-emerald-700 dark:text-emerald-400" : delta < 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>
                                {delta >= 0 ? "+" : ""}{delta}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!prior && (
        <p className="text-xs text-muted-foreground">Loading prior-window comparison…</p>
      )}
    </>
  );
}

// Roll referrals up to { LOC → { total, byAccount: { "id|name": count } } }.
// Account key joins id + name so we can render a stable Link to /bd/account
// while still showing the name even when the id is missing.
function groupByLoc(rows: RefRow[]): Record<string, { total: number; byAccount: Record<string, number> }> {
  const out: Record<string, { total: number; byAccount: Record<string, number> }> = {};
  for (const r of rows) {
    const loc = normLoc(r.loc);
    let entry = out[loc];
    if (!entry) { entry = { total: 0, byAccount: {} }; out[loc] = entry; }
    entry.total++;
    const acctKey = `${r.account_id ?? ""}|${r.account_name ?? ""}`;
    if (acctKey === "|") continue;
    entry.byAccount[acctKey] = (entry.byAccount[acctKey] ?? 0) + 1;
  }
  return out;
}
