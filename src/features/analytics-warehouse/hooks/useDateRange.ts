import { useState, useCallback, useMemo } from "react";
import type { DateRange, DatePreset } from "../api/types";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function resolveDateRange(preset: DatePreset, custom?: DateRange, today = new Date()): DateRange {
  const startOfMonth   = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const startOfYear    = new Date(today.getFullYear(), 0, 1);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };

  switch (preset) {
    case "MTD":    return { from: isoDate(startOfMonth),   to: isoDate(today) };
    case "QTD":    return { from: isoDate(startOfQuarter), to: isoDate(today) };
    case "YTD":    return { from: isoDate(startOfYear),    to: isoDate(today) };
    case "L30D":   return { from: isoDate(daysAgo(30)),    to: isoDate(today) };
    case "L90D":   return { from: isoDate(daysAgo(90)),    to: isoDate(today) };
    case "CUSTOM": return custom ?? { from: isoDate(startOfMonth), to: isoDate(today) };
  }
}

const STORAGE_KEY = "cornerstone.analyticsWarehouse.range";

export function useDashboardRange(defaultPreset: DatePreset = "MTD") {
  const [{ preset, range }, set] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as
        | { preset: DatePreset; range: DateRange }
        | null;
      if (saved) return saved;
    } catch { /* fall through */ }
    return { preset: defaultPreset, range: resolveDateRange(defaultPreset) };
  });

  const setPreset = useCallback((next: DatePreset, custom?: DateRange) => {
    const resolved = resolveDateRange(next, custom);
    const state = { preset: next, range: resolved };
    set(state);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
  }, []);

  return useMemo(() => ({ preset, range, setPreset }), [preset, range, setPreset]);
}
