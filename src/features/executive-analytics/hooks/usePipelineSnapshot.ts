import { useQuery } from "@tanstack/react-query";
import { fetchAnalyticsPipeline } from "../api/client";
import type { RoleKey } from "../constants/roles";

// usePipelineSnapshot — Live Pipeline + Stage Movement data. No date
// range parameter; the function returns stock-metric snapshots
// (current active deals, today-relative movement). staleTime: 30s.
export function usePipelineSnapshot(role: RoleKey) {
  return useQuery({
    queryKey: ["executive-analytics", "pipeline", role],
    queryFn: async () => {
      const json = await fetchAnalyticsPipeline({ role });
      if (!json.ok) throw new Error(json.error ?? "pipeline load failed");
      return json;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
