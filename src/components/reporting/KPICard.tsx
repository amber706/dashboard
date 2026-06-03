/**
 * KPICard — metric-keyed scalar tile. Every Admissions-page conversion ratio,
 * call total, and Closed-Lost headline runs through this component.
 *
 * The brief asks for: ratio/value display, sparkline of last 30 days, delta
 * vs prior period, click → DrilldownModal. The substrate gives us scalar
 * + series + prior_period_value out of the resolver; this component formats
 * + flips severity based on the metric's `inverse` flag (down-is-good).
 */

import { useState } from "react";

import { MetricCard, type Severity } from "@/components/dashboard/MetricCard";
import { roleLabel } from "@/lib/reporting/role_copy";
import { useAuth } from "@/lib/auth-context";

import { useMetric } from "@/lib/metrics/use-metric";
import { getMetric, type ScalarResult } from "@/lib/metrics/resolver";
import type { DateRange } from "@/features/analytics-warehouse/api/types";
import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

import { DrilldownModal } from "./DrilldownModal";

interface KPICardProps {
  /** A registered metric key — e.g. "admissions.mqls_total". */
  metric: string;
  range: DateRange;
  filters: FilterContract;
  /** Override the metric's default label (passes through the role helper). */
  labelOverride?: string;
  /** Render as a "Coming soon" placeholder — used for the Phase 3 slot. */
  placeholder?: boolean;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

function fmtScalar(value: number | null, asRatio: boolean): string {
  if (value == null) return "—";
  if (asRatio) return `${(value * 100).toFixed(1)}%`;
  return NUMBER_FORMAT.format(value);
}

export function KPICard({
  metric,
  range,
  filters,
  labelOverride,
  placeholder,
}: KPICardProps) {
  const { role } = useAuth();
  const def = placeholder ? null : getMetric(metric);
  const query = useMetric(placeholder ? "" : metric, range, filters);
  const [open, setOpen] = useState(false);

  // The Phase 3+ "Coming soon" slot — render the frame, no data wiring.
  if (placeholder) {
    return (
      <div className="glass rounded-2xl p-5 shadow-card relative overflow-hidden opacity-60">
        <span className="severity-bar info" aria-hidden="true" />
        <div className="text-[12px] text-[#C5D2E5] leading-snug">
          {labelOverride ?? "Call quality"}
        </div>
        <div className="text-sm text-[#9AABC9] mt-2">Coming soon</div>
      </div>
    );
  }

  if (query.isLoading || !query.data) {
    // Use MetricCard's dimensions so the layout doesn't shift on settle.
    return (
      <MetricCard label={roleLabel(role, labelOverride ?? def!.label)} value="—" severity="info" />
    );
  }

  if (query.error) {
    return (
      <MetricCard
        label={roleLabel(role, labelOverride ?? def!.label)}
        value="—"
        severity="danger"
        delta={{ value: "load failed", direction: "flat" }}
      />
    );
  }

  // Resolver may return scalar / breakdown / matrix. KPI tiles only render
  // scalars — anything else is a programmer error and shows as "—".
  if (query.data.kind !== "scalar") {
    return (
      <MetricCard
        label={roleLabel(role, labelOverride ?? def!.label)}
        value="—"
        severity="warning"
        delta={{ value: "wrong shape", direction: "flat" }}
      />
    );
  }

  const result: ScalarResult = query.data;
  // Ratios are stored as decimals (0..1). The metric key naming convention
  // signals which is which: `*_rate` and `*_pct_*` are ratios.
  const asRatio = /_rate$|_pct_/.test(metric);

  // Severity: success/danger flips for `inverse: true` metrics (down-is-good).
  const inverse = def!.inverse === true;
  const severity: Severity = inverse ? "warning" : "success";

  const formatted = fmtScalar(result.value, asRatio);

  // Sparkline — only when we actually have a series.
  const spark = result.series
    .map((p) => p.value)
    .filter((v): v is number => v != null);

  // Delta arrow: if prior_period_value present, compute direction.
  let delta: { value: string; direction: "up" | "down" | "flat"; vs?: string } | undefined;
  if (result.prior_period_value != null && result.value != null) {
    const diff = result.value - result.prior_period_value;
    delta = {
      value: asRatio
        ? `${(Math.abs(diff) * 100).toFixed(1)}pp`
        : NUMBER_FORMAT.format(Math.abs(Math.round(diff))),
      direction: diff > 0 ? (inverse ? "down" : "up") : diff < 0 ? (inverse ? "up" : "down") : "flat",
      vs: "vs prior",
    };
  }

  return (
    <>
      <MetricCard
        label={roleLabel(role, labelOverride ?? def!.label)}
        value={formatted}
        severity={severity}
        sparkline={spark.length > 1 ? spark : undefined}
        delta={delta}
        onClick={() => setOpen(true)}
      />
      <DrilldownModal
        open={open}
        onOpenChange={setOpen}
        title={def!.label}
        subtitle={def!.description}
        metric={metric}
        range={range}
        filters={filters}
        exportName={`drilldown-${metric.replace(/\./g, "-")}`}
      />
    </>
  );
}
