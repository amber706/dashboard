// /analytics/op-funnel — Phase 1C entry-point dashboard.
//
// Reads from the Phase 1B `reporting.op_lead_funnel_daily` cache via the
// manager/admin-gated `reporting_op_funnel_daily` RPC. Demonstrates the
// new data layer working end-to-end in the UI — six KPI tiles (Leads,
// MQLs, VOBs, Admits, Closed Lost, Referred Out) + a trend chart for the
// full window.
//
// Per-pipeline + per-rep slicing comes in follow-up hooks; this page is
// the all-dimensions roll-up that proves the pipeline.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import {
  Users, Inbox, ShieldCheck, CheckCircle2, XCircle, ArrowRightCircle,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import { useOpFunnel } from "@/features/op-reporting/hooks/useOpFunnel";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

export default function OpFunnel() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useOpFunnel(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Funnel (Op Metric Cache)"
          subtitle="Leads → MQLs → VOBs → Admits, sourced from reporting.op_lead_funnel_daily. Cache rebuilds at 02:00 Phoenix."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))
        ) : (
          <>
            <MetricCard label="Leads" value={fmtNumber(data.totals.leads)} severity="info" icon={Users} />
            <MetricCard label="MQLs" value={fmtNumber(data.totals.mqls)} severity="info" icon={Inbox} />
            <MetricCard label="VOBs" value={fmtNumber(data.totals.vobs)} severity="info" icon={ShieldCheck} />
            <MetricCard
              label="Admits"
              value={fmtNumber(data.totals.admits)}
              severity="success"
              icon={CheckCircle2}
              delta={
                data.totals.mql_to_admit != null
                  ? { value: fmtPct(data.totals.mql_to_admit), direction: "flat", vs: "MQL → Admit" }
                  : undefined
              }
            />
            <MetricCard label="Closed Lost" value={fmtNumber(data.totals.closed_lost)} severity="danger" icon={XCircle} />
            <MetricCard label="Referred Out" value={fmtNumber(data.totals.referred_out)} severity="warning" icon={ArrowRightCircle} />
          </>
        )}
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily trend</CardTitle>
          <p className="text-sm text-muted-foreground">
            Phoenix-local days. Each metric is counted on the date appropriate to it
            (Created_Time for leads + MQLs; VOB_Submitted_Date for VOBs;
            Admit_Date or Closing_Date for Admits; Closing_Date for the closed metrics).
          </p>
        </CardHeader>
        <CardContent className="h-[360px]">
          {isLoading || !data ? (
            <Skeleton className="h-full w-full" />
          ) : data.rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No data in window — try widening the date range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(15, 37, 73, 0.95)",
                    border: "1px solid rgba(91, 163, 212, 0.3)",
                    color: "white",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="leads_count"        name="Leads"        stroke="#5BA3D4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="mqls_count"         name="MQLs"         stroke="#8A78D4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="vobs_count"         name="VOBs"         stroke="#E5C879" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="admits_count"       name="Admits"       stroke="#10B981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="closed_lost_count"  name="Closed Lost"  stroke="#E89077" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="referred_out_count" name="Referred Out" stroke="#C5D2E5" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Conversion summary */}
      {data && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Conversion (window total)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Leads → MQLs</div>
                <div className="text-lg font-medium">
                  {data.totals.leads > 0 ? fmtPct(data.totals.mqls / data.totals.leads) : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">MQLs → VOBs</div>
                <div className="text-lg font-medium">
                  {data.totals.mqls > 0 ? fmtPct(data.totals.vobs / data.totals.mqls) : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">VOBs → Admits</div>
                <div className="text-lg font-medium">{fmtPct(data.totals.vob_to_admit)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">MQLs → Admits</div>
                <div className="text-lg font-medium">{fmtPct(data.totals.mql_to_admit)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
