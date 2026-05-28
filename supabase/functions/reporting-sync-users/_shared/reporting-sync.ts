// reporting-sync.ts — Shared helpers for all Phase 1B sync edge functions.
//
// Each sync function (reporting-sync-users, -deals, -leads, -meetings, -calls)
// uses this module to:
//   1. Get a Zoho OAuth token (cached cross-isolate via public.zoho_token_cache)
//   2. Open a `reporting.sync_runs` row at start, close it at end
//   3. Load mapping tables (stage / pipeline / loc / source_category) into
//      in-memory dicts so per-row normalization is O(1)
//   4. Upsert raw payloads to `reporting.raw_*` tables
//   5. Log unmappable values to `reporting.sync_failures`
//
// The shared module is deliberately thin — each sync function still owns its
// own normalization logic because the per-source shape differs.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ────────────────────────────────────────────────────────────────────────────
// Environment + clients
// ────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const ZOHO_API_DOMAIN =
  Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
export const ZOHO_ACCOUNTS_DOMAIN =
  Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";
export const ZOHO_ANALYTICS_API_DOMAIN =
  Deno.env.get("ZOHO_ANALYTICS_API_DOMAIN") ?? "https://analyticsapi.zoho.com";

let _supa: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (_supa) return _supa;
  _supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supa;
}

// ────────────────────────────────────────────────────────────────────────────
// Zoho OAuth — single token cached across edge function isolates via the
// existing public.zoho_token_cache table (singleton row). Reuses the
// CRM credentials whose scope was widened in CONFIRMED.md #18 to include
// ZohoAnalytics.data.READ + ZohoAnalytics.metadata.READ.
// ────────────────────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let _memToken: CachedToken | null = null;
let _inFlight: Promise<string | null> | null = null;
let _nextRefreshAllowed = 0;

export async function getZohoToken(): Promise<string> {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refreshToken = Deno.env.get("ZOHO_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN must be set");
  }

  // In-process cache
  if (_memToken && _memToken.expiresAt > Date.now()) return _memToken.token;

  // Coalesce concurrent calls
  if (_inFlight) {
    const tok = await _inFlight;
    if (tok) return tok;
  }

  _inFlight = (async (): Promise<string | null> => {
    try {
      // Persistent cache (singleton row in public.zoho_token_cache)
      try {
        const { data } = await supa()
          .from("zoho_token_cache")
          .select("access_token, expires_at")
          .eq("singleton", true)
          .maybeSingle();
        if (data) {
          const expiresAt = new Date(data.expires_at).getTime();
          if (expiresAt > Date.now()) {
            _memToken = { token: data.access_token, expiresAt };
            return data.access_token;
          }
        }
      } catch {
        // Cache miss is fine; fall through to refresh.
      }

      if (Date.now() < _nextRefreshAllowed && _memToken) return _memToken.token;

      const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      });
      const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        _nextRefreshAllowed = Date.now() + 60_000;
        if (_memToken) return _memToken.token;
        throw new Error(`Zoho OAuth refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      const j = await res.json();
      const tok = j.access_token as string;
      if (!tok) throw new Error("Zoho OAuth response missing access_token");
      const expiresAt = Date.now() + Math.max(60_000, ((j.expires_in ?? 3600) - 300) * 1000);
      _memToken = { token: tok, expiresAt };

      // Update persistent cache
      try {
        await supa()
          .from("zoho_token_cache")
          .upsert(
            {
              singleton: true,
              access_token: tok,
              expires_at: new Date(expiresAt).toISOString(),
              refreshed_at: new Date().toISOString(),
            },
            { onConflict: "singleton" },
          );
      } catch {
        // Persistent cache write failures are non-fatal — in-process cache still works.
      }

      return tok;
    } finally {
      _inFlight = null;
    }
  })();

  const tok = await _inFlight;
  if (!tok) throw new Error("Zoho token unavailable");
  return tok;
}

// ────────────────────────────────────────────────────────────────────────────
// COQL helpers — Zoho CRM SQL-like query API. 200 rows max per page.
// ────────────────────────────────────────────────────────────────────────────

export interface CoqlResult<T = Record<string, unknown>> {
  rows: T[];
  more_records: boolean;
  status_code: number;
  error?: string;
}

export async function coqlOne<T = Record<string, unknown>>(
  token: string,
  query: string,
): Promise<CoqlResult<T>> {
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/coql`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ select_query: query }),
  });
  if (res.status === 204) return { rows: [], more_records: false, status_code: 204 };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { rows: [], more_records: false, status_code: res.status, error: txt.slice(0, 500) };
  }
  const j = await res.json();
  return {
    rows: (j.data ?? []) as T[],
    more_records: Boolean(j.info?.more_records),
    status_code: 200,
  };
}

/** Iterate COQL pages until exhausted (or maxPages safety cap hit). */
export async function coqlAll<T = Record<string, unknown>>(
  token: string,
  builder: (offset: number) => string,
  maxPages = 100,
): Promise<{ rows: T[]; truncated: boolean; error?: string }> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * 200;
    const r = await coqlOne<T>(token, builder(offset));
    if (r.error) return { rows: out, truncated: true, error: r.error };
    out.push(...r.rows);
    if (r.rows.length < 200 || !r.more_records) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}

// ────────────────────────────────────────────────────────────────────────────
// sync_runs lifecycle
// ────────────────────────────────────────────────────────────────────────────

export interface SyncRunHandle {
  id: string;
  functionName: string;
  source: string;
  startedAt: Date;
  watermarkUsed: Date | null;
}

