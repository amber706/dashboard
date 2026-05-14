// useAnalyticsSummary — TanStack Query hook for the Executive
// Overview tab. Server-computed Health Score + KPIs; the pure
// computeHealthScore lives in lib/healthScore.ts (with the Vitest
// suite) and is mirrored server-side so this hook just receives the
// result.

import { useQuery } from "@tanstack/react-query";
import { fetchAnalyticsSummary } from "../api/client";
import type { AnalyticsSummary, DashboardRange } from "../api/types";
import type { RoleKey } from "../constants/roles";

export function useAnalyticsSummary(role: RoleKey, range: DashboardRange) {
  return useQuery({
    queryKey: ["executive-analytics", "summary", role, range.start, range.end],
    queryFn: async (): Promise<AnalyticsSummary> => {
      const json = await fetchAnalyticsSummary({
        role,
        start: range.start,
        end: range.end,
      });
      if (!json.ok) throw new Error(json.error);
      // Strip the `ok` discriminator so callers get a clean summary.
      // (TypeScript still resolves this correctly because the
      // discriminated union narrows to the success arm here.)
      const { ok: _ok, ...rest } = json;
      return rest as AnalyticsSummary;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
