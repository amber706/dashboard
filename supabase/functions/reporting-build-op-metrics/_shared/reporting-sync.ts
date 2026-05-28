// reporting-sync.ts — Shared helpers for Phase 1B sync edge functions.
//
// All writes to `reporting.*` go through RPCs defined in
// supabase/migrations/135_sync_rpcs.sql because PostgREST exposes only
// the `public` schema by default.

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
// Zoho OAuth — cached via public.zoho_token_cache (singleton row).
// ────────────────────────────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number; }
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
  if (_memToken && _memToken.expiresAt > Date.now()) return _memToken.token;
  if (_inFlight) { const tok = await _inFlight; if (tok) return tok; }

  _inFlight = (async (): Promise<string | null> => {
    try {
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
      } catch {}

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
      try {
        await supa().from("zoho_token_cache").upsert(
          { singleton: true, access_token: tok, expires_at: new Date(expiresAt).toISOString(), refreshed_at: new Date().toISOString() },
          { onConflict: "singleton" },
        );
      } catch {}
      return tok;
    } finally { _inFlight = null; }
  })();

  const tok = await _inFlight;
  if (!tok) throw new Error("Zoho token unavailable");
  return tok;
}

// ────────────────────────────────────────────────────────────────────────────
// COQL helpers
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
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ select_query: query }),
  });
  if (res.status === 204) return { rows: [], more_records: false, status_code: 204 };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { rows: [], more_records: false, status_code: res.status, error: txt.slice(0, 500) };
  }
  const j = await res.json();
  return { rows: (j.data ?? []) as T[], more_records: Boolean(j.info?.more_records), status_code: 200 };
}

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

// COQL caps cumulative OFFSET pagination at 10k records, AND a Zoho mass-edit
// can leave thousands of records sharing the same Modified_Time second. So we
// keyset on (Modified_Time, Created_Time) with OFFSET=0 on every page:
//   WHERE Modified_Time > mt
//      OR (Modified_Time = mt AND Created_Time > ct)
//   ORDER BY Modified_Time ASC, Created_Time ASC LIMIT 200
// After each page, cursor advances to the last row's (Modified_Time, Created_Time).
export function toCoqlDatetime(d: Date): string {
  return d.toISOString().slice(0, 19) + "+00:00";
}

export async function coqlKeysetByModifiedTime<
  T extends { id: string; Modified_Time?: string; Created_Time?: string },
>(
  token: string,
  module: string,
  fields: string,
  modifiedSince: Date | null,
  maxRowsTotal = 200_000,
): Promise<{ rows: T[]; truncated: boolean; error?: string }> {
  const PAGE_SIZE = 200;
  const epoch = "1970-01-01T00:00:00+00:00";
  let cursorMt = modifiedSince ? toCoqlDatetime(modifiedSince) : epoch;
  let cursorCt = epoch;
  let firstPage = true;
  const out: T[] = [];

  while (out.length < maxRowsTotal) {
    const where = firstPage
      ? `Modified_Time >= '${cursorMt}'`
      : `(Modified_Time > '${cursorMt}' OR (Modified_Time = '${cursorMt}' AND Created_Time > '${cursorCt}'))`;
    const q = `SELECT ${fields} FROM ${module} WHERE ${where} ORDER BY Modified_Time ASC, Created_Time ASC LIMIT ${PAGE_SIZE}`;
    const r = await coqlOne<T>(token, q);
    if (r.error) return { rows: out, truncated: true, error: r.error };
    if (r.rows.length === 0) return { rows: out, truncated: false };

    for (const row of r.rows) out.push(row);

    const last = r.rows[r.rows.length - 1];
    const lastMt = last.Modified_Time ? toCoqlDatetime(new Date(last.Modified_Time)) : cursorMt;
    const lastCt = last.Created_Time ? toCoqlDatetime(new Date(last.Created_Time)) : epoch;

    if (!firstPage && lastMt === cursorMt && lastCt === cursorCt) {
      return {
        rows: out,
        truncated: true,
        error: `keyset stuck: ${PAGE_SIZE} rows share (Modified_Time=${cursorMt}, Created_Time=${cursorCt})`,
      };
    }
    cursorMt = lastMt;
    cursorCt = lastCt;
    firstPage = false;

    if (r.rows.length < PAGE_SIZE) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}

// ────────────────────────────────────────────────────────────────────────────
// sync_runs lifecycle via RPCs
// ────────────────────────────────────────────────────────────────────────────

export interface SyncRunHandle {
  id: string;
  functionName: string;
  source: string;
  startedAt: Date;
  watermarkUsed: Date | null;
}

export async function startSyncRun(
  functionName: string,
  source: string,
  watermarkOverride: Date | null = null,
): Promise<SyncRunHandle> {
  const { data, error } = await supa().rpc("reporting_start_sync_run", {
    p_function_name: functionName,
    p_source: source,
    p_watermark_override: watermarkOverride?.toISOString() ?? null,
  });
  if (error) throw new Error(`reporting_start_sync_run failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("reporting_start_sync_run returned no row");
  return {
    id: row.id as string,
    functionName,
    source,
    startedAt: new Date(row.started_at as string),
    watermarkUsed: row.watermark_used ? new Date(row.watermark_used as string) : null,
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
  const { error } = await supa().rpc("reporting_finish_sync_run", {
    p_id: handle.id,
    p_status: result.status,
    p_rows_processed: result.rowsProcessed,
    p_rows_failed: result.rowsFailed ?? 0,
    p_error: result.errorMessage ?? null,
  });
  if (error) throw new Error(`reporting_finish_sync_run failed: ${error.message}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Mapping cache via RPC
// ────────────────────────────────────────────────────────────────────────────

export interface Mappings {
  stage: Map<string, string>;
  pipeline: Map<string, string>;
  loc: Map<string, string>;
  sourceCategory: Map<string, string>;
}

export async function loadOwnerMap(): Promise<Map<string, string>> {
  const { data, error } = await supa().rpc("reporting_load_owner_map");
  if (error) throw new Error(`reporting_load_owner_map failed: ${error.message}`);
  const m = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ zoho_user_id: string; user_id: string }>) {
    m.set(row.zoho_user_id, row.user_id);
  }
  return m;
}

export async function loadMappings(): Promise<Mappings> {
  const { data, error } = await supa().rpc("reporting_load_mappings");
  if (error) throw new Error(`reporting_load_mappings failed: ${error.message}`);
  const stage = new Map<string, string>();
  const pipeline = new Map<string, string>();
  const loc = new Map<string, string>();
  const sourceCategory = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ kind: string; raw_value: string; normalized: string }>) {
    if (row.kind === "stage") stage.set(row.raw_value, row.normalized);
    else if (row.kind === "pipeline") pipeline.set(row.raw_value, row.normalized);
    else if (row.kind === "loc") loc.set(row.raw_value, row.normalized);
    else if (row.kind === "source_category") sourceCategory.set(row.raw_value, row.normalized);
  }
  return { stage, pipeline, loc, sourceCategory };
}

