import { useQuery } from "@tanstack/react-query";
import { fetchAnalyticsOutcomes } from "../api/client";
import type { DashboardRange } from "../api/types";
import type { RoleKey } from "../constants/roles";

// useOutcomes — Closed-Admitted + Closed-Lost data in one payload.
// Window-scoped. 5-min cache.
export function useOutcomes(role: RoleKey, range: DashboardRange) {
  return useQuery({
    queryKey: ["executive-analytics", "outcomes", role, range.start, range.end],
    queryFn: async () => {
      const json = await fetchAnalyticsOutcomes({ role, start: range.start, end: range.end });
      if (!json.ok) throw new Error(json.error ?? "outcomes load failed");
      return json;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
