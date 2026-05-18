// /bd/account-trends — month-over-month chart of referrals vs admits
// for top referring accounts, filterable by LOC + pipeline + window,
// with an account picker that scopes the chart to a single account.
//
// Powered by edge function bd-account-trends, which pulls Deals with
// Referring_Company set over the last N months and aggregates per
// (account, month, kind) using the standard LOC semantics (referrals
// = requested-LOC, admits = admitted-LOC, with cross-fallback).

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import { Loader2, RefreshCw, ArrowLeft, BarChart3, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/dashboard/PageShell";

const PIPELINE_GROUPS = {
  DUI: ["DUI", "DUI - Cash"],
  DV: ["DV - Cash"],
  Commercial: ["Commercial-Cash"],
  AHCCCS: ["AHCCCS"],
} as const;
type PipelineGroup = keyof typeof PIPELINE_GROUPS;

interface AccountTrend {
  id: string;
  name: string;
  total_referrals: number;
  total_admits: number;
  total_refer_outs?: number;
  total_meetings?: number;
  conversion_rate: number | null;
  // Per-month bucket. v6 of bd-account-trends adds refer_outs +
  // meetings; older deployments may not include them — fields are
  // optional and we treat missing as 0.
  by_month: Record<string, {
    referrals: number; admits: number;
    refer_outs?: number; meetings?: number;
  }>;
}

interface TrendsResponse {
  ok: boolean;
  window: { months: number; start: string; end: string };
  months: string[];
  accounts: AccountTrend[];
}

// Discovered LOCs that show up across Cornerstone's deal stream. Used
// to seed the LOC dropdown; the page also picks up anything else the
// edge function happens to return via the account totals.
const COMMON_LOCS = [
  "RTC", "PHP", "IOP", "IOP5", "OP", "BHRF",
  "VIOP Adult", "VIOP Adolescent",
  "Detox", "DTX", "Screening", "Classes",
];

export default function BdAccountTrends() {
  const [months, setMonths] = useState<number>(12);
  const [pipelineGroups, setPipelineGroups] = useState<Set<PipelineGroup>>(new Set(["Commercial", "AHCCCS"]));
  const [loc, setLoc] = useState<string>("all");
  // "" / "all" means "all accounts combined" on the chart. Otherwise
  // the chart shows just the picked account.
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");

  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bd-account-trends`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ months, pipelines: pipelinesParam, loc }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [months, pipelinesParam, loc]);

  useEffect(() => { load(); }, [load]);

  function togglePipeline(g: PipelineGroup) {
    setPipelineGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }

  // Compose the chart rows. Each row is { month, referrals, admits }.
  // "All accounts" sums every account; a single account picks just
  // that account's monthly counts.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.months.map((mk) => {
      let referrals = 0; let admits = 0;
      if (selectedAccountId === "all") {
        for (const a of data.accounts) {
          const b = a.by_month[mk];
          if (b) { referrals += b.referrals; admits += b.admits; }
        }
      } else {
        const a = data.accounts.find((x) => x.id === selectedAccountId);
        const b = a?.by_month[mk];
        if (b) { referrals = b.referrals; admits = b.admits; }
      }
      // Pretty month label: "Jun 2025" instead of "2025-06"
      const [y, m] = mk.split("-").map(Number);
      const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      return { month: label, referrals, admits };
    });
  }, [data, selectedAccountId]);

  const topAccounts = useMemo(() => data?.accounts.slice(0, 25) ?? [], [data]);

  // Trend per account = (last full month referrals) − (prior month referrals).
  // The current month is partial, so we skip it and compare the previous
  // two complete months. If the window is too short for that, we fall
  // back to comparing whatever pair we have.
  const trendByAccount = useMemo(() => {
    if (!data || data.months.length < 2) return new Map<string, { delta: number; current: number; prior: number }>();
    const all = data.months;
    // Current calendar month key, e.g. "2026-05"
    const now = new Date();
    const currentMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Months excluding the in-progress current month (if it's the last bucket)
    const usable = all[all.length - 1] === currentMk ? all.slice(0, -1) : all;
    if (usable.length < 2) {
      const last = all[all.length - 1];
      const prior = all[all.length - 2];
      const m = new Map<string, { delta: number; current: number; prior: number }>();
      for (const a of data.accounts) {
        const c = a.by_month[last]?.referrals ?? 0;
        const p = a.by_month[prior]?.referrals ?? 0;
        m.set(a.id, { delta: c - p, current: c, prior: p });
      }
      return m;
    }
    const last = usable[usable.length - 1];
    const prior = usable[usable.length - 2];
    const m = new Map<string, { delta: number; current: number; prior: number }>();
    for (const a of data.accounts) {
      const c = a.by_month[last]?.referrals ?? 0;
      const p = a.by_month[prior]?.referrals ?? 0;
      m.set(a.id, { delta: c - p, current: c, prior: p });
    }
    return m;
  }, [data]);

  // Pretty labels for the two months being compared in the Trend column.
  const trendMonthLabels = useMemo(() => {
    if (!data || data.months.length < 2) return null;
    const now = new Date();
    const currentMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const usable = data.months[data.months.length - 1] === currentMk ? data.months.slice(0, -1) : data.months;
    const pair = usable.length >= 2
      ? [usable[usable.length - 2], usable[usable.length - 1]]
      : [data.months[data.months.length - 2], data.months[data.months.length - 1]];
    const fmt = (mk: string) => {
      const [y, m] = mk.split("-").map(Number);
      return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    };
    return { prior: fmt(pair[0]), current: fmt(pair[1]) };
  }, [data]);

  return (
    <PageShell
      eyebrow="BUSINESS DEVELOPMENT"
      title="Account Trends"
      subtitle="Month-over-month referrals + admits per referring account. Filter by LOC, pipeline, or pick a single account."
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
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
          {[6, 12, 18, 24].map((n) => (
            <Button key={n} size="sm" variant={months === n ? "default" : "outline"} onClick={() => setMonths(n)} className="h-8 text-xs">{n}mo</Button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</span>
          <Button size="sm" variant={pipelineGroups.size === 0 ? "default" : "outline"} onClick={() => setPipelineGroups(new Set())} className="h-8 text-xs">All</Button>
          {(Object.keys(PIPELINE_GROUPS) as PipelineGroup[]).map((g) => (
            <Button key={g} size="sm" variant={pipelineGroups.has(g) ? "default" : "outline"} onClick={() => togglePipeline(g)} className="h-8 text-xs">{g}</Button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">LOC</span>
          <select value={loc} onChange={(e) => setLoc(e.target.value)} className="h-8 text-xs px-2 rounded border bg-background">
            <option value="all">All LOCs</option>
            {COMMON_LOCS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-2">Account</span>
          <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} className="h-8 text-xs px-2 rounded border bg-background max-w-[260px]">
            <option value="all">All accounts (combined)</option>
            {data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.total_referrals}/{a.total_admits})</option>
            ))}
          </select>
        </div>
      </div>

      {error && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}
      {!data && loading && <Card><CardContent className="pt-6 pb-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading account trends…</CardContent></Card>}

      {data && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-500" />
                {selectedAccountId === "all" ? "All accounts" : (data.accounts.find((a) => a.id === selectedAccountId)?.name ?? "Account")}
                <Badge variant="outline" className="text-[10px]">{months}mo</Badge>
                {loc !== "all" && <Badge variant="outline" className="text-[10px]">LOC: {loc}</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Referrals (blue) vs Admits (green), per month. Click an account in the table to scope.</p>
            </CardHeader>
            <CardContent className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="referrals" name="Referrals" fill="hsl(210, 80%, 55%)" />
                  <Bar dataKey="admits" name="Admits" fill="hsl(160, 70%, 45%)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Per-account multi-line chart. Each top account is its own
              line for monthly referrals; admit months are marked with
              a larger filled dot so you can see where each line
              converted vs. where it was just sending volume. */}
          <TopAccountsLineChart accounts={data.accounts} months={data.months} loc={loc} />

          {/* Activity vs outcomes chart. Puts the chosen activity
              (meetings / refer-outs) on the same timeline as referrals
              and admits so the relationship is readable directly:
              when activity spikes, do referrals follow? Do admits?
              Scoped to the current Account dropdown. */}
          <ActivityVsOutcomesChart
            accounts={data.accounts}
            months={data.months}
            loc={loc}
            selectedAccountId={selectedAccountId}
            accountName={selectedAccountId === "all" ? "All accounts" : (data.accounts.find((a) => a.id === selectedAccountId)?.name ?? "Account")}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top referring accounts</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ranked by total referrals in the window. Trend compares the two most recent full months
                {trendMonthLabels ? <> (<span className="font-medium">{trendMonthLabels.current}</span> vs <span className="font-medium">{trendMonthLabels.prior}</span>)</> : null}
                . Click a row to filter the chart to just that account.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {topAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No accounts with activity in this window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    <tr>
                      <th className="text-left py-2 pr-3">#</th>
                      <th className="text-left py-2 pr-3">Account</th>
                      <th className="text-right py-2 pr-3">Referrals</th>
                      <th className="text-right py-2 pr-3">Admits</th>
                      <th className="text-right py-2 pr-3">Conv %</th>
                      <th className="text-right py-2 pr-3">Trend</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAccounts.map((a, i) => {
                      const active = selectedAccountId === a.id;
                      const t = trendByAccount.get(a.id);
                      const delta = t?.delta ?? 0;
                      const trendTone = delta > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : delta < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground";
                      const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
                      return (
                        <tr key={a.id} className={`border-t cursor-pointer hover:bg-accent/40 ${active ? "bg-accent/30" : ""}`} onClick={() => setSelectedAccountId(active ? "all" : a.id)}>
                          <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-3 font-medium">{a.name}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.total_referrals}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.total_admits}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{a.conversion_rate == null ? "—" : `${a.conversion_rate}%`}</td>
                          <td className={`py-2 pr-3 text-right tabular-nums ${trendTone}`} title={t ? `${t.prior} → ${t.current}` : ""}>
                            {arrow} {delta > 0 ? "+" : ""}{delta}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Link href={`/bd/account?id=${a.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline">Open →</Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

// One line per top-referring account showing monthly referrals over
// time. Admit months are demarcated with a larger filled dot on the
// same line so you can see at a glance which accounts converted in
// which months vs. just sending volume.
//
// The LOC filter is already applied at the data layer (see the parent
// load() — pipelines and loc round-trip to bd-account-trends), so this
// chart just consumes whatever the response gives us.
function TopAccountsLineChart({ accounts, months, loc }: {
  accounts: AccountTrend[];
  months: string[];
  loc: string;
}) {
  // How many accounts to plot. More than 7 lines becomes spaghetti, so
  // expose a small control. Skip the synthetic "(BD deal — partner
  // Account not linked)" bucket if it shows up; it's a data-hygiene
  // signal, not a real account.
  const [topN, setTopN] = useState(5);
  // Referrals are always shown as the solid baseline. The overlay
  // toggle adds a dotted line per account for the chosen activity
  // (meetings or refer-outs) so you can read both timelines together
  // without re-ranking the chart.
  const [overlay, setOverlay] = useState<"none" | "meetings" | "refer_outs">("none");

  // Ranking is by referrals (the primary view). Top-N order is stable
  // whether or not an overlay is active.
  const realAccounts = useMemo(() => {
    const filtered = accounts.filter((a) => !a.name.toLowerCase().includes("not linked"));
    const sorted = filtered.slice().sort((x, y) => y.total_referrals - x.total_referrals);
    return sorted.slice(0, topN);
  }, [accounts, topN]);

  // High-contrast palette tuned for the dark UI. Hues are spread far
  // enough apart that each line reads as a distinct color even when
  // they cross. Lightness sits in the 60-75% range so lines pop
  // against the dark background; the previous 45-55% palette was
  // washing out on dark mode. Colorblind-aware: blue/orange and
  // green/pink are the strongest signal pairs and don't sit next to
  // each other.
  const lineColors = [
    "hsl(213, 94%, 68%)",  // bright blue
    "hsl(158, 64%, 52%)",  // emerald
    "hsl(43, 96%, 60%)",   // amber
    "hsl(330, 89%, 70%)",  // pink
    "hsl(255, 92%, 76%)",  // violet
    "hsl(27, 96%, 61%)",   // orange
    "hsl(187, 86%, 60%)",  // cyan
  ];

  // Shape the data into one row per month with a column per account
  // for referrals + an overlay column for the chosen activity + a
  // sibling admits column for the custom dot renderer.
  const chartData = useMemo(() => {
    const overlayKey: null | "meetings" | "refer_outs" = overlay === "none" ? null : overlay;
    return months.map((mk) => {
      const [y, m] = mk.split("-").map(Number);
      const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const row: Record<string, number | string> = { month: label, monthKey: mk };
      for (const a of realAccounts) {
        const b: any = a.by_month[mk];
        row[a.name] = (b?.referrals as number) ?? 0;
        row[`${a.name}__admits`] = b?.admits ?? 0;
        if (overlayKey) row[`${a.name}__overlay`] = (b?.[overlayKey] as number) ?? 0;
      }
      return row;
    });
  }, [realAccounts, months, overlay]);

  const overlayLabel = overlay === "meetings" ? "meetings" : overlay === "refer_outs" ? "refer-outs" : null;

  // Custom dot renderer: enlarge the dot when admits > 0 in that month
  // for this account. We pluck the per-account admit count out of the
  // payload (the chart row we built above) so each line gets its own
  // admit overlay.
  function makeDot(accountName: string, color: string) {
    return (props: any) => {
      const { cx, cy, payload, index } = props;
      if (cx == null || cy == null) return <g key={`d-${accountName}-${index}`} />;
      const admits = (payload?.[`${accountName}__admits`] as number) ?? 0;
      if (admits > 0) {
        // Filled larger dot + thin ring so the marker reads as "admit
        // month" against the background line.
        return (
          <g key={`d-${accountName}-${index}`}>
            <circle cx={cx} cy={cy} r={6} fill={color} stroke="hsl(var(--background))" strokeWidth={2} />
            <text x={cx} y={cy - 9} textAnchor="middle" fontSize={9} fill={color} fontWeight={600}>{admits}</text>
          </g>
        );
      }
      return <circle key={`d-${accountName}-${index}`} cx={cx} cy={cy} r={2.5} fill={color} />;
    };
  }

  if (realAccounts.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <TrendingUp className="w-4 h-4 text-blue-500" /> Top accounts — referrals over time
          <Badge variant="outline" className="text-[10px]">Top {realAccounts.length}</Badge>
          {loc !== "all" && <Badge variant="outline" className="text-[10px]">LOC: {loc}</Badge>}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground mr-1">Overlay</span>
              {([
                { k: "none",       label: "Off" },
                { k: "meetings",   label: "Meetings" },
                { k: "refer_outs", label: "Refer-outs" },
              ] as const).map((m) => (
                <Button key={m.k} size="sm" variant={overlay === m.k ? "default" : "outline"} onClick={() => setOverlay(m.k)} className="h-6 text-[10px] px-2">{m.label}</Button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground mr-1">Show</span>
              {[3, 5, 7].map((n) => (
                <Button key={n} size="sm" variant={topN === n ? "default" : "outline"} onClick={() => setTopN(n)} className="h-6 text-[10px] px-2">{n}</Button>
              ))}
            </div>
          </div>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Solid line per account = referrals. <span className="text-foreground font-medium">Larger dot = admit month</span> (number above it = how many admits landed).
          {overlayLabel ? <> Toggle adds a <span className="font-medium">dotted line</span> per account for {overlayLabel} so you can see whether {overlayLabel} precede or trail referrals.</> : <> Toggle the Overlay to add a dotted Meetings or Refer-outs line per account on top of referrals.</>}
        </p>
      </CardHeader>
      <CardContent className="h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(value: any, name: any, props: any) => {
                if (typeof name === "string" && (name.endsWith("__admits") || name.endsWith("__overlay"))) return null as any;
                const admits = (props?.payload?.[`${name}__admits`] as number) ?? 0;
                const ov = overlayLabel != null ? ((props?.payload?.[`${name}__overlay`] as number) ?? 0) : null;
                const overlayPart = overlayLabel && ov != null ? ` · ${ov} ${overlayLabel}` : "";
                return [`${value} referrals · ${admits} admit${admits === 1 ? "" : "s"}${overlayPart}`, name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v) => (typeof v === "string" && (v.endsWith("__admits") || v.endsWith("__overlay")) ? null : v)}
            />
            {realAccounts.map((a, i) => {
              const color = lineColors[i % lineColors.length];
              return (
                <Line
                  key={a.id}
                  type="monotone"
                  dataKey={a.name}
                  stroke={color}
                  strokeWidth={2}
                  dot={makeDot(a.name, color)}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              );
            })}
            {/* Dotted overlay lines per account when the toggle is on.
                Same color as the account's solid referrals line so the
                pair reads as "this account's referrals vs activity". */}
            {overlay !== "none" && realAccounts.map((a, i) => {
              const color = lineColors[i % lineColors.length];
              return (
                <Line
                  key={`${a.id}__overlay`}
                  type="monotone"
                  dataKey={`${a.name}__overlay`}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  legendType="none"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>

      {/* Per-account correlation summary — same rank as the chart
          lines. Shows the active metric → admits ratio across the full
          window so the user can see which lines convert vs. just
          generate volume (the question that motivated the metric
          toggle in the first place). */}
      <CardContent className="pt-0">
        <div className="border-t pt-3 mt-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
            {overlayLabel ? <>{overlayLabel} → referrals → admits across the window</> : <>Referrals → admits across the window</>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {realAccounts.map((a, i) => {
              const refs = a.total_referrals;
              const admits = a.total_admits;
              const ratio = refs > 0 ? Math.round((admits / refs) * 100) : null;
              const color = lineColors[i % lineColors.length];
              const overlayTotal =
                overlay === "meetings" ? (a.total_meetings ?? 0)
                : overlay === "refer_outs" ? (a.total_refer_outs ?? 0)
                : null;
              const tone =
                ratio == null ? "text-muted-foreground"
                : ratio >= 50 ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                : ratio >= 25 ? "text-emerald-600 dark:text-emerald-400"
                : ratio >= 10 ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400";
              return (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="truncate flex-1 font-medium">{a.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {overlayTotal != null ? `${overlayTotal} → ` : ""}{refs} → {admits}
                  </span>
                  <span className={`tabular-nums w-12 text-right ${tone}`}>
                    {ratio == null ? "—" : `${ratio}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Activity vs outcomes chart. Reads as: "does this activity (meetings
// or refer-outs) actually precede referrals and admits?"
//
// Three lines on the same timeline:
//   - the chosen activity (purple)
//   - referrals  (blue)
//   - admits     (green)
//
// Honors the page-level Account dropdown via selectedAccountId — when
// "all" it sums across every account; otherwise scopes to that one.
function ActivityVsOutcomesChart({ accounts, months, loc, selectedAccountId, accountName }: {
  accounts: AccountTrend[];
  months: string[];
  loc: string;
  selectedAccountId: string;
  accountName: string;
}) {
  const [activity, setActivity] = useState<"meetings" | "refer_outs">("meetings");
  const activityLabel = activity === "meetings" ? "Meetings" : "Refer-outs";

  // Compose three monthly series. The activity series comes from
  // by_month[mk].meetings or by_month[mk].refer_outs depending on
  // toggle; referrals and admits always come from by_month[mk].
  const chartData = useMemo(() => {
    const scope = selectedAccountId === "all"
      ? accounts
      : accounts.filter((a) => a.id === selectedAccountId);
    return months.map((mk) => {
      let act = 0; let refs = 0; let admits = 0;
      for (const a of scope) {
        const b: any = a.by_month[mk];
        if (!b) continue;
        act    += (activity === "meetings" ? b.meetings : b.refer_outs) ?? 0;
        refs   += b.referrals ?? 0;
        admits += b.admits ?? 0;
      }
      const [y, m] = mk.split("-").map(Number);
      const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      return { month: label, monthKey: mk, activity: act, referrals: refs, admits };
    });
  }, [accounts, months, selectedAccountId, activity]);

  // Window totals + simple conversion ratios shown beneath the chart.
  // Activity-to-admits is the headline answer to "does this drive
  // anything?" — referrals-from-activity gives the intermediate step.
  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, r) => {
        acc.activity += r.activity;
        acc.referrals += r.referrals;
        acc.admits += r.admits;
        return acc;
      },
      { activity: 0, referrals: 0, admits: 0 },
    );
  }, [chartData]);

  const actToAdmits = totals.activity > 0 ? Math.round((totals.admits / totals.activity) * 100) : null;
  const actToRefs   = totals.activity > 0 ? Math.round((totals.referrals / totals.activity) * 100) : null;
  const refsToAdmits = totals.referrals > 0 ? Math.round((totals.admits / totals.referrals) * 100) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <BarChart3 className="w-4 h-4 text-violet-500" />
          {activityLabel} vs Referrals & Admits
          <Badge variant="outline" className="text-[10px]">{accountName}</Badge>
          {loc !== "all" && <Badge variant="outline" className="text-[10px]">LOC: {loc}</Badge>}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">Activity</span>
            {([
              { k: "meetings",   label: "Meetings" },
              { k: "refer_outs", label: "Refer-outs" },
            ] as const).map((m) => (
              <Button key={m.k} size="sm" variant={activity === m.k ? "default" : "outline"} onClick={() => setActivity(m.k)} className="h-6 text-[10px] px-2">{m.label}</Button>
            ))}
          </div>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Three lines on the same timeline: <span className="font-medium" style={{ color: "hsl(280, 55%, 60%)" }}>{activityLabel.toLowerCase()}</span>,
          {" "}<span className="font-medium" style={{ color: "hsl(210, 80%, 55%)" }}>referrals</span>,
          {" "}<span className="font-medium" style={{ color: "hsl(160, 70%, 45%)" }}>admits</span>.
          Use this to see whether {activityLabel.toLowerCase()} actually precede referrals and admits — when the purple line spikes, do the blue / green lines follow a month or two later?
        </p>
      </CardHeader>
      <CardContent className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="activity" name={activityLabel} stroke="hsl(280, 55%, 60%)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="referrals" name="Referrals" stroke="hsl(210, 80%, 55%)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="admits" name="Admits" stroke="hsl(160, 70%, 45%)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
      <CardContent className="pt-0">
        <div className="border-t pt-3 mt-1 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Window totals</div>
            <div className="mt-1">
              <span style={{ color: "hsl(280, 55%, 60%)" }} className="font-medium">{totals.activity}</span> {activityLabel.toLowerCase()} ·{" "}
              <span style={{ color: "hsl(210, 80%, 55%)" }} className="font-medium">{totals.referrals}</span> referrals ·{" "}
              <span style={{ color: "hsl(160, 70%, 45%)" }} className="font-medium">{totals.admits}</span> admits
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{activityLabel} → Referrals</div>
            <div className="mt-1 tabular-nums">{actToRefs == null ? "—" : `${actToRefs}%`} <span className="text-muted-foreground">({totals.activity} → {totals.referrals})</span></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{activityLabel} → Admits</div>
            <div className="mt-1 tabular-nums">{actToAdmits == null ? "—" : `${actToAdmits}%`} <span className="text-muted-foreground">({totals.activity} → {totals.admits})</span></div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Note: window ratios show same-period totals. The Strategy Command Center computes lagged (30/60/90-day) correlations per account — that's where you go to see "meetings here predict admits 60 days later."
        </p>
      </CardContent>
    </Card>
  );
}
