// client.ts — typed wrappers around the executive-analytics-* edge
// functions. Every component talks to Supabase through these (never
// raw fetch); TanStack Query hooks compose on top.

import { supabase } from "@/lib/supabase";
import type {
  AnalyticsRequestBase,
  AnalyticsSummaryResponse,
} from "./types";

async function authToken(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

async function invoke<TResp>(fn: string, body: unknown): Promise<TResp> {
  const token = await authToken();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as TResp;
}

export function fetchAnalyticsSummary(args: AnalyticsRequestBase): Promise<AnalyticsSummaryResponse> {
  return invoke<AnalyticsSummaryResponse>("executive-analytics-summary", args);
}

// Pipeline + Stage Movement (consolidated function).
export function fetchAnalyticsPipeline(args: { role: string }): Promise<any> {
  return invoke<any>("executive-analytics-pipeline", args);
}

// Closed-Admitted + Closed-Lost (consolidated function).
export function fetchAnalyticsOutcomes(args: AnalyticsRequestBase): Promise<any> {
  return invoke<any>("executive-analytics-outcomes", args);
}

export function fetchAnalyticsRep(args: AnalyticsRequestBase): Promise<any> {
  return invoke<any>("executive-analytics-rep", args);
}

export interface InsightsRequest {
  role: string;
  range: { start: string; end: string; label?: string };
  summary: unknown;
  pipeline?: unknown;
  outcomes?: unknown;
  rep?: unknown;
}

export interface AnalyticsInsight {
  area: string;
  severity: "critical" | "warning" | "info";
  observation: string;
  action: string;
}

export interface AnalyticsInsightsResponse {
  ok: true;
  insights: AnalyticsInsight[];
  generatedAt: string;
  model: string;
}

export function fetchAnalyticsInsights(args: InsightsRequest): Promise<AnalyticsInsightsResponse | { ok: false; error: string }> {
  return invoke("executive-analytics-insights", args);
}
