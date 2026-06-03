/**
 * DrilldownModal — opens when a user clicks a KPI tile / chart "View
 * records" button. Shows the underlying record list bounded at 100 rows
 * (the Phase 2 brief's drill-down page-size cap).
 *
 * Two modes:
 *   1. Smart (recommended): pass `metric` + `range` + `filters`. The modal
 *      calls `useDrilldown` internally and handles loading / error / empty.
 *   2. Dumb: pass pre-fetched `rows`. Used by callers that already have the
 *      records on hand (e.g. matrix-cell drill-downs that pre-narrow).
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";

import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { useDrilldown, type DrilldownRow } from "./use-drilldown";

export type { DrilldownRow };

interface DrilldownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title of the drill-down (typically the metric label). */
  title: string;
  /** Subtitle for context — e.g. the active filter chips summary. */
  subtitle?: string;
  /** Smart mode: metric_key + window + filters → modal fetches records itself. */
  metric?: string;
  range?: DateRange;
  filters?: FilterContract;
  /** Dumb mode: caller pre-fetched rows. Takes precedence over the smart-mode fields. */
  rows?: ReadonlyArray<DrilldownRow>;
  /** Optional CSV export filename stem. */
  exportName?: string;
}

export function DrilldownModal({
  open,
  onOpenChange,
  title,
  subtitle,
  metric,
  range,
  filters,
  rows: rowsOverride,
  exportName,
}: DrilldownModalProps) {
  // Smart-mode hook is conditionally enabled — runs only when the modal is
  // open AND no caller-supplied rows take precedence.
  const smartEnabled = open && !rowsOverride && !!metric && !!range && !!filters;
  const query = useDrilldown(
    smartEnabled ? metric! : null,
    range ?? { from: "1970-01-01", to: "1970-01-01" },
    filters ?? { pipelines: [], sources: [], locs: [], reps: [] },
    smartEnabled,
  );

  const isLoading = smartEnabled && (query.isLoading || query.isFetching);
  const error = smartEnabled ? query.error : null;
  const notes = smartEnabled ? query.data?.notes ?? null : null;
  const data = rowsOverride ?? query.data?.rows ?? [];
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </DialogHeader>

        {isLoading ? (
          <LoadingSkeleton variant="matrix" />
        ) : error ? (
          <EmptyState title="Could not load records." hint={error.message} />
        ) : notes ? (
          <EmptyState title="Drill-down coming soon." hint={notes} />
        ) : data.length === 0 ? (
          <EmptyState
            title="No records to show."
            hint="Try adjusting the filters or expanding the time range."
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Showing {data.length} record{data.length === 1 ? "" : "s"}
                {data.length === 100 ? " (capped at 100 — narrow the filters for more)" : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    dateStampedName(exportName ?? "drilldown"),
                    data as Record<string, unknown>[],
                  )
                }
              >
                Export CSV
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-auto border rounded-md">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className="px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-muted/20">
                      {columns.map((c) => (
                        <td key={c} className="px-3 py-1.5 tabular-nums">
                          {r[c] == null ? "" : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
