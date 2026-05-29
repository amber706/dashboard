// /analytics/op-overview — Phase 1C executive landing page.
//
// Single-pane-of-glass for the new op_metric pipeline. Pulls the same hooks
// the detail pages use (no new RPCs), composes them into the headline view,
// and deep-links to /analytics/op-funnel, /op-rep-activity, /op-referrals
// for the drill-downs.

import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/section-header";
import { MetricCard } from "@/components/dashboard/MetricCard";
import {
  Inbox, ShieldCheck, CheckCircle2, Handshake, Calendar, ChevronRight,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useUrlDateRange } from "@/features/op-reporting/hooks/useUrlDateRange";
import { RangePicker } from "@/features/analytics-warehouse/components/RangePicker";
import { useOpFunnel } from "@/features/op-reporting/hooks/useOpFunnel";
import {
  useOpFunnelByPipeline,
  isTopLine,
} from "@/features/op-reporting/hooks/useOpFunnelByPipeline";
import { useOpRepActivity } from "@/features/op-reporting/hooks/useOpRepActivity";
import { useOpReferrals } from "@/features/op-reporting/hooks/useOpReferrals";
import { FilterBar } from "@/features/op-reporting/components/FilterBar";
import { useFilterUrlState } from "@/features/op-reporting/hooks/useFilterUrlState";
import { ExportButton } from "@/features/op-reporting/components/ExportButton";
import { SavedViewsControl } from "@/features/op-reporting/components/SavedViewsControl";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const fmtPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(d)}%`;

interface DrillCardProps {
  title: string;
  description: string;
  href: string;
  children: React.ReactNode;
}

function DrillCard({ title, description, href, children }: DrillCardProps) {
  return (
    <Card className="hover:border-[#5BA3D4]/40 transition-colors">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        <Link href={href}>
          <Button variant="ghost" size="sm" className="text-xs h-7">
            Open <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function OpOverview() {
  const { preset, range, setPreset } = useUrlDateRange("MTD");
  const [filters, setFilters] = useFilterUrlState();
  const funnel = useOpFunnel(range, filters);
  const byPipeline = useOpFunnelByPipeline(range, filters);
  const repActivity = useOpRepActivity(range);
  const referrals = useOpReferrals(range);
  const hasFilters =
    filters.pipelines.length + filters.sources.length + filters.locs.length > 0;

  const topLine = byPipeline.data?.topLineTotals;
  const topLineMqlToAdmit =
    topLine && topLine.mqls_count > 0 ? topLine.admits_count / topLine.mqls_count : null;

  const topReps = repActivity.data?.rows.slice(0, 5) ?? [];
  const topReferOutTypes = referrals.data?.breakdown.slice(0, 5) ?? [];

  const isLoading =
    funnel.isLoading || byPipeline.isLoading || repActivity.isLoading || referrals.isLoading;
  const firstError =
    funnel.error ?? byPipeline.error ?? repActivity.error ?? referrals.error;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Reporting overview"
          subtitle="Single-pane summary of the Phase 1B reporting pipeline. Cache rebuilds at 02:00 Phoenix; deep-link to the detail pages for slicing."
        />
        <div className="flex items-center gap-2">
          <ExportButton
            disabled={!funnel.data || funnel.data.rows.length === 0}
            onExport={() => downloadCsv(dateStampedName("op-overview-funnel"), funnel.data?.rows ?? [])}
            label="Export funnel"
          />
          <RangePicker preset={preset} range={range} onChange={setPreset} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FilterBar filters={filters} onChange={setFilters} />
        <SavedViewsControl pageKey="op-overview" filters={filters} onApply={setFilters} />
      </div>

      {hasFilters && (
        <div className="text-xs text-muted-foreground">
          Funnel KPIs + Pipeline split honor the filters above. Rep activity and Referral mix cards
          stay at the all-data totals — those rollups don't yet carry the same dimensions.
        </div>
      )}

      {firstError && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(firstError as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Headline KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              label="Top-line MQLs"
              value={fmtNumber(topLine?.mqls_count ?? 0)}
              severity="info"
              icon={Inbox}
            />
            <MetricCard
              label="Top-line VOBs"
              value={fmtNumber(topLine?.vobs_count ?? 0)}
              severity="info"
              icon={ShieldCheck}
            />
            <MetricCard
              label="Top-line Admits"
              value={fmtNumber(topLine?.admits_count ?? 0)}
              severity="success"
              icon={CheckCircle2}
              delta={
                topLineMqlToAdmit != null
                  ? { value: fmtPct(topLineMqlToAdmit), direction: "flat", vs: "MQL → Admit" }
                  : undefined
              }
            />
            <MetricCard
              label="BD Referrals In"
              value={fmtNumber(referrals.data?.totals.bd_referrals_in ?? 0)}
              severity="success"
              icon={Handshake}
            />
            <MetricCard
              label="Meetings"
              value={fmtNumber(repActivity.data?.totals.meetings_count ?? 0)}
              severity="info"
              icon={Calendar}
            />
          </>
        )}
      </div>

      {/* Trend chart — top-line admits over time */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Admits trend</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Top-line + non-top-line admits per day. Top-line excludes DUI and DV
              completions per CONFIRMED.md #3.
            </p>
          </div>
          <Link href="/analytics/op-funnel">
            <Button variant="ghost" size="sm" className="text-xs h-7">
              Funnel detail <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="h-[260px]">
          {funnel.isLoading || !funnel.data ? (
            <Skeleton className="h-full w-full" />
          ) : funnel.data.rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No data in window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={funnel.data.rows}>
                <defs>
                  <linearGradient id="g-admits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
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
                <Area
                  type="monotone"
                  dataKey="admits_count"
                  name="Admits (all pipelines)"
                  stroke="#10B981"
                  fill="url(#g-admits)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Drill-down cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DrillCard
          title="Pipeline split"
          description="MQLs → Admits by pipeline, with top-line subtotal."
          href="/analytics/op-funnel"
        >
          {byPipeline.isLoading || !byPipeline.data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b text-xs">
                  <th className="py-1 pr-4">Pipeline</th>
                  <th className="py-1 pr-4 text-right">MQLs</th>
                  <th className="py-1 pr-4 text-right">Admits</th>
                  <th className="py-1 pr-0 text-right">MQL → Admit</th>
                </tr>
              </thead>
              <tbody>
                {byPipeline.data.rows
                  .filter((r) => r.pipeline != null)
                  .map((r) => {
                    const ratio = r.mqls_count > 0 ? r.admits_count / r.mqls_count : null;
                    return (
                      <tr key={r.pipeline} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 font-medium">
                          {r.pipeline}
                          {isTopLine(r.pipeline) && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-[#10B981]">top-line</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtNumber(r.mqls_count)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtNumber(r.admits_count)}</td>
                        <td className="py-1.5 pr-0 text-right tabular-nums">{fmtPct(ratio)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </DrillCard>

        <DrillCard
          title="Top BD reps by meetings"
          description="Specialist meeting volume over the window."
          href="/analytics/op-rep-activity"
        >
          {repActivity.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : topReps.length === 0 ? (
            <div className="text-sm text-muted-foreground">No rep activity in this window.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b text-xs">
                  <th className="py-1 pr-4">Specialist</th>
                  <th className="py-1 pr-4 text-right">Calls</th>
                  <th className="py-1 pr-0 text-right">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {topReps.map((r) => (
                  <tr key={r.owner_user_id ?? "_"} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-medium">{r.full_name ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {fmtNumber(r.inbound_calls + r.outbound_calls)}
                    </td>
                    <td className="py-1.5 pr-0 text-right tabular-nums">{fmtNumber(r.meetings_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DrillCard>

        <DrillCard
          title="Referral mix"
          description="BD vs Digital vs ZocDoc inflow."
          href="/analytics/op-referrals"
        >
          {referrals.isLoading || !referrals.data ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">BD</div>
                <div className="text-2xl font-medium tabular-nums">
                  {fmtNumber(referrals.data.totals.bd_referrals_in)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Digital</div>
                <div className="text-2xl font-medium tabular-nums">
                  {fmtNumber(referrals.data.totals.digital_referrals_in)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">ZocDoc/other</div>
                <div className="text-2xl font-medium tabular-nums">
                  {fmtNumber(referrals.data.totals.other_referrals_in)}
                </div>
              </div>
            </div>
          )}
        </DrillCard>

        <DrillCard
          title="Closed referred-out, by type"
          description="Refer_Out_Type custom picklist (CONFIRMED.md #37)."
          href="/analytics/op-referrals"
        >
          {referrals.isLoading || !referrals.data ? (
            <Skeleton className="h-24 w-full" />
          ) : topReferOutTypes.length === 0 ? (
            <div className="text-sm text-muted-foreground">No closed referred-out in this window.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {topReferOutTypes.map((b, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>{b.refer_out_type ?? "(no type set)"}</span>
                  <span className="tabular-nums font-medium">{fmtNumber(b.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </DrillCard>
      </div>
    </div>
  );
}
