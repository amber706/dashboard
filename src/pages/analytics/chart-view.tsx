// /analytics/chart-view — the chart-driven analytics dashboard. All
// breakdowns the user asked for in one page:
//
//   Source Category breakdowns (warehouse-driven, useChartView):
//     • leads × source
//     • leads × source × payer
//     • leads × source × LOC
//     • vobs   × { source, source×payer, source×LOC }
//     • admits × { source, source×payer, source×LOC }
//
//   Reason / Company breakdowns (Zoho-driven, useReferOutBreakdowns):
//     • closed lost × reason
//     • referred out × reason
//     • referred out × policy
//     • referred out × company
//
// Shared filters at the top: window preset (This month / Last month /
// Last 3 / 6 / 12 months / Custom) and pipeline (All / Commercial /
// AHCCCS).

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { useChartView, type PipelineFilter, type Slice, type NestedRow } from "@/features/analytics-warehouse/hooks/useChartView";
import { useReferOutBreakdowns } from "@/features/analytics-warehouse/hooks/useReferOutBreakdowns";
import { useUnattributedDetail } from "@/features/analytics-warehouse/hooks/useUnattributedDetail";
import { resolveDateRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

// Color palette — 8 distinct, accessible hues. Adjacent colors contrast
// so a stacked bar segment never blends into its neighbor.
const PALETTE = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#84cc16", // lime-500
];

// Stable color mapping for known dimension values — Commercial is
// always blue, AHCCCS is always emerald, etc. — so the eye learns
// the mapping across charts. Falls back to positional palette lookup
// for unknown labels (e.g. partner companies in the refer-out chart).
const KNOWN_COLORS: Record<string, string> = {
  // Payer buckets
  "Commercial": "#3b82f6",
  "AHCCCS":     "#10b981",
  "Cash":       "#8b5cf6",
  "DUI":        "#f59e0b",
  "DV":         "#ef4444",
  "Unknown":    "#94a3b8", // slate-400 — visually de-emphasized
  // Source categories
  "SEO":          "#3b82f6",
  "BD Referral":  "#10b981",
  "PPC":          "#f59e0b",
  "Directory":    "#8b5cf6",
  "Unattributed": "#94a3b8",
  // LOC fallback
  "(no LOC)":   "#94a3b8",
};
const colorFor = (label: string, i: number): string =>
  KNOWN_COLORS[label] ?? PALETTE[i % PALETTE.length];

// Deterministic ordering for known dimensions so the legend always
// reads Commercial → AHCCCS → ... regardless of which appears first
// alphabetically. Unknown stays last (de-emphasized).
const PAYER_ORDER = ["Commercial", "AHCCCS", "Cash", "DUI", "DV", "Unknown"];
const SOURCE_ORDER = ["SEO", "BD Referral", "PPC", "Directory", "Unattributed"];
function orderKeys(keys: string[], preferred: string[]): string[] {
  const known = preferred.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !preferred.includes(k)).sort();
  return [...known, ...rest];
}

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

