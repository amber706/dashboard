// useFilterUrlState — persists FilterContract in the URL search string.
//
// Drop-in replacement for `useState<FilterContract>(EMPTY_FILTERS)`. The
// filter state lives in `?pipeline=…&channel=…&loc=…&rep=…` so reloads,
// back/forward, and pasted links all reproduce the same view.
//
// Multi-value selections are joined with `+` (URL-safe, no escaping needed
// for our enum values which are lowercase ASCII with underscores). Empty
// arrays drop the param entirely so a no-filter URL stays clean.

import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import {
  EMPTY_FILTERS,
  type FilterContract,
} from "@/features/op-reporting/components/FilterBar";
import type {
  Pipeline,
  SourceCategory,
  LevelOfCare,
} from "@/lib/metrics/definitions";

const KEY = {
  pipelines: "pipeline",
  sources: "channel",
  locs: "loc",
  reps: "rep",
} as const;

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split("+").filter(Boolean);
}

function decodeFromSearch(search: string): FilterContract {
  const params = new URLSearchParams(search);
  return {
    pipelines: parseList(params.get(KEY.pipelines)) as Pipeline[],
    sources: parseList(params.get(KEY.sources)) as SourceCategory[],
    locs: parseList(params.get(KEY.locs)) as LevelOfCare[],
    reps: parseList(params.get(KEY.reps)),
  };
}

function encodeToSearch(filters: FilterContract, base: string): string {
  // Preserve any unrelated params already on the URL (range pickers, etc.).
  const params = new URLSearchParams(base);
  const setOrDelete = (k: string, vs: readonly string[]) => {
    if (vs.length === 0) params.delete(k);
    else params.set(k, vs.join("+"));
  };
  setOrDelete(KEY.pipelines, filters.pipelines);
  setOrDelete(KEY.sources, filters.sources);
  setOrDelete(KEY.locs, filters.locs);
  setOrDelete(KEY.reps, filters.reps);
  const out = params.toString();
  return out ? `?${out}` : "";
}

export function useFilterUrlState(): [FilterContract, (next: FilterContract) => void] {
  const search = useSearch();
  const [location, setLocation] = useLocation();

  const filters = useMemo<FilterContract>(() => {
    if (!search) return EMPTY_FILTERS;
    return decodeFromSearch(search);
  }, [search]);

  const setFilters = useCallback(
    (next: FilterContract) => {
      const nextSearch = encodeToSearch(next, search ?? "");
      // wouter setLocation accepts the path (excluding origin). Strip query
      // off `location` if any, then append the new one.
      const pathOnly = location.split("?")[0];
      setLocation(`${pathOnly}${nextSearch}`, { replace: true });
    },
    [search, location, setLocation],
  );

  return [filters, setFilters];
}
