/**
 * DrilldownModal — opens when a user clicks a KPI tile / chart "View
 * records" button. Shows the underlying record list bounded at 100 rows
 * (the Phase 2 brief's drill-down page-size cap).
 *
 * MVP for Phase 2B: dialog shell + title + placeholder table. The real
 * record fetch happens via the resolver's `drilldown` config — wiring it
 * to live data is a follow-up once each metric's drill-down query is
 * confirmed against seed.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { downloadCsv, dateStampedName } from "@/lib/exportCsv";

import { EmptyState } from "./EmptyState";

export interface DrilldownRow {
  /** Each row is a plain object — keys become column headers. */
  [key: string]: string | number | boolean | null;
}

interface DrilldownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title of the drill-down (typically the metric label). */
  title: string;
  /** Subtitle for context — e.g. the active filter chips summary. */
  subtitle?: string;
  /** The rows to render. MVP renders a basic table. */
  rows?: ReadonlyArray<DrilldownRow>;
  /** Optional CSV export filename stem. */
  exportName?: string;
}

export function DrilldownModal({
  open,
  onOpenChange,
  title,
  subtitle,
  rows,
  exportName,
}: DrilldownModalProps) {
  const data = rows ?? [];
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

        {data.length === 0 ? (
          <EmptyState
            title="No records to show."
            hint="Try adjusting the filters or expanding the time range."
          />
        ) : (
          <>
            <div className="flex justify-end mb-2">
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
                Export CSV ({data.length} rows)
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
                    <tr
                      key={i}
                      className="border-t hover:bg-muted/20"
                    >
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