// Single-dimension pie chart with legend. Used for the 5 simple
// breakdowns. Percentage labels render inside slices >= 6% so the
// chart is self-documenting; smaller slices get their share via the
// tooltip + legend table below.
function PieCard({ title, slices, loading }: { title: string; slices: Slice[] | undefined; loading: boolean }) {
  const total = (slices ?? []).reduce((s, x) => s + x.count, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>{title}</span>
          <Badge variant="outline" className="text-[10px]">{fmtNumber(total)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? <Skeleton className="h-72 w-full" /> :
          !slices || slices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-12 text-center">No data in this window.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={slices} dataKey="count" nameKey="label"
                    cx="50%" cy="50%" outerRadius={88} innerRadius={40}
                    label={(p: any) => {
                      const pct = total > 0 ? (p.count / total) * 100 : 0;
                      return pct >= 6 ? `${pct.toFixed(0)}%` : "";
                    }}
                    labelLine={false}
                  >
                    {slices.map((s, i) => <Cell key={i} fill={colorFor(s.label, i)} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [`${fmtNumber(v)} (${total > 0 ? ((v / total) * 100).toFixed(1) : "0"}%)`, n]} />
                </PieChart>
              </ResponsiveContainer>
              {/* Compact legend table below the chart — readable and
                  click-free; shows count + percent for each slice. */}
              <div className="text-[11px] mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {slices.map((s, i) => (
                  <div key={s.label} className="flex items-center justify-between gap-2 min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colorFor(s.label, i) }} />
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {fmtNumber(s.count)} · {total > 0 ? ((s.count / total) * 100).toFixed(0) : "0"}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}

// Horizontal stacked bar for the nested breakdowns (source × payer,
// source × LOC). Source labels live on the Y axis where they're
// always horizontal and never get squeezed; counts run left to right.
// Stack order honors PAYER_ORDER / SOURCE_ORDER so Commercial is
// always the leftmost segment.
function StackedBarCard({
  title, rows, keys, loading, innerDim,
}: {
  title: string;
  rows: NestedRow[] | undefined;
  keys: string[] | undefined;
  loading: boolean;
  innerDim: "payer" | "loc";
}) {
  const orderedKeys = keys ? orderKeys(keys, innerDim === "payer" ? PAYER_ORDER : []) : [];
  // Sort rows by source preference (SEO first, etc.) then by total.
  const sortedRows = (rows ?? []).slice().sort((a, b) => {
    const ia = SOURCE_ORDER.indexOf(a.source);
    const ib = SOURCE_ORDER.indexOf(b.source);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    return b.total - a.total;
  });
  const data = sortedRows.map((r) => ({ source: r.source, ...r.byKey, _total: r.total }));
  const total = sortedRows.reduce((s, r) => s + r.total, 0);
  const chartHeight = Math.max(160, sortedRows.length * 44);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>{title}</span>
          <Badge variant="outline" className="text-[10px]">{fmtNumber(total)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? <Skeleton className="h-56 w-full" /> :
          !rows || rows.length === 0 || !keys || keys.length === 0 ? (
            <p className="text-xs text-muted-foreground py-12 text-center">No data in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart layout="vertical" data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={88} />
                <Tooltip formatter={(v: number, n: string) => [fmtNumber(v), n]} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                {orderedKeys.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={colorFor(k, i)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
      </CardContent>
    </Card>
  );
}

// Five preset buttons + custom. The existing useDashboardRange already
// understands MTD, LAST_MONTH, L30D, L90D. For Last 3 / 6 / 12 months
// we use CUSTOM mode with a manually-computed range, so the user gets
// month-aligned starts (1st of N months ago) rather than rolling N×30
// days.
type ChartPreset = "MTD" | "LAST_MONTH" | "L3M" | "L6M" | "L12M" | "CUSTOM";
const PRESET_LABELS: Record<ChartPreset, string> = {
  MTD: "This month",
  LAST_MONTH: "Last month",
  L3M: "Last 3 months",
  L6M: "Last 6 months",
  L12M: "Last 12 months",
  CUSTOM: "Custom",
};

function rangeForPreset(p: ChartPreset, custom?: { from: string; to: string }) {
  const today = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (p === "MTD")        return resolveDateRange("MTD");
  if (p === "LAST_MONTH") return resolveDateRange("LAST_MONTH");
  if (p === "L3M")  return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),  to: isoDate(today) };
  if (p === "L6M")  return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 5, 1)),  to: isoDate(today) };
  if (p === "L12M") return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1)), to: isoDate(today) };
  if (p === "CUSTOM" && custom) return custom;
  return { from: isoDate(startOfMonth), to: isoDate(today) };
}

