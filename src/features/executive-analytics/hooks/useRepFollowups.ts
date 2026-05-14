// useRepFollowups — Claude-backed per-rep follow-up suggestions.
// Manual fire (not on tab open) so Anthropic costs stay predictable.
// One mutation call returns the full team payload.

import { useMutation } from "@tanstack/react-query";
import {
  fetchAnalyticsRepFollowups,
  type RepFollowup,
  type RepFollowupsRequest,
} from "../api/client";

export interface RepFollowupsResult {
  byRep: Record<string, { followups: RepFollowup[] }>;
  generatedAt: string;
}

export function useRepFollowups() {
  return useMutation<RepFollowupsResult, Error, RepFollowupsRequest>({
    mutationFn: async (args: RepFollowupsRequest) => {
      const json = await fetchAnalyticsRepFollowups(args);
      if (!json.ok) throw new Error(json.error);
      return { byRep: json.byRep, generatedAt: json.generatedAt };
    },
  });
}
