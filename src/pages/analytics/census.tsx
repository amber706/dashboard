import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useCensus, type RiskRow } from "@/features/analytics-warehouse/hooks/useCensus";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

const statusVariant = (s: RiskRow["status"]): "default" | "secondary" | "destructive" =>
  s === "Healthy" ? "default" : s === "Below Target" ? "secondary" : "destructive";

const STALE_HOURS = 48;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export default function WarehouseCensus() {
  const { data, isLoading, error } = useCensus();
  const stale = hoursSince(data?.latestTs ?? null);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Census & Capacity"
          subtitle="Active census vs licensed capacity. Manual snapshot — date range doesn't apply."
        />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      {data?.latestTs && (
        <Card className={stale != null && stale > STALE_HOURS ? "border-amber-500/50 bg-amber-500/5" : ""}>
          <CardContent className="p-4 text-sm">
            Latest snapshot: <span className="font-medium">{new Date(data.latestTs).toLocaleString()}</span>
            {stale != null && stale > STALE_HOURS && (
              <span className="ml-2 text-amber-600">— stale ({stale.toFixed(0)}h ago, threshold {STALE_HOURS}h)</span>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Program gauges</CardTitle>
          <p className="text-sm text-muted-foreground">Filled / total capacity by program</p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? <Skeleton className="h-48 w-full" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.gauges.map((g) => {
                const ratio = g.total > 0 ? g.filled / g.total : 0;
                return (
                  <div key={g.program_key} className="border rounded p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-medium">{g.label}</div>
                        <div className="text-xs text-muted-foreground">{g.site} {g.is_virtual ? "· Virtual" : ""}</div>
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        <span className="font-bold">{fmtNumber(g.filled)}</span>
                        <span className="text-muted-foreground"> / {fmtNumber(g.total)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className={`h-full ${ratio > 0.95 ? "bg-red-500" : ratio > 0.85 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 tabular-nums">{fmtPct(ratio, 0)} utilized</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>30-day admit pace vs available capacity</CardTitle>
          <p className="text-sm text-muted-foreground">Status thresholds: Healthy ≥ available · Below Target ≥ 70% · Under-Utilized below</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Program</th>
                  <th className="pr-3 text-right">Available</th>
                  <th className="pr-3 text-right">30-day admits</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.riskTable.map((r) => (
                  <tr key={r.program_key} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.available)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.projected)}</td>
                    <td><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Average daily census trend</CardTitle>
          <p className="text-sm text-muted-foreground">Per-program lines from ADC tracking sheet</p>
        </CardHeader>
        <CardContent className="h-[320px]">
          {isLoading || !data ? <Skeleton className="h-full w-full" /> : data.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No ADC tracking data ingested yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                {data.programKeys.map((pk, i) => (
                  <Line key={pk} type="monotone" dataKey={pk} stroke={`hsl(${(i * 47) % 360}, 65%, 50%)`} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
