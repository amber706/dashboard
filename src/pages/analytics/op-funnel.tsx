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
import { CacheFreshnessBadge } from "@/features/op-reporting/components/CacheFreshnessBadge";
import {
  Users, Inbox, ShieldCheck, CheckCircle2, XCircle, ArrowRightCircle,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import { useOpFunnel } from "@/features/op-reporting/hooks/useOpFunnel";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { ExportButton } from "@/features/op-reporting/components/ExportButton";
import { SavedViewsControl } from "@/features/op-reporting/components/SavedViewsControl";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";
import {
  useOpFunnelByPipeline,
  labelForPipeline,
  isTopLine,
} from "@/features/op-reporting/hooks/useOpFunnelByPipeline";
import {
  useOpFunnelBySource,
  labelForSource,
} from "@/features/op-reporting/hooks/useOpFunnelBySource";
import {
  useOpFunnelByLoc,
  labelForLoc,
} from "@/features/op-reporting/hooks/useOpFunnelByLoc";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

export default function OpFunnel() {
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const { data, isLoading, error } = useOpFunnel(range, filters);
  const { data: byPipeline, isLoading: byPipelineLoading } = useOpFunnelByPipeline(range, filters);
  const { data: bySource, isLoading: bySourceLoading } = useOpFunnelBySource(range, filters);
  const { data: byLoc, isLoading: byLocLoading } = useOpFunnelByLoc(range, filters);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Funnel (Op Metric Cache)"
          subtitle="Leads → MQLs → VOBs → Admits, sourced from reporting.op_lead_funnel_daily. Cache rebuilds at 02:00 Phoenix."
        />
        <div className="flex items-center gap-2">
          <ExportButton
            disabled={!data || data.rows.length === 0}
            onExport={() => downloadCsv(dateStampedName("op-funnel-daily"), data?.rows ?? [])}
          />
          <RangePicker preset={preset} range={range} onChange={setPreset} />
        </div>

      <div className="flex justify-end -mt-3">
        <CacheFreshnessBadge />
      </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FilterBar filters={filters} onChange={setFilters} />
        <SavedViewsControl pageKey="op-funnel" filters={filters} onApply={setFilters} />
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

      {/* By pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>By pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            Per-pipeline rollup. Top-line subtotal (Commercial-Cash + AHCCCS + ZocDoc) is the
            headline-KPI denominator; DUI and DV are reported separately per CONFIRMED.md #3.
          </p>
        </CardHeader>
        <CardContent>
          {byPipelineLoading || !byPipeline ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Pipeline</th>
                    <th className="py-2 pr-4 text-right">Leads</th>
                    <th className="py-2 pr-4 text-right">MQLs</th>
                    <th className="py-2 pr-4 text-right">VOBs</th>
                    <th className="py-2 pr-4 text-right">Admits</th>
                    <th className="py-2 pr-4 text-right">Closed Lost</th>
                    <th className="py-2 pr-4 text-right">Refer Out</th>
                    <th className="py-2 pr-0 text-right">MQL → Admit</th>
                  </tr>
                </thead>
                <tbody>
                  {byPipeline.rows.map((r) => {
                    const ratio = r.mqls_count > 0 ? r.admits_count / r.mqls_count : null;
                    return (
                      <tr
                        key={r.pipeline ?? "_unattached"}
                        className={`border-b last:border-0 ${isTopLine(r.pipeline) ? "" : "text-muted-foreground"}`}
                      >
                        <td className="py-2 pr-4 font-medium">
                          {labelForPipeline(r.pipeline)}
                          {isTopLine(r.pipeline) && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-[#10B981]">top-line</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.leads_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.mqls_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.vobs_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.admits_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.closed_lost_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.referred_out_count)}</td>
                        <td className="py-2 pr-0 text-right tabular-nums">{fmtPct(ratio)}</td>
                      </tr>
                    );
                  })}
                  {/* Top-line subtotal */}
                  <tr className="border-t-2 border-[#10B981]/40 font-medium">
                    <td className="py-2 pr-4">Top-line subtotal</td>
                    <td className="py-2 pr-4 text-right tabular-nums">—</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(byPipeline.topLineTotals.mqls_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(byPipeline.topLineTotals.vobs_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(byPipeline.topLineTotals.admits_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(byPipeline.topLineTotals.closed_lost_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(byPipeline.topLineTotals.referred_out_count)}</td>
                    <td className="py-2 pr-0 text-right tabular-nums">
                      {byPipeline.topLineTotals.mqls_count > 0
                        ? fmtPct(byPipeline.topLineTotals.admits_count / byPipeline.topLineTotals.mqls_count)
                        : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* By level of care */}
      <Card>
        <CardHeader>
          <CardTitle>By level of care</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sorted by admits. LOC = `Unspecified` rows are lead-side observations
            where intake didn't capture the requested LOC — a real intake-form
            data quality gap. DUI/DV appear here AND in the by-pipeline view per
            the orthogonality matrix.
          </p>
        </CardHeader>
        <CardContent>
          {byLocLoading || !byLoc ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Level of Care</th>
                    <th className="py-2 pr-4 text-right">Leads</th>
                    <th className="py-2 pr-4 text-right">MQLs</th>
                    <th className="py-2 pr-4 text-right">VOBs</th>
                    <th className="py-2 pr-4 text-right">Admits</th>
                    <th className="py-2 pr-4 text-right">Closed Lost</th>
                    <th className="py-2 pr-0 text-right">MQL → Admit</th>
                  </tr>
                </thead>
                <tbody>
                  {byLoc.rows.map((r) => {
                    const ratio = r.mqls_count > 0 ? r.admits_count / r.mqls_count : null;
                    return (
                      <tr key={r.level_of_care ?? "_"} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{labelForLoc(r.level_of_care)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.leads_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.mqls_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.vobs_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.admits_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.closed_lost_count)}</td>
                        <td className="py-2 pr-0 text-right tabular-nums">{fmtPct(ratio)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* By marketing channel (Source Category) */}
      <Card>
        <CardHeader>
          <CardTitle>By marketing channel</CardTitle>
          <p className="text-sm text-muted-foreground">
            Source Category attribution per CONFIRMED.md #13. Digital Marketing is the
            catch-all; Business Development covers referral-in leads (Source = BD or
            BD_Rep set); ZocDoc is its own bucket.
          </p>
        </CardHeader>
        <CardContent>
          {bySourceLoading || !bySource ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4 text-right">Leads</th>
                    <th className="py-2 pr-4 text-right">MQLs</th>
                    <th className="py-2 pr-4 text-right">VOBs</th>
                    <th className="py-2 pr-4 text-right">Admits</th>
                    <th className="py-2 pr-4 text-right">Closed Lost</th>
                    <th className="py-2 pr-4 text-right">MQL → Admit</th>
                    <th className="py-2 pr-0 text-right">Lead → Admit</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.rows.map((r) => {
                    const mqlAdmit = r.mqls_count > 0 ? r.admits_count / r.mqls_count : null;
                    const leadAdmit = r.leads_count > 0 ? r.admits_count / r.leads_count : null;
                    return (
                      <tr key={r.source_category ?? "_"} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{labelForSource(r.source_category)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.leads_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.mqls_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.vobs_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.admits_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(r.closed_lost_count)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmtPct(mqlAdmit)}</td>
                        <td className="py-2 pr-0 text-right tabular-nums">{fmtPct(leadAdmit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
