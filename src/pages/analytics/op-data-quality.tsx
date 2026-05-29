// /analytics/op-data-quality — ops dashboard for the Phase 1B pipeline health.
//
// Three sections:
//   1. Summary tiles — counts of unmapped enums, orphans, and sync failures.
//   2. Sync health table — last run per sync function (matches v_sync_health).
//   3. Recent sync failures — bucketed by source × failure_type from the
//      last 7 days, with sample raw_value + error for triage.
//
// Wraps the migration-160 views via the manager-gated RPCs added in
// migration 170.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/section-header";
import { CacheFreshnessBadge } from "@/features/op-reporting/components/CacheFreshnessBadge";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { AlertTriangle, CheckCircle2, Tag, Link as LinkIcon } from "lucide-react";
import { useOpDataQuality } from "@/features/op-reporting/hooks/useOpDataQuality";

const fmtNumber = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");

const CATEGORY_LABEL: Record<string, string> = {
  unmapped_sources: "Unmapped sources",
  unmapped_locs: "Unmapped LOCs",
  unmapped_stages: "Unmapped stages",
  unmapped_pipelines: "Unmapped pipelines",
  orphan_deals: "Orphan deals",
  orphan_calls: "Orphan calls",
  sync_failures_recent: "Sync failures (7d)",
};

const STATUS_TONE: Record<string, string> = {
  success: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30",
  partial: "bg-[#E5C879]/10 text-[#E5C879] border-[#E5C879]/30",
  failure: "bg-[#E89077]/10 text-[#E89077] border-[#E89077]/30",
  running: "bg-[#5BA3D4]/10 text-[#5BA3D4] border-[#5BA3D4]/30",
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OpDataQuality() {
  const { data, isLoading, error } = useOpDataQuality();

  const bySummary = new Map((data?.summary ?? []).map((r) => [r.category, r.count]));
  const unmappedAny =
    (bySummary.get("unmapped_sources") ?? 0) +
    (bySummary.get("unmapped_locs") ?? 0) +
    (bySummary.get("unmapped_stages") ?? 0) +
    (bySummary.get("unmapped_pipelines") ?? 0);
  const orphansAny =
    (bySummary.get("orphan_deals") ?? 0) + (bySummary.get("orphan_calls") ?? 0);
  const recentFailures = bySummary.get("sync_failures_recent") ?? 0;
  const allClean = unmappedAny === 0 && orphansAny === 0 && recentFailures === 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          title="Data quality"
          subtitle="Sync health, unmapped enum values, and orphan records for the Phase 1B pipeline. Wraps the migration-160 views."
        />
      </div>


      <div className="flex justify-end -mt-3">
        <CacheFreshnessBadge />
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Could not load — {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              label="Unmapped values"
              value={fmtNumber(unmappedAny)}
              severity={unmappedAny === 0 ? "success" : "warning"}
              icon={Tag}
              successCheck={unmappedAny === 0}
              delta={
                unmappedAny > 0
                  ? { value: "needs mapping seed", direction: "flat" }
                  : undefined
              }
            />
            <MetricCard
              label="Orphan records"
              value={fmtNumber(orphansAny)}
              severity={orphansAny === 0 ? "success" : "warning"}
              icon={LinkIcon}
              successCheck={orphansAny === 0}
            />
            <MetricCard
              label="Sync failures (7d)"
              value={fmtNumber(recentFailures)}
              severity={recentFailures === 0 ? "success" : "danger"}
              icon={AlertTriangle}
              successCheck={recentFailures === 0}
            />
            <MetricCard
              label="Pipeline state"
              value={allClean ? "Healthy" : "Attention"}
              severity={allClean ? "success" : "warning"}
              icon={CheckCircle2}
              successCheck={allClean}
            />
          </>
        )}
      </div>

      {/* Sync health */}
      <Card>
        <CardHeader>
          <CardTitle>Sync health (latest run per function)</CardTitle>
          <p className="text-sm text-muted-foreground">
            One row per sync function. Status, rows, last-error from v_sync_health.
            Cron schedule is 07:15 / 07:30 / 07:45 / 08:00 / 08:15 UTC + the
            09:00 UTC op-metric builder.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-60 w-full" />
          ) : data.health.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">
              No sync runs recorded yet — the first cron cycle will populate this.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Function</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Rows</th>
                    <th className="py-2 pr-4 text-right">Failed</th>
                    <th className="py-2 pr-4">Last run</th>
                    <th className="py-2 pr-0">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.health.map((h) => (
                    <tr key={h.function_name} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{h.function_name}</td>
                      <td className="py-2 pr-4">
                        {h.last_status && (
                          <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_TONE[h.last_status] ?? STATUS_TONE.success}`}>
                            {h.last_status}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(h.last_rows_processed)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {h.last_rows_failed && h.last_rows_failed > 0 ? (
                          <span className="text-[#E89077]">{fmtNumber(h.last_rows_failed)}</span>
                        ) : (
                          fmtNumber(h.last_rows_failed)
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground" title={fmtTime(h.last_finished_at ?? h.last_started_at)}>
                        {fmtAgo(h.last_finished_at ?? h.last_started_at)}
                      </td>
                      <td className="py-2 pr-0 text-muted-foreground text-xs truncate max-w-[280px]" title={h.last_error_message ?? ""}>
                        {h.last_error_message ?? <span className="text-[#10B981]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent failures */}
      <Card>
        <CardHeader>
          <CardTitle>Recent sync failures (last 7 days)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Unresolved entries from reporting.sync_failures bucketed by source + failure_type.
            Clear a bucket by reviewing the rows then `UPDATE reporting.sync_failures SET resolved_at = NOW() WHERE …`.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.failures.length === 0 ? (
            <div className="text-sm py-6 text-[#10B981] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> No unresolved failures in the last 7 days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Failure type</th>
                    <th className="py-2 pr-4 text-right">Count</th>
                    <th className="py-2 pr-4">Last seen</th>
                    <th className="py-2 pr-4">Sample raw value</th>
                    <th className="py-2 pr-0">Sample error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.failures.map((f, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{f.source}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {f.failure_type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmtNumber(f.n)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{fmtAgo(f.last_occurred_at)}</td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs truncate max-w-[200px]" title={f.sample_raw_value ?? ""}>
                        {f.sample_raw_value ?? "—"}
                      </td>
                      <td className="py-2 pr-0 text-muted-foreground text-xs truncate max-w-[260px]" title={f.sample_error ?? ""}>
                        {f.sample_error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
