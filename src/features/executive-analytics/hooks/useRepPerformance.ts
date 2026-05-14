import { useQuery } from "@tanstack/react-query";
import { fetchAnalyticsRep } from "../api/client";
import type { DashboardRange } from "../api/types";
import type { RoleKey } from "../constants/roles";

// useRepPerformance — per-rep table. For role=digitalMarketing the
// edge function returns { rows: [], note: 'not_applicable' } and the
// tab hides itself; we still call it so the audit log captures the
// view.
export function useRepPerformance(role: RoleKey, range: DashboardRange) {
  return useQuery({
    queryKey: ["executive-analytics", "rep", role, range.start, range.end],
    queryFn: async () => {
      const json = await fetchAnalyticsRep({ role, start: range.start, end: range.end });
      if (!json.ok) throw new Error(json.error ?? "rep load failed");
      return json;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