// ────────────────────────────────────────────────────────────────────────────
// Raw mirror upsert via RPC
// ────────────────────────────────────────────────────────────────────────────

type RawTable =
  | "raw_zoho_analytics_leads"
  | "raw_zoho_crm_deals"
  | "raw_zoho_crm_users"
  | "raw_zoho_crm_meetings"
  | "raw_ctm_calls";

const RAW_UPSERT_RPC: Record<RawTable, string> = {
  raw_zoho_analytics_leads: "reporting_upsert_raw_zoho_analytics_leads",
  raw_zoho_crm_deals:       "reporting_upsert_raw_zoho_crm_deals",
  raw_zoho_crm_users:       "reporting_upsert_raw_zoho_crm_users",
  raw_zoho_crm_meetings:    "reporting_upsert_raw_zoho_crm_meetings",
  raw_ctm_calls:            "reporting_upsert_raw_ctm_calls",
};

export async function upsertRaw(
  table: RawTable,
  rows: Array<{ source_id: string; source_modified_at: string | null; raw_payload: unknown }>,
  chunkSize = 500,
): Promise<void> {
  if (rows.length === 0) return;
  const fn = RAW_UPSERT_RPC[table];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supa().rpc(fn, { p_rows: slice });
    if (error) throw new Error(`upsertRaw(${table}) chunk ${i} failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// user_identity upsert via RPC
// ────────────────────────────────────────────────────────────────────────────

export async function upsertUserIdentity(
  rows: Array<{
    zoho_user_id: string;
    full_name: string;
    email: string | null;
    profile_name: string | null;
    role_derived: "admissions_rep" | "bd_rep" | "other";
    active: boolean;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supa().rpc("reporting_upsert_user_identity", { p_rows: rows });
  if (error) throw new Error(`reporting_upsert_user_identity failed: ${error.message}`);
  return Number(data ?? rows.length);
}

// ────────────────────────────────────────────────────────────────────────────
// Sync failure logging via RPC
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
  await supa().rpc("reporting_log_sync_failure", {
    p_sync_run_id: args.runHandle.id,
    p_source: args.runHandle.source,
    p_failure_type: args.failureType,
    p_source_id: args.sourceId ?? null,
    p_raw_value: args.rawValue ?? null,
    p_raw_payload: args.rawPayload ?? null,
    p_error: args.errorMessage ?? null,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Profile-to-rep-role + Lead Score Rating helpers (mirror TS constants)
// ────────────────────────────────────────────────────────────────────────────

const ADMISSIONS_REP_PROFILES = new Set([
  "TREATMENT Standard",
  "Administrator",
  "Call Center AHCCCS",
]);
const BD_REP_PROFILE = "Business Development";

export function profileToRepRole(
  profileName: string | null | undefined,
): "admissions_rep" | "bd_rep" | "other" {
  if (!profileName) return "other";
  if (ADMISSIONS_REP_PROFILES.has(profileName)) return "admissions_rep";
  if (profileName === BD_REP_PROFILE) return "bd_rep";
  return "other";
}

export function leadScoreRatingToStarCount(rating: string | null | undefined): number {
  if (!rating) return 0;
  const matches = rating.match(/⭐/g);
  return matches ? matches.length : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP response helpers
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
