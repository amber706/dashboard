import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/score-card";
import { Hourglass, ShieldCheck } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { usePayer } from "@/features/analytics-warehouse/hooks/usePayer";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtPct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}pp`;

export default function WarehousePayer() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = usePayer(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Payer Mix"
          subtitle="Admissions composition by payer group, with channel cross-cut and VOB approval rates."
        />
        <RangePicker preset={preset} range={range} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4 flex items-start gap-3">
          <Hourglass className="w-5 h-5 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <span className="font-medium">Revenue Proxy panel is on HOLD.</span> Per-payer
            revenue estimates depend on <code>app.revenue_assumptions</code>; that
            surface isn't productized yet.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          label="Commercial"
          value={isLoading || !data ? "…" : fmtPct(data.summary.commercial)}
          change={isLoading || !data ? "" : `YoY ${fmtPts(data.summary.commercialDeltaPts)}`}
          changeType={data && data.summary.commercialDeltaPts >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          label="AHCCCS"
          value={isLoading || !data ? "…" : fmtPct(data.summary.ahcccs)}
          change={isLoading || !data ? "" : `YoY ${fmtPts(data.summary.ahcccsDeltaPts)}`}
          changeType={data && data.summary.ahcccsDeltaPts >= 0 ? "positive" : "negative"}
        />
        <MetricCard label="Cash / Self-Pay" value={isLoading || !data ? "…" : fmtPct(data.summary.cash)} />
        <MetricCard label="DUI Program" value={isLoading || !data ? "…" : fmtPct(data.summary.dui)} />
        <MetricCard label="DV Program"  value={isLoading || !data ? "…" : fmtPct(data.summary.dv)} />
        <MetricCard label="Total admits" value={isLoading || !data ? "…" : fmtNumber(data.summary.totalAdmits)} icon={<ShieldCheck className="w-4 h-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>6-month payer mix trend</CardTitle>
          <p className="text-sm text-muted-foreground">Stacked admits by payer group</p>
        </CardHeader>
        <CardContent className="h-[300px]">
          {isLoading || !data ? <Skeleton className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="commercial" stackId="a" fill="hsl(210, 80%, 55%)" name="Commercial" />
                <Bar dataKey="ahcccs"     stackId="a" fill="hsl(160, 70%, 45%)" name="AHCCCS" />
                <Bar dataKey="cash"       stackId="a" fill="hsl(45, 85%, 55%)"  name="Cash" />
                <Bar dataKey="dui"        stackId="a" fill="hsl(280, 55%, 55%)" name="DUI" />
                <Bar dataKey="dv"         stackId="a" fill="hsl(340, 65%, 55%)" name="DV" />
                <Bar dataKey="unknown"    stackId="a" fill="hsl(220, 10%, 55%)" name="Unknown" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>VOB approval by payer</CardTitle></CardHeader>
          <CardContent>
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.vobApproval.perPayer.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No VOB activity in range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Payer</th>
                    <th className="pr-3 text-right">Submitted</th>
                    <th className="pr-3 text-right">Approved</th>
                    <th className="text-right">Approval %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vobApproval.perPayer.map((r) => (
                    <tr key={r.payer} className="border-t">
                      <td className="py-1.5 pr-3 font-medium">{r.payer}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(r.submitted)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(r.approved)}</td>
                      <td className="text-right tabular-nums">{fmtPct(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channel × payer heatmap</CardTitle>
            <p className="text-sm text-muted-foreground">Admit counts in window</p>
          </CardHeader>
          <CardContent className="overflow-auto">
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Channel</th>
                    <th className="pr-3 text-right">Commercial</th>
                    <th className="pr-3 text-right">AHCCCS</th>
                    <th className="pr-3 text-right">Cash</th>
                    <th className="pr-3 text-right">DUI</th>
                    <th className="pr-3 text-right">DV</th>
                    <th className="text-right">Unknown</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.channelHeatmap).map(([channel, row]) => (
                    <tr key={channel} className="border-t">
                      <td className="py-1.5 pr-3 font-medium">{channel}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(row.Commercial)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(row.AHCCCS)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(row.Cash)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(row.DUI)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(row.DV)}</td>
                      <td className="text-right tabular-nums">{fmtNumber(row.Unknown)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
