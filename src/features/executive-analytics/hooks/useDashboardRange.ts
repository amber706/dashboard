// useDashboardRange — turns a DashboardRangePreset into concrete
// {start, end, label} strings. Pure compute; no network. The dashboard
// page stores the preset (plus optional custom start/end) and feeds it
// to every other hook via the resolved object.
//
// Anchor: America/Phoenix (MST, no DST) to match the rest of the
// dashboard. "Today" means today on the wall clock in Phoenix.

import { useMemo } from "react";
import type { DashboardRange, DashboardRangePreset } from "../api/types";

const PHX_OFFSET_HOURS = 7;

function phoenixDate(d: Date): Date {
  return new Date(d.getTime() - PHX_OFFSET_HOURS * 3600_000);
}
function isoDay(d: Date): string {
  // d is treated as UTC; the slice gives YYYY-MM-DD.
  return d.toISOString().slice(0, 10);
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function startOfWeekSunday(d: Date): Date {
  const phx = phoenixDate(d);
  const dow = phx.getUTCDay(); // 0 = Sunday in Phoenix
  return addDays(new Date(Date.UTC(phx.getUTCFullYear(), phx.getUTCMonth(), phx.getUTCDate())), -dow);
}

function startOfMonth(d: Date): Date {
  const phx = phoenixDate(d);
  return new Date(Date.UTC(phx.getUTCFullYear(), phx.getUTCMonth(), 1));
}

function startOfYear(d: Date): Date {
  const phx = phoenixDate(d);
  return new Date(Date.UTC(phx.getUTCFullYear(), 0, 1));
}

export function resolveRange(
  preset: DashboardRangePreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): DashboardRange {
  const today = new Date(Date.UTC(
    phoenixDate(now).getUTCFullYear(),
    phoenixDate(now).getUTCMonth(),
    phoenixDate(now).getUTCDate(),
  ));
  switch (preset) {
    case "today":
      return { preset, start: isoDay(today), end: isoDay(today), label: "Today" };
    case "yesterday": {
      const y = addDays(today, -1);
      return { preset, start: isoDay(y), end: isoDay(y), label: "Yesterday" };
    }
    case "thisWeek":
      return {
        preset,
        start: isoDay(startOfWeekSunday(now)),
        end: isoDay(today),
        label: "This week",
      };
    case "lastWeek": {
      const thisStart = startOfWeekSunday(now);
      const lastStart = addDays(thisStart, -7);
      const lastEnd = addDays(thisStart, -1);
      return { preset, start: isoDay(lastStart), end: isoDay(lastEnd), label: "Last week" };
    }
    case "mtd":
      return {
        preset,
        start: isoDay(startOfMonth(now)),
        end: isoDay(today),
        label: "Month to date",
      };
    case "lastMonth": {
      const thisStart = startOfMonth(now);
      const lastStart = new Date(Date.UTC(thisStart.getUTCFullYear(), thisStart.getUTCMonth() - 1, 1));
      const lastEnd = addDays(thisStart, -1);
      return { preset, start: isoDay(lastStart), end: isoDay(lastEnd), label: "Last month" };
    }
    case "ytd":
      return {
        preset,
        start: isoDay(startOfYear(now)),
        end: isoDay(today),
        label: "Year to date",
      };
    case "lastYear": {
      const thisStart = startOfYear(now);
      const lastStart = new Date(Date.UTC(thisStart.getUTCFullYear() - 1, 0, 1));
      const lastEnd = addDays(thisStart, -1);
      return { preset, start: isoDay(lastStart), end: isoDay(lastEnd), label: "Last year" };
    }
    case "custom":
      return {
        preset,
        start: customStart ?? isoDay(today),
        end: customEnd ?? isoDay(today),
        label: `${customStart ?? isoDay(today)} → ${customEnd ?? isoDay(today)}`,
      };
  }
}

export function useDashboardRange(
  preset: DashboardRangePreset,
  customStart?: string,
  customEnd?: string,
): DashboardRange {
  return useMemo(
    () => resolveRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );
}
