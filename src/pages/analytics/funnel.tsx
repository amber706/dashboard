import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useFunnelAnalysis } from "@/features/analytics-warehouse/hooks/useFunnelAnalysis";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const fmtDays = (n: number | null | undefined) => (n == null ? "—" : `${n}d`);
const maskName = (first: string | null, last: string | null) => {
  const f = first?.trim()?.charAt(0)?.toUpperCase() ?? "";
  const l = last?.trim()?.charAt(0)?.toUpperCase() ?? "";
  if (!f && !l) return "***";
  return `${f ? `${f}.` : ""}${l ? `${l}.` : ""}***`;
};

export default function WarehouseFunnel() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useFunnelAnalysis(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Funnel & Conversion"
          subtitle="Stage-by-stage conversion rates, drop-off, and stuck leads."
        />
        <RangePicker preset={preset} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      {data && data.counts.missingInsurance > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <span className="font-medium">{fmtNumber(data.counts.missingInsurance)}</span> active records missing insurance type.
              These cannot be payer-normalized and fall into Unknown on the Payer Mix dashboard.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <p className="text-sm text-muted-foreground">Active pipeline counts per stage</p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {isLoading || !data ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={data.stages}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="label" width={140} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(220, 60%, 55%)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closed-Lost Reasons</CardTitle>
            <p className="text-sm text-muted-foreground">Top reasons in window</p>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? <Skeleton className="h-[280px] w-full" /> : data.lost.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No lost records in range.</p>
            ) : (
              <div className="space-y-2">
                {data.lost.slice(0, 8).map((l) => {
                  const max = Math.max(1, ...data.lost.map((x) => x.count));
                  return (
                    <div key={l.reason} className="flex items-center gap-2">
                      <span className="w-[120px] text-xs truncate">{l.reason}</span>
                      <span className="flex-1 h-3 bg-slate-100 rounded-sm overflow-hidden">
                        <span className="block h-full bg-amber-500" style={{ width: `${(l.count / max) * 100}%` }} />
                      </span>
                      <span className="w-8 text-xs font-semibold tabular-nums text-right">{l.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage-to-stage conversion</CardTitle>
          <p className="text-sm text-muted-foreground">Cohort {data?.cohort.cohortMonth ?? "—"} · Lead→Admit {fmtPct(data?.cohort.leadToAdmit)} · Median speed-to-admit (window) {fmtDays(data?.cohort.medianDays)}</p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? <Skeleton className="h-12 w-full" /> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              {data.conversions.map((c) => (
                <div key={`${c.from}->${c.to}`} className="border rounded p-3">
                  <div className="text-xs text-muted-foreground">{c.from.replace(/_/g, " ")} →</div>
                  <div className="text-xs">{c.to.replace(/_/g, " ")}</div>
                  <div className="font-bold tabular-nums mt-1">{fmtPct(c.pct)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stuck leads — top {data?.stuck.length ?? 0} of {fmtNumber(data?.counts.stuckTotal)}</CardTitle>
          <p className="text-sm text-muted-foreground">Records whose stage hasn't changed in &gt; stuck-lead-threshold days</p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.stuck.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No stuck leads in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Client</th>
                  <th className="pr-3">Stage</th>
                  <th className="pr-3 text-right">Days</th>
                  <th>Rep</th>
                </tr>
              </thead>
              <tbody>
                {data.stuck.map((r) => (
                  <tr key={r.pipeline_id} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{maskName(r.first_name, r.last_initial)}</td>
                    <td className="pr-3">{(r.stage_key ?? "").replace(/_/g, " ")}</td>
                    <td className="pr-3 text-right"><Badge variant="secondary">{fmtDays(r.days_in_current_stage)}</Badge></td>
                    <td>{r.rep_key ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage aging — active pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">Top 50 by days in current stage</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.aging.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active pipeline in range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Client</th>
                  <th className="pr-3">Stage</th>
                  <th className="pr-3 text-right">Days open</th>
                  <th className="pr-3">Payer</th>
                  <th className="pr-3">Channel</th>
                  <th className="pr-3">Rep</th>
                  <th>Program</th>
                </tr>
              </thead>
              <tbody>
                {data.aging.map((r) => (
                  <tr key={r.pipeline_id} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{maskName(r.first_name, r.last_initial)}</td>
                    <td className="pr-3">{(r.stage_key ?? "").replace(/_/g, " ")}</td>
                    <td className="pr-3 text-right"><Badge variant="secondary">{fmtDays(r.days_in_current_stage)}</Badge></td>
                    <td className="pr-3">{r.payer_type_group ?? "—"}</td>
                    <td className="pr-3">{r.channel_group ?? "—"}</td>
                    <td className="pr-3">{r.rep_key ?? "—"}</td>
                    <td>{r.level_of_care ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
