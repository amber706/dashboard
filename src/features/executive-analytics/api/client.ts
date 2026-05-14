// client.ts — typed wrappers around the four executive-analytics-*
// edge functions. Every component talks to Supabase through these
// (never raw fetch), and TanStack Query hooks compose on top.

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

export function fetchAnalyticsSummary(
  args: AnalyticsRequestBase,
): Promise<AnalyticsSummaryResponse> {
  return invoke<AnalyticsSummaryResponse>("executive-analytics-summary", args);
}