/**
 * Open a sync_runs row. `watermarkOverride` lets the caller force a full
 * refresh; otherwise we read the previous run's `finished_at` minus a
 * 10-minute safety overlap.
 */
export async function startSyncRun(
  functionName: string,
  source: string,
  watermarkOverride: Date | null = null,
): Promise<SyncRunHandle> {
  let watermark: Date | null = watermarkOverride;

  if (!watermark) {
    const { data } = await supa()
      .schema("reporting")
      .from("sync_runs")
      .select("finished_at")
      .eq("function_name", functionName)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.finished_at) {
      const prev = new Date(data.finished_at);
      // Pull a 10-minute overlap to catch edits that happened during the
      // previous run's window.
      watermark = new Date(prev.getTime() - 10 * 60 * 1000);
    }
  }

  const { data, error } = await supa()
    .schema("reporting")
    .from("sync_runs")
    .insert({
      function_name: functionName,
      source,
      status: "running",
      watermark_used: watermark?.toISOString() ?? null,
    })
    .select("id, started_at")
    .single();

  if (error || !data) throw new Error(`Failed to open sync_run: ${error?.message}`);

  return {
    id: data.id,
    functionName,
    source,
    startedAt: new Date(data.started_at),
    watermarkUsed: watermark,
  };
}

export async function finishSyncRun(
  handle: SyncRunHandle,
  result: {
    status: "success" | "failure" | "partial";
    rowsProcessed: number;
    rowsFailed?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await supa()
    .schema("reporting")
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      rows_processed: result.rowsProcessed,
      rows_failed: result.rowsFailed ?? 0,
      status: result.status,
      error_message: result.errorMessage ?? null,
    })
    .eq("id", handle.id);
}

// ────────────────────────────────────────────────────────────────────────────
// Mapping caches
// ────────────────────────────────────────────────────────────────────────────

export interface Mappings {
  stage: Map<string, string>;
  pipeline: Map<string, string>;
  loc: Map<string, string>;
  sourceCategory: Map<string, string>;
}

export async function loadMappings(): Promise<Mappings> {
  const [stage, pipeline, loc, sourceCategory] = await Promise.all([
    supa().schema("reporting").from("stage_mapping").select("raw_value, normalized_value"),
    supa().schema("reporting").from("pipeline_mapping").select("raw_value, normalized_value"),
    supa().schema("reporting").from("loc_mapping").select("raw_value, normalized_value"),
    supa().schema("reporting").from("source_category_mapping").select("raw_value, normalized_value"),
  ]);

  const toMap = (rows: { data: { raw_value: string; normalized_value: string }[] | null }) => {
    const m = new Map<string, string>();
    for (const r of rows.data ?? []) m.set(r.raw_value, r.normalized_value);
    return m;
  };

  return {
    stage: toMap(stage),
    pipeline: toMap(pipeline),
    loc: toMap(loc),
    sourceCategory: toMap(sourceCategory),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Sync failures logging
// ────────────────────────────────────────────────────────────────────────────

export type SyncFailureType =
  | "unmapped_stage"
  | "unmapped_source_category"
  | "unmapped_loc"
  | "unmapped_pipeline"
  | "unmapped_insurance_type"
  | "orphan_deal"
  | "orphan_call"
  | "schema_mismatch"
  | "normalization_error";

export async function logSyncFailure(args: {
  runHandle: SyncRunHandle;
  failureType: SyncFailureType;
  sourceId?: string | null;
  rawValue?: string | null;
  rawPayload?: unknown;
  errorMessage?: string;
}): Promise<void> {
  await supa()
    .schema("reporting")
    .from("sync_failures")
    .insert({
      sync_run_id: args.runHandle.id,
      source: args.runHandle.source,
      source_id: args.sourceId ?? null,
      failure_type: args.failureType,
      raw_value: args.rawValue ?? null,
      raw_payload: args.rawPayload ?? null,
      error_message: args.errorMessage ?? null,
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Raw mirror upsert
// ────────────────────────────────────────────────────────────────────────────

export async function upsertRaw(
  table:
    | "raw_zoho_analytics_leads"
    | "raw_zoho_crm_deals"
    | "raw_zoho_crm_users"
    | "raw_zoho_crm_meetings"
    | "raw_ctm_calls",
  rows: Array<{
    source_id: string;
    source_modified_at: string | null;
    raw_payload: unknown;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  // Chunk to keep payload sane
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supa()
      .schema("reporting")
      .from(table)
      .upsert(slice, { onConflict: "source_id" });
    if (error) throw new Error(`upsertRaw(${table}) failed at chunk ${i}: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Profile-to-rep-role mapping (mirrors src/lib/metrics/definitions.ts)
// ────────────────────────────────────────────────────────────────────────────

const ADMISSIONS_REP_PROFILES = new Set([
  "TREATMENT Standard",
  "Administrator",
  "Call Center AHCCCS",
]);
const BD_REP_PROFILE = "Business Development";

export function profileToRepRole(profileName: string | null | undefined): "admissions_rep" | "bd_rep" | "other" {
  if (!profileName) return "other";
  if (ADMISSIONS_REP_PROFILES.has(profileName)) return "admissions_rep";
  if (profileName === BD_REP_PROFILE) return "bd_rep";
  return "other";
}

// ────────────────────────────────────────────────────────────────────────────
// Lead Score Rating → star count (mirrors src/lib/metrics/definitions.ts)
// ────────────────────────────────────────────────────────────────────────────

export function leadScoreRatingToStarCount(rating: string | null | undefined): number {
  if (!rating) return 0;
  const matches = rating.match(/⭐/g);
  return matches ? matches.length : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Standard HTTP response helpers
// ────────────────────────────────────────────────────────────────────────────

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}
