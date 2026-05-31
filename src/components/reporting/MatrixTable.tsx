/**
 * MatrixTable — rep × LOC grid used by the Admissions page. Consumes a
 * resolver `MatrixResult` and renders rows down + cols across. Each cell is
 * clickable; clicks open a DrilldownModal stub (live wiring deferred).
 *
 * The brief asks for the three matrix metrics (MQLs / VOBs / Admits) to share
 * a single table with a tab control switching between them — the parent
 * controls which `metric` is passed in based on the active tab.
 */

import { useState } from "react";

import { useMetric } from "@/lib/metrics/use-metric";
import { getMetric, type MatrixResult } from "@/lib/metrics/resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

import { ChartContainer } from "./ChartContainer";
import { DrilldownModal } from "./DrilldownModal";
import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

interface MatrixTableProps {
  metric: string;
  range: DateRange;
  filters: FilterContract;
  title?: string;
  subtitle?: string;
}

export function MatrixTable({
  metric,
  range,
  filters,
  title,
  subtitle,
}: MatrixTableProps) {
  const def = getMetric(metric);
  const query = useMetric(metric, range, filters);
  const [drilldownCell, setDrilldownCell] = useState<{
    row: string;
    col: string;
  } | null>(null);

  return (
    <ChartContainer title={title ?? def.label} subtitle={subtitle ?? def.description}>
      {query.isLoading || !query.data ? (
        <LoadingSkeleton variant="matrix" />
      ) : query.error ? (
        <EmptyState title="Could not load matrix." hint={query.error.message} />
      ) : query.data.kind !== "matrix" ? (
        <EmptyState
          title="Metric shape mismatch."
          hint={`${metric} is not a matrix — wrong consumer.`}
        />
      ) : (query.data as MatrixResult).rows.length === 0 ? (
        <EmptyState
          title="No data in this date range."
          hint="Try expanding the time filter or removing rep/LOC filters."
        />
      ) : (
        renderMatrix(query.data as MatrixResult, setDrilldownCell)
      )}

      <DrilldownModal
        open={!!drilldownCell}
        onOpenChange={(o) => !o && setDrilldownCell(null)}
        title={
          drilldownCell
            ? `${def.label} — ${drilldownCell.row} × ${drilldownCell.col}`
            : def.label
        }
        subtitle={
          drilldownCell
            ? `Drill-down narrows by rep + LOC. Note: matrix-cell scoping is approximate — page-wide filters still apply.`
            : undefined
        }
        metric={metric}
        range={range}
        filters={filters}
        exportName={`drilldown-${metric.replace(/\./g, "-")}`}
      />
    </ChartContainer>
  );
}

function renderMatrix(
  data: MatrixResult,
  onCellClick: (cell: { row: string; col: string }) => void,
) {
  // Index cells by (row, col) for O(1) lookup during render.
  const cellMap = new Map<string, number | null>();
  for (const c of data.cells) {
    cellMap.set(`${c.row_dim_value}::${c.col_dim_value}`, c.value);
  }

  return (
    <div className="max-h-[360px] overflow-auto border rounded-md">
      <table className="min-w-full text-xs">
        <thead className="bg-muted/40 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted/40">
              Rep
            </th>
            {data.cols.map((c) => (
              <th
                key={c.col_dim_value}
                className="px-3 py-2 text-right font-medium text-muted-foreground"
              >
                {c.col_label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.row_dim_value} className="border-t hover:bg-muted/10">
              <td className="px-3 py-1.5 font-medium sticky left-0 bg-background">
                {r.row_label}
              </td>
              {data.cols.map((c) => {
                const v = cellMap.get(`${r.row_dim_value}::${c.col_dim_value}`);
                return (
                  <td
                    key={c.col_dim_value}
                    className="px-3 py-1.5 text-right tabular-nums cursor-pointer hover:bg-[#5BA3D4]/10"
                    onClick={() =>
                      onCellClick({ row: r.row_label, col: c.col_label })
                    }
                  >
                    {v == null ? "—" : NUMBER_FORMAT.format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
