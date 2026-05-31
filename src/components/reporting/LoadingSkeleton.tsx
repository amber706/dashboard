/**
 * LoadingSkeleton — the standard loading placeholder for every reporting
 * component. Thin wrapper over shadcn's Skeleton with size presets keyed
 * to the three component shapes that consume it.
 */

import { Skeleton } from "@/components/ui/skeleton";

type Variant = "kpi" | "trend" | "bar" | "matrix";

interface LoadingSkeletonProps {
  variant?: Variant;
  className?: string;
}

const HEIGHT: Record<Variant, string> = {
  kpi: "h-28",
  trend: "h-[260px]",
  bar: "h-[220px]",
  matrix: "h-[360px]",
};

export function LoadingSkeleton({ variant = "kpi", className = "" }: LoadingSkeletonProps) {
  return <Skeleton className={`${HEIGHT[variant]} w-full ${className}`} />;
}
