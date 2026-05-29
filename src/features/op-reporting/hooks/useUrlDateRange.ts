// useUrlDateRange — Op-Reporting variant of useDashboardRange that persists
// the active preset (and custom range) in the URL search string.
//
// URL shape:
//   ?range=MTD                              ← preset only
//   ?range=CUSTOM&from=2026-05-01&to=2026-05-15  ← explicit dates
//
// Falls back to the existing localStorage key when no URL param is set so
// reloading on the same page still preserves the picker; clearing the URL
// honors that. Compatible with the shape returned by the legacy
// useDashboardRange (preset / range / setPreset) so pages can swap without
// changes elsewhere.

import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import {
  resolveDateRange,
} from "@/features/analytics-warehouse/hooks/useDateRange";
import type { DateRange, DatePreset } from "@/features/analytics-warehouse/api/types";

const STORAGE_KEY = "cornerstone.opReporting.range";

const ALLOWED_PRESETS: ReadonlySet<DatePreset> = new Set<DatePreset>([
  "TODAY",
  "YESTERDAY",
  "THIS_WEEK",
  "LAST_WEEK",
  "MTD",
  "LAST_MONTH",
  "QTD",
  "YTD",
  "L30D",
  "L90D",
  "CUSTOM",
]);

interface RangeState {
  preset: DatePreset;
  range: DateRange;
}

function readFromStorage(fallback: DatePreset): RangeState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as RangeState | null;
    if (saved && ALLOWED_PRESETS.has(saved.preset)) return saved;
  } catch { /* fall through */ }
  return { preset: fallback, range: resolveDateRange(fallback) };
}

function readFromSearch(search: string, fallback: DatePreset): RangeState | null {
  const params = new URLSearchParams(search);
  const presetRaw = params.get("range");
  if (!presetRaw) return null;
  const preset = presetRaw.toUpperCase() as DatePreset;
  if (!ALLOWED_PRESETS.has(preset)) return null;
  if (preset === "CUSTOM") {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) return null;
    return { preset, range: { from, to } };
  }
  return { preset, range: resolveDateRange(preset) };
}

export function useUrlDateRange(defaultPreset: DatePreset = "MTD") {
  const search = useSearch();
  const [location, setLocation] = useLocation();

  const state = useMemo<RangeState>(() => {
    const fromUrl = readFromSearch(search ?? "", defaultPreset);
    if (fromUrl) return fromUrl;
    return readFromStorage(defaultPreset);
  }, [search, defaultPreset]);

  const setPreset = useCallback(
    (next: DatePreset, custom?: DateRange) => {
      const resolved = resolveDateRange(next, custom);
      const newState: RangeState = { preset: next, range: resolved };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newState)); } catch { /* noop */ }

      const params = new URLSearchParams(search ?? "");
      params.set("range", next);
      if (next === "CUSTOM" && custom) {
        params.set("from", custom.from);
        params.set("to", custom.to);
      } else {
        params.delete("from");
        params.delete("to");
      }
      const qs = params.toString();
      const pathOnly = location.split("?")[0];
      setLocation(`${pathOnly}${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [search, location, setLocation],
  );

  return { preset: state.preset, range: state.range, setPreset };
}
