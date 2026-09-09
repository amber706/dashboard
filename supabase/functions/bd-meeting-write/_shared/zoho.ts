// Shared Zoho helpers — token acquisition + COQL pagination.
//
// Two-tier access-token cache:
//
//   1. In-memory (this isolate)            — instant, lasts as long as
//                                            the isolate stays warm.
//   2. DB-backed (public.zoho_token_cache) — single row shared across
//                                            every Deno isolate in the
//                                            project. Survives cold
//                                            starts and deploys.
//
// Why two tiers: Supabase Edge Functions cold-start frequently. With
// only an in-memory cache, every cold isolate has to refresh the token
// independently, and Zoho's /oauth/v2/token endpoint rate-limits per
// refresh token. With the DB cache, the FIRST isolate to refresh writes
// the token; every subsequent isolate reads it and skips the refresh.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID");
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET");
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN");
const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
const ZOHO_ACCOUNTS_DOMAIN = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
let _supaCacheClient: ReturnType<typeof createClient> | null = null;
function supaCacheClient() {
  if (_supaCacheClient) return _supaCacheClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  _supaCacheClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return _supaCacheClient;
}

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null;
let inFlight: Promise<string | null> | null = null;
// When a refresh fails, hold off retrying for this many ms — protects
// against hammering Zoho once we've already tripped the rate limit.
const REFRESH_BACKOFF_MS = 60_000;
let nextRefreshAllowed = 0;

// Detects Zoho's "rate-limited" responses: HTTP 429, or HTTP 400 whose
// body carries "too many requests" + "Access Denied" (how
// /oauth/v2/token signals the per-refresh-token quota).
function looksRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status === 400 && /too many requests/i.test(body) && /access[_ ]denied/i.test(body)) return true;
  return false;
}

// Diagnostic: why did the most recent token attempt fail? Surfaced in
// edge-function error responses so we can tell apart "missing env vars"
// from "rate-limited" from "Zoho returned 5xx".
let lastFailureReason: string | null = null;
export function getLastZohoFailureReason(): string | null {
  return lastFailureReason;
}

export async function getZohoToken(): Promise<string | null> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    const missing = [
      !ZOHO_CLIENT_ID && "ZOHO_CLIENT_ID",
      !ZOHO_CLIENT_SECRET && "ZOHO_CLIENT_SECRET",
      !ZOHO_REFRESH_TOKEN && "ZOHO_REFRESH_TOKEN",
    ].filter(Boolean).join(", ");
    lastFailureReason = `missing env vars: ${missing}`;
    console.error(`[zoho] ${lastFailureReason}`);
    return null;
  }

  // Tier 1 — in-memory cache. Instant, never crosses the network.
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  // Coalesce concurrent refresh attempts within this isolate. The DB
  // tier handles cross-isolate coalescing.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // Tier 2 — DB cache. Read first; another isolate may have already
      // refreshed and we can skip the network call entirely.
      const fromDb = await readDbToken();
      if (fromDb && fromDb.expiresAt > Date.now()) {
        cachedToken = fromDb;
        lastFailureReason = null;
        return fromDb.token;
      }

      // Honor the in-memory backoff so we don't slam Zoho after a
      // recent failure.
      if (Date.now() < nextRefreshAllowed && cachedToken) {
        return cachedToken.token;
      }

      return await refreshFromZoho();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Read the current Zoho token row from public.zoho_token_cache. Returns
// null on any read failure so the caller falls through to a refresh.
async function readDbToken(): Promise<CachedToken | null> {
  const supa = supaCacheClient();
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from("zoho_token_cache")
      .select("access_token, expires_at")
      .eq("singleton", true)
      .maybeSingle();
    if (error || !data) return null;
    return {
      token: data.access_token as string,
      expiresAt: new Date(data.expires_at as string).getTime(),
    };
  } catch {
    return null;
  }
}

async function writeDbToken(token: string, expiresAt: number): Promise<void> {
  const supa = supaCacheClient();
  if (!supa) return;
  try {
    await supa.from("zoho_token_cache").upsert({
      singleton: true,
      access_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      refreshed_at: new Date().toISOString(),
    }, { onConflict: "singleton" });
  } catch {
    // Best-effort: the in-memory cache still serves this isolate.
  }
}

