/**
 * AsOfBadge — surfaces the most recent sync time for the data sources a
 * page depends on. Phase 2A's Admissions page wraps the existing
 * CacheFreshnessBadge with a friendly label since the Phase 1c freshness
 * surface already shows the right info from `reporting_op_cache_freshness`.
 *
 * This component is a thin wrapper so future pages can swap in a different
 * underlying source without changing every consumer.
 */

import { CacheFreshnessBadge } from "@/features/op-reporting/components/CacheFreshnessBadge";

interface AsOfBadgeProps {
  /** Optional label override. Default: "Data as of" prefix on the freshness time. */
  label?: string;
}

export function AsOfBadge({ label }: AsOfBadgeProps = {}) {
  // CacheFreshnessBadge already pulls the latest sync from
  // reporting_op_cache_freshness. We wrap it in a labeled span so the page
  // header reads "Data as of: <freshness>" rather than just a bare badge.
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      {label !== "" && <span>{label ?? "Data as of"}</span>}
      <CacheFreshnessBadge />
    </span>
  );
}
