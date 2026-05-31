/**
 * `useMetric` — the single React hook every dashboard page uses to read a
 * metric. Wraps the resolver registry (`./resolver.ts`) in a TanStack Query
 * so consumers get caching, loading/error states, and refetch-on-filter for
 * free.
 *
 * Usage pattern:
 *
 *     // somewhere in /pages/reporting/admissions.tsx
 *     import "@/lib/metrics/keys/admissions"; // side-effect: registers the page's keys
 *     import { useMetric } from "@/lib/metrics/use-metric";
 *
 *     const mqls = useMetric("admissions.mqls_total", range, filters);
 *
 * The key is passed as a plain string at the call site — TypeScript narrows
 * it via the union exported from each `keys/<page>.ts` (`AdmissionsMetricKey`,
 * etc.). If a page tries to use a key that hasn't been registered at app
 * startup, `getMetric` throws loudly so the missing import is found at dev
 * time, not in production.
 */

import { useQuery } from "@tanstack/react-query";

import { getMetric, type MetricResult } from "./resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

/**
 * Stable cache-key serializer for (range, FilterContract). Used as the
 * TanStack Query key so two pages requesting the same metric with the same
 * inputs share the cached response (and a filter flip on one page warms
 * the other).
 */
function metricCacheKey(range: DateRange, filters: FilterContract): string {
  return [
    range.from,
    range.to,
    filters.pipelines.join(","),
    filters.sources.join(","),
    filters.locs.join(","),
    filters.reps.join(","),
  ].join("|");
}

export function useMetric(
  key: string,
  range: DateRange,
  filters: FilterContract,
) {
  return useQuery<MetricResult, Error>({
    queryKey: ["metric", key, metricCacheKey(range, filters)],
    queryFn: () => getMetric(key).resolve(range, filters),
    // Match the rest of the op-reporting hooks: 5min staleness, no refetch
    // on focus (handled at the App.tsx QueryClient default).
    staleTime: 5 * 60 * 1000,
  });
}
