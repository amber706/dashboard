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
  conversion_rate: number | null;
  by_month: Record<string, { referrals: number; admits: number }>;
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
  const realAccounts = useMemo(
    () => accounts.filter((a) => !a.name.toLowerCase().includes("not linked")).slice(0, topN),
    [accounts, topN],
  );

  // Each line gets its own stable color. Hue rotation keeps adjacent
  // lines distinguishable; cycles after 7.
  const lineColors = [
    "hsl(210, 80%, 55%)", "hsl(160, 70%, 45%)", "hsl(280, 55%, 55%)",
    "hsl(20, 80%, 55%)",  "hsl(340, 65%, 55%)", "hsl(45, 85%, 55%)",
    "hsl(190, 70%, 50%)",
  ];

  // Shape the data into one row per month, with a column per account
  // for referrals plus a sibling column with that account's admits in
  // the same month. The custom dot renderer reads the admit column to
  // decide which dots to enlarge.
  const chartData = useMemo(() => {
    return months.map((mk) => {
      const [y, m] = mk.split("-").map(Number);
      const label = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const row: Record<string, number | string> = { month: label, monthKey: mk };
      for (const a of realAccounts) {
        const b = a.by_month[mk];
        row[a.name] = b?.referrals ?? 0;
        row[`${a.name}__admits`] = b?.admits ?? 0;
      }
      return row;
    });
  }, [realAccounts, months]);

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
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" /> Top accounts — referrals over time
          <Badge variant="outline" className="text-[10px]">Top {realAccounts.length}</Badge>
          {loc !== "all" && <Badge variant="outline" className="text-[10px]">LOC: {loc}</Badge>}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">Show</span>
            {[3, 5, 7].map((n) => (
              <Button key={n} size="sm" variant={topN === n ? "default" : "outline"} onClick={() => setTopN(n)} className="h-6 text-[10px] px-2">{n}</Button>
            ))}
          </div>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          One line per account. <span className="text-foreground font-medium">Larger dot = admit month</span> — the number above it is how many admits landed that month.
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
                if (typeof name === "string" && name.endsWith("__admits")) return null as any;
                const admits = (props?.payload?.[`${name}__admits`] as number) ?? 0;
                return [`${value} referrals${admits > 0 ? ` · ${admits} admit${admits === 1 ? "" : "s"}` : ""}`, name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v) => (typeof v === "string" && v.endsWith("__admits") ? null : v)}
            />
            {realAccounts.map((a, i) => (
              <Line
                key={a.id}
                type="monotone"
                dataKey={a.name}
                stroke={lineColors[i % lineColors.length]}
                strokeWidth={2}
                dot={makeDot(a.name, lineColors[i % lineColors.length])}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