async function refreshFromZoho(): Promise<string | null> {
  const body = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN!,
    client_id: ZOHO_CLIENT_ID!,
    client_secret: ZOHO_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });

  const attemptRefresh = async (): Promise<Response> => {
    return await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  };

  let res: Response;
  try {
    res = await attemptRefresh();
  } catch (e) {
    lastFailureReason = `fetch error (initial): ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[zoho] ${lastFailureReason}`);
    nextRefreshAllowed = Date.now() + REFRESH_BACKOFF_MS;
    return cachedToken?.token ?? null;
  }

  // Read the body once so both rate-limit detection and error reporting
  // see the same content.
  const initialBody = await res.text().catch(() => "");

  if (looksRateLimited(res.status, initialBody)) {
    // Sleep with jitter, then retry once. Before retrying, peek at the
    // DB cache — a sibling isolate may have refreshed while we slept.
    const jitter = 1000 + Math.floor(Math.random() * 3000);
    await new Promise((r) => setTimeout(r, 4000 + jitter));

    const fromDb = await readDbToken();
    if (fromDb && fromDb.expiresAt > Date.now()) {
      cachedToken = fromDb;
      lastFailureReason = null;
      return fromDb.token;
    }

    try {
      res = await attemptRefresh();
    } catch (e) {
      lastFailureReason = `fetch error (retry): ${e instanceof Error ? e.message : String(e)}`;
      console.error(`[zoho] ${lastFailureReason}`);
      nextRefreshAllowed = Date.now() + REFRESH_BACKOFF_MS;
      return cachedToken?.token ?? null;
    }
  }

  if (!res.ok) {
    const text = res.bodyUsed ? "" : await res.text().catch(() => "");
    lastFailureReason = `oauth ${res.status}: ${(text || initialBody).slice(0, 200)}`;
    console.error(`[zoho] ${lastFailureReason}`);
    nextRefreshAllowed = Date.now() + REFRESH_BACKOFF_MS;
    return cachedToken?.token ?? null;
  }

  let parsed: any = null;
  try {
    parsed = res.bodyUsed ? JSON.parse(initialBody) : await res.json();
  } catch (e) {
    lastFailureReason = `oauth json parse error: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[zoho] ${lastFailureReason}`);
    nextRefreshAllowed = Date.now() + REFRESH_BACKOFF_MS;
    return cachedToken?.token ?? null;
  }

  const tok = (parsed?.access_token as string) ?? null;
  if (!tok) {
    lastFailureReason = `oauth response missing access_token; body: ${JSON.stringify(parsed).slice(0, 200)}`;
    console.error(`[zoho] ${lastFailureReason}`);
    nextRefreshAllowed = Date.now() + REFRESH_BACKOFF_MS;
    return cachedToken?.token ?? null;
  }

  lastFailureReason = null;
  // Zoho returns expires_in (sec). Default to 3600 if missing; cache for
  // 55min to leave a 5min safety margin under the real expiry.
  const expiresInSec = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  const safeTtlMs = Math.max(60_000, (expiresInSec - 300) * 1000);
  const expiresAt = Date.now() + safeTtlMs;

  cachedToken = { token: tok, expiresAt };
  nextRefreshAllowed = 0;

  await writeDbToken(tok, expiresAt);

  return tok;
}

export interface CoqlPage {
  rows: any[];
  more_records: boolean;
  status_code: number;
  error?: string;
}

export async function coqlOne(token: string, query: string): Promise<CoqlPage> {
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
    return { rows: [], more_records: false, status_code: res.status, error: txt.slice(0, 300) };
  }
  const j = await res.json();
  return {
    rows: (j.data ?? []) as any[],
    more_records: Boolean(j.info?.more_records),
    status_code: 200,
  };
}

/**
 * Paginate a COQL query that returns up to 200 rows/page until exhausted
 * or until `maxPages` is hit. Caller passes a `selectBuilder(offset)`
 * because COQL needs LIMIT/OFFSET in the query string itself.
 */
export async function coqlAll(
  token: string,
  selectBuilder: (offset: number) => string,
  maxPages = 50,
): Promise<{ rows: any[]; truncated: boolean; error?: string }> {
  const out: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * 200;
    const result = await coqlOne(token, selectBuilder(offset));
    if (result.error) return { rows: out, truncated: true, error: result.error };
    out.push(...result.rows);
    if (result.rows.length < 200 || !result.more_records) {
      return { rows: out, truncated: false };
    }
  }
  return { rows: out, truncated: true };
}
