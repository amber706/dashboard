import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { Users, Trophy, Hourglass, ShieldCheck } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ComposedChart,
} from "recharts";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useExecutiveSnapshot } from "@/features/analytics-warehouse/hooks/useExecutiveSnapshot";
import type { DatePreset } from "@/features/analytics-warehouse/api/types";

// Format helpers — keep numbers display-friendly without pulling in
// another dependency.
const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
const fmtDelta = (d: number | null) =>
  d == null ? null : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
const deltaTone = (d: number | null) =>
  d == null ? "neutral" : d >= 0 ? "positive" : "negative";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "MTD",    label: "Month to date" },
  { value: "QTD",    label: "Quarter to date" },
  { value: "YTD",    label: "Year to date" },
  { value: "L30D",   label: "Last 30 days" },
  { value: "L90D",   label: "Last 90 days" },
];

export default function WarehouseExecutive() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useExecutiveSnapshot(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Executive Snapshot"
          subtitle="Warehouse-backed analytics. Pulls from fact_pipeline, fact_admit, fact_vob, fact_census."
        />
        <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load snapshot — {(error as Error).message}
          </CardContent>
        </Card>
      ) : isLoading || !data ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="New Leads"
            value={fmtNumber(data.kpis.newLeads.value)}
            change={fmtDelta(data.kpis.newLeads.delta) ?? `vs ${fmtNumber(data.kpis.newLeads.priorValue)} prior`}
            changeType={deltaTone(data.kpis.newLeads.delta)}
            icon={<Users className="w-4 h-4" />}
          />
          <MetricCard
            label="Admissions"
            value={fmtNumber(data.kpis.admits.value)}
            change={`Digital ${fmtNumber(data.kpis.admits.digital)} · BD ${fmtNumber(data.kpis.admits.bd)}`}
            changeType={deltaTone(data.kpis.admits.delta)}
            icon={<Trophy className="w-4 h-4" />}
          />
          <MetricCard
            label="Active Census"
            value={fmtNumber(data.kpis.census.value)}
            change={`Virtual ${fmtNumber(data.kpis.census.virtual)} · In-Person ${fmtNumber(data.kpis.census.inPerson)}`}
            icon={<Hourglass className="w-4 h-4" />}
          />
          <MetricCard
            label="VOB Approval Rate"
            value={fmtPct(data.kpis.vobRate.value)}
            change={`${fmtNumber(data.kpis.vobRate.approved)} approved / ${fmtNumber(data.kpis.vobRate.completed)} completed`}
            icon={<ShieldCheck className="w-4 h-4" />}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Admissions Trend</CardTitle>
            <p className="text-sm text-muted-foreground">8-month view, Digital vs BD</p>
          </CardHeader>
          <CardContent className="h-[280px]">
            {isLoading || !data ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="digital" stackId="a" fill="hsl(210, 80%, 55%)" name="Digital" />
                  <Bar dataKey="bd"      stackId="a" fill="hsl(160, 70%, 45%)" name="BD" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funnel Health</CardTitle>
            <p className="text-sm text-muted-foreground">Current pipeline by stage</p>
          </CardHeader>
          <CardContent className="h-[280px]">
            {isLoading || !data ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={data.funnel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="label" width={120} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(220, 50%, 55%)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payer Mix Trend</CardTitle>
          <p className="text-sm text-muted-foreground">6-month composition by payer group</p>
        </CardHeader>
        <CardContent className="h-[300px]">
          {isLoading || !data ? <Skeleton className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.payerTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="commercial" stackId="a" fill="hsl(210, 80%, 55%)" name="Commercial" />
                <Bar dataKey="ahcccs"     stackId="a" fill="hsl(160, 70%, 45%)" name="AHCCCS" />
                <Bar dataKey="cash"       stackId="a" fill="hsl(45, 85%, 55%)"  name="Cash" />
                <Bar dataKey="unknown"    stackId="a" fill="hsl(220, 10%, 55%)" name="Unknown" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: Digital CPA and Revenue Proxy KPIs are on HOLD — see the
        Cost per Admit / CPL and Revenue Proxy entries in the sidebar.
      </p>
    </div>
  );
}

function KpiSkeletonRow() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[110px] w-full" />
      ))}
    </div>
  );
}
