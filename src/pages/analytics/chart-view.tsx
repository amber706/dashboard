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
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useChartView, type PipelineFilter, type Slice, type NestedRow } from "@/features/analytics-warehouse/hooks/useChartView";
import { useReferOutBreakdowns } from "@/features/analytics-warehouse/hooks/useReferOutBreakdowns";
import type { DatePreset } from "@/features/analytics-warehouse/api/types";
import { resolveDateRange } from "@/features/analytics-warehouse/hooks/useDateRange";

// Color palette — 8 distinct, accessible hues. Cycled when there are
// more slices than colors.
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
const color = (i: number) => PALETTE[i % PALETTE.length];

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

// Single-dimension pie chart with legend. Used for the 5 simple
// breakdowns (leads/vobs/admits/lost/refer-out by source or reason).
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
        {loading ? <Skeleton className="h-56 w-full" /> :
          !slices || slices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-12 text-center">No data in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={slices} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={70} innerRadius={32}>
                  {slices.map((_, i) => <Cell key={i} fill={color(i)} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [fmtNumber(v), n]} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
      </CardContent>
    </Card>
  );
}

// Stacked bar chart for the nested breakdowns (source × payer, source
// × LOC). Each bar is a source category; segments within the bar are
// the inner dimension (payer or LOC).
function StackedBarCard({
  title, rows, keys, loading,
}: {
  title: string;
  rows: NestedRow[] | undefined;
  keys: string[] | undefined;
  loading: boolean;
}) {
  const data = (rows ?? []).map((r) => ({ source: r.source, ...r.byKey }));
  const total = (rows ?? []).reduce((s, r) => s + r.total, 0);
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
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="source" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={color(i)} />)}
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
        <StackedBarCard title="Leads by Source × Payer" rows={data?.leadsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} />
        <StackedBarCard title="Leads by Source × LOC"   rows={data?.leadsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} />
      </div>

      {/* VOBs row */}
      <SectionHeader title="VOBs" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PieCard       title="VOBs by Source"         slices={data?.vobsBySource} loading={isLoading} />
        <StackedBarCard title="VOBs by Source × Payer" rows={data?.vobsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} />
        <StackedBarCard title="VOBs by Source × LOC"   rows={data?.vobsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} />
      </div>

      {/* Admits row */}
      <SectionHeader title="Admits" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PieCard       title="Admits by Source"         slices={data?.admitsBySource} loading={isLoading} />
        <StackedBarCard title="Admits by Source × Payer" rows={data?.admitsBySourceByPayer} keys={data?.payerKeys} loading={isLoading} />
        <StackedBarCard title="Admits by Source × LOC"   rows={data?.admitsBySourceByLoc}   keys={data?.locKeys}   loading={isLoading} />
      </div>

      {/* Reason / company row */}
      <SectionHeader title="Lost & Refer-out" />
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <PieCard title="Closed Lost by Reason"       slices={brk?.closed_lost_by_reason}    loading={brkLoading} />
        <PieCard title="Referred Out by Reason"      slices={brk?.referred_out_by_reason}   loading={brkLoading} />
        <PieCard title="Referred Out by Policy"      slices={brk?.referred_out_by_policy}   loading={brkLoading} />
        <PieCard title="Referred Out by Company"     slices={brk?.referred_out_by_company}  loading={brkLoading} />
      </div>
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
