// useAnalyticsInsights — Claude-backed prescriptive insights for the
// Executive Overview tab. Fires manually (not on tab open) to keep
// per-load Anthropic costs predictable. Returns 3-5 ranked insights.

import { useMutation } from "@tanstack/react-query";
import {
  fetchAnalyticsInsights,
  type AnalyticsInsight,
  type InsightsRequest,
} from "../api/client";

export interface AnalyticsInsightsResult {
  insights: AnalyticsInsight[];
  generatedAt: string;
}

export function useAnalyticsInsights() {
  return useMutation<AnalyticsInsightsResult, Error, InsightsRequest>({
    mutationFn: async (args: InsightsRequest) => {
      const json = await fetchAnalyticsInsights(args);
      if (!json.ok) throw new Error(json.error);
      return { insights: json.insights, generatedAt: json.generatedAt };
    },
  });
}
