/**
 * /src/components/reporting — shared component library for every reporting
 * dashboard page (Admissions first; Executive / BD / Marketing to follow).
 *
 * Every component consumes a metric_key + (range, FilterContract) tuple and
 * routes through `useMetric` (the resolver substrate). No component here
 * touches Supabase directly — that's the resolver's job. This barrel export
 * is the public surface; pages should ONLY import from here.
 */

export { AsOfBadge } from "./AsOfBadge";
export { BarChart } from "./BarChart";
export { ChartContainer } from "./ChartContainer";
export { DrilldownModal, type DrilldownRow } from "./DrilldownModal";
export { EmptyState } from "./EmptyState";
export { KPICard } from "./KPICard";
export { LoadingSkeleton } from "./LoadingSkeleton";
export { MatrixTable } from "./MatrixTable";
export { TrendChart } from "./TrendChart";