export default function AnalyticsChartView() {
  const [preset, setPreset] = useState<ChartPreset>("MTD");
  const [custom, setCustom] = useState<{ from: string; to: string }>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to:   new Date().toISOString().slice(0, 10),
  });
  const [pipeline, setPipeline] = useState<PipelineFilter>("all");

  const range = rangeForPreset(preset, custom);
  const { data, isLoading } = useChartView(range, pipeline);
  const { data: brk, isLoading: brkLoading } = useReferOutBreakdowns(range, pipeline);

  // Unattributed drill-down — fetched lazily, only when the user
  // opens the dialog. enabled=open keeps the query dormant on first
  // page paint.
  const [unattOpen, setUnattOpen] = useState(false);
  const { data: unatt, isLoading: unattLoading } = useUnattributedDetail(range, pipeline, unattOpen);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Chart View"
        subtitle="Source category, payer, and LOC breakdowns across leads, VOBs, and admits — plus closed-lost and refer-out reason / company splits."
      />

      {/* Shared filters: window + pipeline */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Window</span>
          {(Object.keys(PRESET_LABELS) as ChartPreset[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? "default" : "outline"}
              onClick={() => setPreset(p)}
              className="h-8 text-xs"
            >
              {PRESET_LABELS[p]}
            </Button>
          ))}
          {preset === "CUSTOM" && (
            <span className="flex items-center gap-1 ml-1">
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-8 text-xs px-2 rounded border bg-background" />
              <span className="text-muted-foreground text-xs">→</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-8 text-xs px-2 rounded border bg-background" />
            </span>
          )}
          <span className="mx-2 h-4 w-px bg-border" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Pipeline</span>
          {([
            { key: "all",        label: "All" },
            { key: "commercial", label: "Commercial" },
            { key: "ahcccs",     label: "AHCCCS" },
          ] as Array<{ key: PipelineFilter; label: string }>).map((b) => (
            <Button
              key={b.key}
              size="sm"
              variant={pipeline === b.key ? "default" : "outline"}
              onClick={() => setPipeline(b.key)}
              className="h-8 text-xs"
            >
              {b.label}
            </Button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {range.from} → {range.to}
          </span>
        </CardContent>
      </Card>

      {/* Data quality banner — surfaces the share of records that
          come back tagged Unattributed. Anything above 5% is worth
          flagging because attribution drives every chart on this
          page. Pulled from the same buckets the pies render, so the
          numbers always match what's on screen below. */}
      {data && (() => {
        const unattLeads  = data.leadsBySource.find((s) => s.label === "Unattributed")?.count  ?? 0;
        const unattVobs   = data.vobsBySource.find((s) => s.label === "Unattributed")?.count   ?? 0;
        const unattAdmits = data.admitsBySource.find((s) => s.label === "Unattributed")?.count ?? 0;
        const lP = data.totals.leads  > 0 ? (unattLeads  / data.totals.leads)  * 100 : 0;
        const vP = data.totals.vobs   > 0 ? (unattVobs   / data.totals.vobs)   * 100 : 0;
        const aP = data.totals.admits > 0 ? (unattAdmits / data.totals.admits) * 100 : 0;
        const worst = Math.max(lP, vP, aP);
        if (worst < 5) return null;
        return (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-4 text-sm flex items-start gap-3">
              <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <div className="space-y-1 flex-1">
                <div>
                  <span className="font-semibold">Attribution gap.</span>{" "}
                  Unattributed share is high in this window —
                  Leads <span className="tabular-nums">{lP.toFixed(0)}%</span> ({fmtNumber(unattLeads)}),
                  VOBs <span className="tabular-nums">{vP.toFixed(0)}%</span> ({fmtNumber(unattVobs)}),
                  Admits <span className="tabular-nums">{aP.toFixed(0)}%</span> ({fmtNumber(unattAdmits)}).
                  Target is under 5%.
                </div>
                <div className="text-xs text-muted-foreground">
                  Most common causes: Source field blank on Lead in Zoho, GCLID dropped before form submit, or a partner Source value not in the dim_source map yet.
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setUnattOpen(true)} className="shrink-0 h-8 text-xs">
                Drill into unattributed
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Top-line totals */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Leads" value={data.totals.leads} />
          <Kpi label="VOBs" value={data.totals.vobs} />
          <Kpi label="Admits" value={data.totals.admits} />
          <Kpi label="Refer-outs" value={brk?.totals.refer_outs ?? null} />
          <Kpi label="Closed lost" value={brk?.totals.closed_lost ?? null} />
        </div>
      )}

      {/* Leads row */}
      <SectionHeader title="Leads" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PieCard       title="Leads by Source"        slices={data?.leadsBySource} loading={isLoading} />
        <StackedBarCard title="Leads by Source × Payer" rows={data?.leadsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} innerDim="payer" />
        <StackedBarCard title="Leads by Source × LOC"   rows={data?.leadsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} innerDim="loc" />
      </div>

      {/* VOBs row */}
      <SectionHeader title="VOBs" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PieCard       title="VOBs by Source"         slices={data?.vobsBySource} loading={isLoading} />
        <StackedBarCard title="VOBs by Source × Payer" rows={data?.vobsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} innerDim="payer" />
        <StackedBarCard title="VOBs by Source × LOC"   rows={data?.vobsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} innerDim="loc" />
      </div>

      {/* Admits row */}
      <SectionHeader title="Admits" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PieCard       title="Admits by Source"         slices={data?.admitsBySource} loading={isLoading} />
        <StackedBarCard title="Admits by Source × Payer" rows={data?.admitsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} innerDim="payer" />
        <StackedBarCard title="Admits by Source × LOC"   rows={data?.admitsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} innerDim="loc" />
      </div>

      {/* Reason / company row */}
      <SectionHeader title="Lost & Refer-out" />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <PieCard title="Closed Lost by Reason"       slices={brk?.closed_lost_by_reason}    loading={brkLoading} />
        <PieCard title="Referred Out by Reason"      slices={brk?.referred_out_by_reason}   loading={brkLoading} />
        <PieCard title="Referred Out by Policy"      slices={brk?.referred_out_by_policy}   loading={brkLoading} />
        <PieCard title="Referred Out by Company"     slices={brk?.referred_out_by_company}  loading={brkLoading} />
      </div>

      {/* Unattributed drill-down dialog. Lazily loaded — query only
          fires when the dialog opens, never on first page paint. */}
      <Dialog open={unattOpen} onOpenChange={setUnattOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Unattributed leads — drill-down</DialogTitle>
            <DialogDescription>
              {range.from} → {range.to} · pipeline: {pipeline === "all" ? "All" : pipeline === "commercial" ? "Commercial" : "AHCCCS"}
            </DialogDescription>
          </DialogHeader>
          {unattLoading || !unatt ? (
            <Skeleton className="h-72 w-full" />
          ) : unatt.total === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No unattributed leads in this window.
            </p>
          ) : (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* Headline */}
              <Card>
                <CardContent className="p-3 text-sm">
                  <span className="font-semibold tabular-nums">{fmtNumber(unatt.total)}</span> unattributed leads in this window. Every row here was created without a Source value in Zoho — the fix is upstream.
                </CardContent>
              </Card>

              {/* Signal coverage — how many of these rows have ANY
                  tracking signal at all (gclid, landing url, campaign).
                  fully_blank is the painful number: a manually-keyed
                  lead with nothing attached. */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tracking signals on these rows</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  <SignalCell label="Has Source" value={unatt.signal_coverage.has_tracking_source} total={unatt.total} />
                  <SignalCell label="Has GCLID" value={unatt.signal_coverage.has_gclid} total={unatt.total} />
                  <SignalCell label="Has landing URL" value={unatt.signal_coverage.has_landing} total={unatt.total} />
                  <SignalCell label="Has campaign" value={unatt.signal_coverage.has_campaign} total={unatt.total} />
                  <SignalCell label="Fully blank" value={unatt.signal_coverage.fully_blank} total={unatt.total} highlight />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  "Fully blank" = no Source, GCLID, landing URL, or campaign — the lead was keyed manually with no tracking attached. Train the owners below to fill in Source on the Lead in Zoho.
                </p>
              </div>

              {/* By owner — actionable: which reps are creating these */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">By owner — who's creating untracked leads</h3>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left py-1.5 pr-2">Owner</th>
                      <th className="text-right py-1.5 pr-2">Unattributed</th>
                      <th className="text-right py-1.5 pr-2">Share</th>
                      <th className="text-right py-1.5">Admits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unatt.by_owner.map((r) => (
                      <tr key={r.owner} className="border-t">
                        <td className="py-1.5 pr-2 font-medium">{r.owner}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNumber(r.count)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                          {((r.count / unatt.total) * 100).toFixed(0)}%
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmtNumber(r.admits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Most-recent samples — spot-check window */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">10 most recent unattributed leads</h3>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left py-1.5 pr-2">Lead</th>
                      <th className="text-left py-1.5 pr-2">Owner</th>
                      <th className="text-left py-1.5 pr-2">Stage</th>
                      <th className="text-right py-1.5">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unatt.samples.map((s, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5 pr-2 font-medium">
                          {[s.first_name, s.last_initial].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{s.owner ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-muted-foreground">{s.stage_raw ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {s.lead_created_time ? new Date(s.lead_created_time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignalCell({ label, value, total, highlight }: { label: string; value: number; total: number; highlight?: boolean }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className={`rounded border p-2 ${highlight ? "border-rose-500/40 bg-rose-500/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{fmtNumber(value)} <span className="text-[10px] font-normal text-muted-foreground">({pct.toFixed(0)}%)</span></div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | null }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums mt-0.5">{value == null ? "—" : value.toLocaleString("en-US")}</div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mt-2">{title}</h2>;
}
