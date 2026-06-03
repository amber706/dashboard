/**
 * TrendChart — daily series of a scalar metric, rendered as a filled area
 * chart. Phase 2A's resolver returns `ScalarResult.series` shaped exactly
 * for this; future metrics can extend the substrate if they need
 * multi-series.
 */

import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMetric } from "@/lib/metrics/use-metric";
import { getMetric, type ScalarResult } from "@/lib/metrics/resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

import { ChartContainer } from "./ChartContainer";
import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

interface TrendChartProps {
  metric: string;
  range: DateRange;
  filters: FilterContract;
  title?: string;
  subtitle?: string;
}

export function TrendChart({
  metric,
  range,
  filters,
  title,
  subtitle,
}: TrendChartProps) {
  const def = getMetric(metric);
  const query = useMetric(metric, range, filters);
  const finalTitle = title ?? def.label;

  return (
    <ChartContainer title={finalTitle} subtitle={subtitle ?? def.description}>
      {query.isLoading || !query.data ? (
        <LoadingSkeleton variant="trend" />
      ) : query.error ? (
        <EmptyState title="Could not load chart." hint={query.error.message} />
      ) : query.data.kind !== "scalar" ? (
        <EmptyState
          title="Metric shape mismatch."
          hint={`${metric} is not a scalar — wrong consumer.`}
        />
      ) : (query.data as ScalarResult).series.length === 0 ? (
        <EmptyState
          title="No data in this date range."
          hint="Try expanding the time filter."
        />
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={[...(query.data as ScalarResult).series]}>
              <defs>
                <linearGradient id={`tg-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5BA3D4" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#5BA3D4" stopOpacity={0.05} />
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
                dataKey="value"
                name={finalTitle}
                stroke="#5BA3D4"
                fill={`url(#tg-${metric})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartContainer>
  );
}
