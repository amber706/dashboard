// filterArgs — packs a FilterContract into the RPC arg shape the
// filtered RPCs expect (NULL for empty arrays).
//
// Keeps the per-hook "if any filter active, route to filtered RPC" pattern
// from duplicating logic in five hooks.

import type { FilterContract } from "@/features/op-reporting/components/FilterBar";

export function filtersActive(filters?: FilterContract): boolean {
  if (!filters) return false;
  return filters.pipelines.length > 0 || filters.sources.length > 0 || filters.locs.length > 0;
}

export function filterArgs(filters?: FilterContract) {
  return {
    p_pipelines: filters && filters.pipelines.length > 0 ? filters.pipelines : null,
    p_source_categories: filters && filters.sources.length > 0 ? filters.sources : null,
    p_locs: filters && filters.locs.length > 0 ? filters.locs : null,
  };
}

export function filterCacheKey(filters?: FilterContract): string {
  if (!filters) return "";
  return `${filters.pipelines.join(",")}|${filters.sources.join(",")}|${filters.locs.join(",")}`;
}
