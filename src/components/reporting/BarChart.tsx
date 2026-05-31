/**
 * BarChart — categorical breakdown of a metric. Consumes resolver
 * `BreakdownResult`. Phase 2B uses this for by-LOC, by-rep, and Closed-Lost
 * by-reason charts on Admissions; future pages reuse the same component.
 */

import {
  BarChart as RechartsBarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMetric } from "@/lib/metrics/use-metric";
import { getMetric, type BreakdownResult } from "@/lib/metrics/resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

import { ChartContainer } from "./ChartContainer";
import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

interface BarChartProps {
  metric: string;
  range: DateRange;
  filters: FilterContract;
  title?: string;
  subtitle?: string;
  /**
   * `"grouped"` is the brief's vocabulary but Phase 2A breakdowns are
   * single-series, so the prop is accepted but unused. Future multi-series
   * breakdowns will branch on it.
   */
  variant?: "grouped" | "stacked";
}

export function BarChart({
  metric,
  range,
  filters,
  title,
  subtitle,
}: BarChartProps) {
  const def = getMetric(metric);
  const query = useMetric(metric, range, filters);
  const finalTitle = title ?? def.label;

  return (
    <ChartContainer title={finalTitle} subtitle={subtitle ?? def.description}>
      {query.isLoading || !query.data ? (
        <LoadingSkeleton variant="bar" />
      ) : query.error ? (
        <EmptyState title="Could not load chart." hint={query.error.message} />
      ) : query.data.kind !== "breakdown" ? (
        <EmptyState
          title="Metric shape mismatch."
          hint={`${metric} is not a breakdown — wrong consumer.`}
        />
      ) : (query.data as BreakdownResult).rows.length === 0 ? (
        <EmptyState
          title="No data in this date range."
          hint="Try expanding the time filter."
        />
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart
              data={[...(query.data as BreakdownResult).rows]}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id={`bg-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5BA3D4" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="#5BA3D4" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(15, 37, 73, 0.95)",
                  border: "1px solid rgba(91, 163, 212, 0.3)",
                  color: "white",
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="value"
                name={finalTitle}
                fill={`url(#bg-${metric})`}
                radius={[4, 4, 0, 0]}
              />
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartContainer>
  );
}
