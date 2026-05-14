import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { Hourglass } from "lucide-react";
import { useDashboardRange } from "@/features/analytics-warehouse/hooks/useDateRange";
import { useChannel } from "@/features/analytics-warehouse/hooks/useChannel";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";

const fmtNumber = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtPct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);

export default function WarehouseChannel() {
  const { preset, range, setPreset } = useDashboardRange("MTD");
  const { data, isLoading, error } = useChannel(range);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Channel & Source"
          subtitle="Pipeline and admits by channel; landing-page conversion; lead-quality × channel heatmap."
        />
        <RangePicker preset={preset} onChange={setPreset} />
      </div>

      {error && (
        <Card><CardContent className="p-6 text-sm text-red-600">Could not load — {(error as Error).message}</CardContent></Card>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4 flex items-start gap-3">
          <Hourglass className="w-5 h-5 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <span className="font-medium">CPA column is on HOLD.</span> The
            cost-per-admit calculation depends on <code>fact_spend</code>, which
            is paused until the Marketing Living Budget ingest is unblocked.
          </div>
        </CardContent>
      </Card>

      {data && data.missing.pct > 0.05 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">{fmtPct(data.missing.pct, 0)}</span> of admits in this window are unattributed ({fmtNumber(data.missing.count)} records). Target: under 5%.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Channel table</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          {isLoading || !data ? <Skeleton className="h-32 w-full" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Channel</th>
                  <th className="pr-3">Group</th>
                  <th className="pr-3 text-right">Leads</th>
                  <th className="pr-3 text-right">VOBs</th>
                  <th className="pr-3 text-right">Admits</th>
                  <th className="pr-3 text-right">VOB %</th>
                  <th className="text-right">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {data.table.map((r) => (
                  <tr key={r.channel_subgroup} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.display}</td>
                    <td className="pr-3"><Badge variant="outline">{r.channel_group}</Badge></td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.leads)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtNumber(r.vobs)}</td>
                    <td className="pr-3 text-right tabular-nums font-semibold">{fmtNumber(r.admits)}</td>
                    <td className="pr-3 text-right tabular-nums">{fmtPct(r.vobPct)}</td>
                    <td className="text-right tabular-nums">{fmtPct(r.convPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Top landing pages</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : data.landing.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No landing-URL data in range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">URL</th>
                    <th className="pr-3 text-right">Leads</th>
                    <th className="pr-3 text-right">Admits</th>
                    <th className="text-right">Conv %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.landing.map((l) => (
                    <tr key={l.url} className="border-t">
                      <td className="py-1.5 pr-3 truncate max-w-[280px]" title={l.url}>{l.url}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(l.leads)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtNumber(l.admits)}</td>
                      <td className="text-right tabular-nums">{fmtPct(l.convPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead quality × channel</CardTitle>
            <p className="text-sm text-muted-foreground">Admit rate per quality tier</p>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? <Skeleton className="h-32 w-full" /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Channel</th>
                    <th className="pr-3 text-right">High</th>
                    <th className="pr-3 text-right">Med</th>
                    <th className="text-right">Low</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.heatmap).map(([label, tiers]) => (
                    <tr key={label} className="border-t">
                      <td className="py-1.5 pr-3 font-medium">{label}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPct(tiers.High)}</td>
                      <td className="pr-3 text-right tabular-nums">{fmtPct(tiers.Med)}</td>
                      <td className="text-right tabular-nums">{fmtPct(tiers.Low)}</td>
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
