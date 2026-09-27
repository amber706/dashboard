// push-google-conversions v40 — v39 plus Zoho-outage resilience.
// CHANGES from v39:
//   - If the Zoho OAuth token is unavailable (expired/revoked refresh token), no longer 502-bail the
//     whole run. Skip the Zoho-sourced paths (VOB/admit/leads/DUI-deals/backstop + Zoho writeback) but
//     STILL push the CTM-sourced conversions (commercial/AHCCCS/DUI calls — no Zoho needed). Response
//     exposes zoho_token_ok. (A Zoho blip was silently blocking all CTM conversions.)
// CHANGES from v38:
//   - DUI-routed 4/5★ calls (DUI Queue / IVR-DUI, not commercial-routed) were being EXCLUDED; they
//     now push to the new "CTM DUI 4's + 5's" action (7712840837) via event_type dui_ctm_45, value 1,
//     idempotency stamp call_score.ctm_45_dui_pushed_at. Star fetch now filters BOTH stamps null and
//     routes by queue: DUI → dui_ctm_45, else → commercial_ctm_45. Removed the old dui-excluded stamp.
//     (Requires conversion_push_log event_type CHECK to include 'dui_ctm_45'.)
// CHANGES from v37:
//   - GA_API_VERSION default bumped v21 → v24 (v21 now returns UNSUPPORTED_VERSION / blocked).
//     Same deprecation treadmill as v20→v21; v24 has runway to ~May 2027. Stale v20/v21 secret pins
//     are ignored. (Diagnostics google-ads-* bumped to v24 too.)
// CHANGES from v37:
//   - DUI Closed-Won (dui_closed_won) now fires for ANY DUI-Cash deal at "Scheduled Payment or
//     further" — implemented as all DUI stages EXCEPT the dead ones (Stuck Lead, Closed - Lost x2).
//     Previously only Probability = 100 (the three Closed - stages). Broadens what feeds the
//     "DUI - Closed Won - LIVE" action (a PRIMARY action → affects Smart Bidding). Fires once per
//     deal (Conversion_Event_Sent_to_Google idempotency), at the first qualifying stage.
// CHANGES from v35:
//   - Zoho Commercial-Cash backstop was sending recovered gclids (phone-matched) dated at
//     Deal.Created_Time, which is often BEFORE the click → Google rejected with
//     CONVERSION_PRECEDES_EVENT (~207 rejects). Now: for a RECOVERED gclid, date the conversion at
//     the source CTM call's received_at (a guaranteed >= click time, via gclidToCallTime map); if the
//     gclid can't be traced to a call, drop it and rely on hashed identifiers. Genuine first-party
//     gclids and the CTM-call path are unchanged (they were already correctly time-aligned).
// CHANGES from v34:
//   - CTM commercial push re-pointed from "Commercial Qualified - LIVE" (7617006198) to the new
//     "CTM 4's + 5's (Commercial Insurance)" action (7661904455), value 1, via new event type
//     commercial_ctm_45 and new idempotency column call_score.ctm_45_commercial_pushed_at.
//   - Routing is now QUEUE-based from ctm_call.raw_payload.call_path (the dui/commercial TAGS are
//     unreliable): DUI-routed = CallQueue "DUI Queue 2025" OR VoiceMenuItem "Main Admissions IVR:2";
//     commercial-routed = CallQueue "Treatment Reps - Commercial". A 4/5★ call is pushed unless it is
//     DUI-routed AND not commercial-routed (those stay with CTM's native DUI conversions).
//   - Second pass fetchZohoCommercialBackstopEvents(): Zoho Deals in Pipeline 'Commercial-Cash' within
//     90d that were NOT covered by the CTM pass (deduped by phone last-10 / email vs CTM-pushed calls)
//     also fire commercial_ctm45_zoho → 7661904455. Idempotency via conversion_push_log (no Zoho field,
//     so it can't collide with the Admit push's Conversion_Event_Sent_to_Google).
//   - AHCCCS medicaid-3★ and all Zoho lead/VOB/admit/DUI paths unchanged.
// CHANGES from v33:
//   - GA_API_VERSION: v20 is deprecated/sunset (June 2026) and now returns UNSUPPORTED_VERSION
//     ("Version v20 is deprecated. Requests to this version will be blocked."). Force v21 even
//     when the GOOGLE_ADS_API_VERSION secret is unset OR still pinned to "v20". An explicit
//     override to v22+ via the secret is still honored.
//   - clampNotFuture(): Google rejects conversions dated in the future (LATER_THAN_MAXIMUM_DATE).
//     Some DUI Screening_Closed_Date/Course_Closed_Date values are future-scheduled, which was
//     failing ~all DUI Closed/Won uploads. conversion_date_time is now capped at "now".
//   NOTE: uploadClickConversions itself is on Google's deprecation path (migration to the
//     Data Manager API required before it is fully sunset) — tracked separately.
// CHANGES from v32:
//   - DUI Closed/Won conversion_date_time fallback chain swapped from:
//         Closing_Date → Created_Time
//     to: Screening_Closed_Date → Course_Closed_Date → Closing_Date → Created_Time
//   - Rationale: Screening_Closed_Date is populated ~95% of the time on DUI deals,
//     Course_Closed_Date ~50%, Closing_Date only ~30%. Using Closing_Date as primary
//     left the conversion timestamp falling back to Created_Time (lead creation) on
//     ~70% of DUI events, which can break the click→event 90-day window.
// CHANGES from v30:
//   - CTM call leads: conversion_date_time = ctm_call.received_at (when call hit CTM)
//   - Zoho leads:     conversion_date_time = Lead.Created_Time
//   - VOB events:     conversion_date_time = VOB_Submitted_Date (fallback Deal.Created_Time)
//   - Admit events:   conversion_date_time = Closing_Date         (fallback Deal.Created_Time)
//   - DUI Closed/Won: conversion_date_time = Closing_Date         (fallback Deal.Created_Time)
//   Previously all downstream events used Deal.Modified_Time, which gets bumped by
//   every later edit (including our own writebacks), causing Google EXPIRED_EVENT
//   rejections even when the actual conversion happened within the 90-day click window.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-max-age": "86400" };
function handleCorsPreflight(req: Request): Response | null { if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders }); return null; }
function firstVal(...names: string[]): string | undefined { for (const n of names) { const v = Deno.env.get(n); if (typeof v === "string" && v.length > 0) return v; } return undefined; }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CTM_BOT_SUPABASE_URL = Deno.env.get("CTM_BOT_SUPABASE_URL") ?? "https://fbfhjugvurcqcfaeqpnr.supabase.co";
const CTM_BOT_SERVICE_ROLE_KEY = Deno.env.get("CTM_BOT_SERVICE_ROLE_KEY");

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID");
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET");
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN");
const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
const ZOHO_ACCOUNTS_DOMAIN = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";

const GA_DEVELOPER_TOKEN = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
const GA_OAUTH_CLIENT_ID = firstVal("GOOGLE_ADS_OAUTH_CLIENT_ID", "GOOGLE_ADS_CLIENT_ID");
const GA_OAUTH_CLIENT_SECRET = firstVal("GOOGLE_ADS_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_CLIENT_SECRET");
const GA_OAUTH_REFRESH_TOKEN = firstVal("GOOGLE_ADS_OAUTH_REFRESH_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN");
const GA_LOGIN_CUSTOMER_ID = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
// v34: v20 is sunset and rejected with UNSUPPORTED_VERSION. Force v21 unless explicitly
// overridden to a newer version via the secret; ignore a stale "v20" pin.
const _GA_API_VERSION_ENV = Deno.env.get("GOOGLE_ADS_API_VERSION");
// v20 and v21 are sunset (v21 blocked as of Aug 2026). Default to v24 (current; runway to ~May 2027);
// honor the secret only if it points to a newer, non-deprecated version.
const GA_API_VERSION = (_GA_API_VERSION_ENV && !["v20", "v21"].includes(_GA_API_VERSION_ENV)) ? _GA_API_VERSION_ENV : "v24";

const GA_CUSTOMER_ID         = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID")         ?? "2411668339";
const CA_COMMERCIAL_VOB      = Deno.env.get("GOOGLE_ADS_CA_COMMERCIAL_VOB")    ?? "6883163691";
const CA_COMMERCIAL_ADMIT    = Deno.env.get("GOOGLE_ADS_CA_COMMERCIAL_ADMIT")  ?? "6881809141";
const CA_AHCCCS_LEAD         = Deno.env.get("GOOGLE_ADS_CA_AHCCCS_LEAD")       ?? "6869778693";
const CA_AHCCCS_ADMIT        = Deno.env.get("GOOGLE_ADS_CA_AHCCCS_ADMIT")      ?? "6883765602";
const CA_COMMERCIAL_LEAD     = Deno.env.get("GOOGLE_ADS_CA_COMMERCIAL_LEAD")   ?? "7617006198";
const CA_AHCCCS_VOB          = Deno.env.get("GOOGLE_ADS_CA_AHCCCS_VOB")        ?? "7617006195";
const CA_DUI_CLOSED_WON      = Deno.env.get("GOOGLE_ADS_CA_DUI_CLOSED_WON")    ?? "6882368393";
const CA_CTM_COMMERCIAL_45   = Deno.env.get("GOOGLE_ADS_CA_CTM_COMMERCIAL_45") ?? "7661904455";
const CA_CTM_DUI_45          = Deno.env.get("GOOGLE_ADS_CA_CTM_DUI_45")        ?? "7712840837";

const VAL_COMMERCIAL_VOB    = Number(Deno.env.get("GOOGLE_ADS_VAL_COMMERCIAL_VOB_USD")    ?? "200");
const VAL_COMMERCIAL_LEAD   = Number(Deno.env.get("GOOGLE_ADS_VAL_COMMERCIAL_LEAD_USD")   ?? "50");
const VAL_COMMERCIAL_ADMIT  = Number(Deno.env.get("GOOGLE_ADS_VAL_COMMERCIAL_ADMIT_USD")  ?? "2000");
const VAL_AHCCCS_VOB        = Number(Deno.env.get("GOOGLE_ADS_VAL_AHCCCS_VOB_USD")        ?? "50");
const VAL_AHCCCS_LEAD       = Number(Deno.env.get("GOOGLE_ADS_VAL_AHCCCS_LEAD_USD")       ?? "50");
const VAL_AHCCCS_ADMIT      = Number(Deno.env.get("GOOGLE_ADS_VAL_AHCCCS_ADMIT_USD")      ?? "2000");
const VAL_DUI_CLOSED_WON    = Number(Deno.env.get("GOOGLE_ADS_VAL_DUI_CLOSED_WON_USD")    ?? "1000");
const VAL_CTM_COMMERCIAL_45 = Number(Deno.env.get("GOOGLE_ADS_VAL_CTM_COMMERCIAL_45_USD") ?? "1");
const VAL_CTM_DUI_45        = Number(Deno.env.get("GOOGLE_ADS_VAL_CTM_DUI_45_USD")        ?? "1");

const MAX_DEAL_AGE_DAYS = Number(Deno.env.get("GOOGLE_ADS_MAX_DEAL_AGE_DAYS") ?? "90");
const GA_DRY_RUN_ENV = (Deno.env.get("GOOGLE_ADS_DRY_RUN") ?? "true").toLowerCase() !== "false";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const PERMANENT_ERROR_CODES = new Set(["EXPIRED_EVENT", "UNPARSEABLE_GCLID", "CONVERSION_PRECEDES_EVENT", "CLICK_MISSING_CONVERSION_LABEL", "FUTURE_CONVERSION_TIME", "INVALID_CONVERSION_TYPE", "TOO_RECENT_CLICK", "CONVERSION_PRECEDES_CLICK", "EXPIRED_CLICK"]);

const LEAD_RATING_3STAR = "⭐⭐⭐ Seeking Treatment: Medicaid";
const LEAD_RATING_4STAR = "⭐⭐⭐⭐ Seeking Treatment: Commercial, Not Ready to Make a Decision";
const LEAD_RATING_5STAR = "⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, Ready to Make a Decision";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ctmBot = CTM_BOT_SERVICE_ROLE_KEY ? createClient(CTM_BOT_SUPABASE_URL, CTM_BOT_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders } }); }
async function sha256Hex(s: string): Promise<string> { const buf = new TextEncoder().encode(s); const digest = await crypto.subtle.digest("SHA-256", buf); return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join(""); }
function normalizeEmail(email: string | null): string | null { if (!email) return null; const t = email.trim().toLowerCase(); return t.includes("@") ? t : null; }
function normalizePhoneE164(phone: string | null): string | null { if (!phone) return null; const digits = phone.replace(/\D/g, ""); if (digits.length === 10) return `+1${digits}`; if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`; if (phone.startsWith("+")) return phone; return digits.length >= 10 ? `+${digits}` : null; }
function normalizeNamePart(s: string | null): string | null { if (!s) return null; const t = s.trim().toLowerCase().replace(/[^a-z]/g, ""); return t.length > 0 ? t : null; }
function normalizePostal(s: string | null): string | null { if (!s) return null; const t = s.trim(); if (t.length === 0) return null; const us5 = t.replace(/\D/g, "").slice(0, 5); return us5.length === 5 ? us5 : t; }
function normalizeStateAbbrev(s: string | null): string | null { if (!s) return null; const t = s.trim(); if (t.length === 2) return t.toUpperCase(); const map: Record<string, string> = { arizona: "AZ", california: "CA", nevada: "NV", colorado: "CO", utah: "UT", "new mexico": "NM", texas: "TX", oregon: "OR", washington: "WA", idaho: "ID" }; return map[t.toLowerCase()] ?? null; }
async function buildUserIdentifiers(identifiers: { email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null; postal_code?: string | null; city?: string | null; state?: string | null; }): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  const e = normalizeEmail(identifiers.email ?? null);
  if (e) out.push({ hashed_email: await sha256Hex(e) });
  const p = normalizePhoneE164(identifiers.phone ?? null);
  if (p) out.push({ hashed_phone_number: await sha256Hex(p) });
  const fn = normalizeNamePart(identifiers.first_name ?? null);
  const ln = normalizeNamePart(identifiers.last_name ?? null);
  const zip = normalizePostal(identifiers.postal_code ?? null);
  const city = identifiers.city?.trim() || null;
  const state = normalizeStateAbbrev(identifiers.state ?? null);
  if (fn && ln && (zip || (city && state))) {
    const addr: Record<string, any> = { hashed_first_name: await sha256Hex(fn), hashed_last_name: await sha256Hex(ln), country_code: "US" };
    if (zip) addr.postal_code = zip;
    if (city) addr.city = city;
    if (state) addr.state = state;
    out.push({ address_info: addr });
  }
  return out;
}
function toGaTimestamp(iso: string): string { const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`; }
// v34: Google rejects conversions dated in the future (LATER_THAN_MAXIMUM_DATE). Some DUI
// Screening_Closed_Date/Course_Closed_Date values are future-scheduled; cap any conversion
// timestamp at "now" so it is always accepted.
function clampNotFuture(iso: string): string { const t = new Date(iso).getTime(); if (isNaN(t)) return new Date().toISOString(); return t > Date.now() ? new Date().toISOString() : iso; }
function toZohoDateTime(iso: string): string { const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`; }
function isWithinDays(iso: string | null | undefined, days: number): boolean { if (!iso) return false; const ms = new Date(iso).getTime(); if (isNaN(ms)) return false; return ms >= Date.now() - days * 86400000; }
function extractErrorCode(err: any): string { if (!err?.errorCode) return "UNKNOWN"; const c = err.errorCode.conversionUploadError ?? err.errorCode.conversionAdjustmentUploadError ?? err.errorCode.userListError ?? Object.values(err.errorCode)[0]; return typeof c === "string" ? c : "UNKNOWN"; }
function mapErrorToZohoPicklist(code: string): string { if (PERMANENT_ERROR_CODES.has(code)) return code; return code || "UNKNOWN"; }
function pickFirst(...vals: Array<string | null | undefined>): string | null { for (const v of vals) { if (v && String(v).trim().length > 0) return String(v).trim(); } return null; }
function parseNameFromDealName(deal_name: string | null): { first: string | null; last: string | null } { if (!deal_name) return { first: null, last: null }; const parts = deal_name.trim().split(/\s+/); if (parts.length === 0) return { first: null, last: null }; if (parts.length === 1) return { first: parts[0], last: null }; return { first: parts[0], last: parts.slice(1).join(" ") }; }

async function getZohoAccessToken(): Promise<string | null> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) return null;
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: "refresh_token" }).toString() });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}
async function zohoCoql(zohoToken: string, query: string): Promise<any[]> {
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/coql`, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${zohoToken}`, "content-type": "application/json" }, body: JSON.stringify({ select_query: query }) });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`Zoho COQL failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data ?? [];
}
async function paginateModule(zohoToken: string, module: "Deals" | "Leads" | "Contacts", selectFields: string, whereClause: string): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 200, MAX_PAGES = 25;
  let offset = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const q = `select ${selectFields} from ${module} where ${whereClause} order by Created_Time desc limit ${PAGE} offset ${offset}`;
    let rows: any[] = [];
    try { rows = await zohoCoql(zohoToken, q); } catch (err) { console.error(`paginate ${module}:`, err instanceof Error ? err.message : String(err)); break; }
    if (rows.length === 0) break;
    all.push(...rows);
    offset += PAGE;
    if (rows.length < PAGE) break;
  }
  return all;
}

async function zohoUpdateModule(zohoToken: string, module: "Deals" | "Leads", records: Array<Record<string, any>>): Promise<{ ok: boolean; batches: Array<{ size: number; ok: boolean; error?: string }> }> {
  const batches: Array<{ size: number; ok: boolean; error?: string }> = [];
  let allOk = true;
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/${module}`, { method: "PUT", headers: { Authorization: `Zoho-oauthtoken ${zohoToken}`, "content-type": "application/json" }, body: JSON.stringify({ data: batch }) });
    if (!res.ok) { batches.push({ size: batch.length, ok: false, error: `Zoho ${module} PUT ${res.status}: ${(await res.text()).slice(0, 300)}` }); allOk = false; }
    else batches.push({ size: batch.length, ok: true });
  }
  return { ok: allOk, batches };
}

async function getGoogleAdsAccessToken(): Promise<{ token: string | null; error?: string }> {
  if (!GA_OAUTH_CLIENT_ID || !GA_OAUTH_CLIENT_SECRET || !GA_OAUTH_REFRESH_TOKEN) return { token: null, error: "missing OAuth env vars" };
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: GA_OAUTH_CLIENT_ID, client_secret: GA_OAUTH_CLIENT_SECRET, refresh_token: GA_OAUTH_REFRESH_TOKEN, grant_type: "refresh_token" }).toString() });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { token: null, error: `oauth ${res.status}: ${j?.error_description ?? j?.error ?? "unknown"}` };
  return { token: j.access_token ?? null };
}
async function uploadClickConversions(payload: any): Promise<{ ok: boolean; response?: any; error?: string; http_status?: number }> {
  const { token, error: oauthErr } = await getGoogleAdsAccessToken();
  if (!token) return { ok: false, error: `google ads access token unavailable: ${oauthErr ?? "unknown"}` };
  if (!GA_DEVELOPER_TOKEN) return { ok: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN missing" };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": GA_DEVELOPER_TOKEN, "content-type": "application/json" };
  if (GA_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = GA_LOGIN_CUSTOMER_ID;
  const url = `https://googleads.googleapis.com/${GA_API_VERSION}/customers/${GA_CUSTOMER_ID}:uploadClickConversions`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, http_status: res.status, error: `google ads ${res.status}: ${JSON.stringify(j).slice(0, 500)}`, response: j };
  return { ok: true, http_status: res.status, response: j };
}
async function gaSearchStream(query: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { token, error: oauthErr } = await getGoogleAdsAccessToken();
  if (!token) return { ok: false, error: `oauth: ${oauthErr ?? "unknown"}` };
  if (!GA_DEVELOPER_TOKEN) return { ok: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN missing" };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": GA_DEVELOPER_TOKEN, "content-type": "application/json" };
  if (GA_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = GA_LOGIN_CUSTOMER_ID;
  const url = `https://googleads.googleapis.com/${GA_API_VERSION}/customers/${GA_CUSTOMER_ID}/googleAds:searchStream`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) return { ok: false, error: `searchStream ${res.status}: ${text.slice(0, 500)}`, data };
  return { ok: true, data };
}

const EVENT_CONFIG: Record<string, { ca_id: string; value_usd: number; ca_name: string }> = {
  commercial_vob:       { ca_id: CA_COMMERCIAL_VOB,    value_usd: VAL_COMMERCIAL_VOB,    ca_name: "Commercial VOB - LIVE" },
  commercial_lead_ctm:  { ca_id: CA_COMMERCIAL_LEAD,   value_usd: VAL_COMMERCIAL_LEAD,   ca_name: "Commercial Qualified - LIVE" },
  commercial_lead_zoho: { ca_id: CA_COMMERCIAL_LEAD,   value_usd: VAL_COMMERCIAL_LEAD,   ca_name: "Commercial Qualified - LIVE" },
  ahcccs_vob:           { ca_id: CA_AHCCCS_VOB,        value_usd: VAL_AHCCCS_VOB,        ca_name: "AHCCCS VOB - LIVE" },
  ahcccs_lead_ctm:      { ca_id: CA_AHCCCS_LEAD,       value_usd: VAL_AHCCCS_LEAD,       ca_name: "AHCCCS Leads - LIVE" },
  ahcccs_lead_zoho:     { ca_id: CA_AHCCCS_LEAD,       value_usd: VAL_AHCCCS_LEAD,       ca_name: "AHCCCS Leads - LIVE" },
  commercial_admit:     { ca_id: CA_COMMERCIAL_ADMIT,  value_usd: VAL_COMMERCIAL_ADMIT,  ca_name: "Commercial - Admit - LIVE" },
  ahcccs_admit:         { ca_id: CA_AHCCCS_ADMIT,      value_usd: VAL_AHCCCS_ADMIT,      ca_name: "AHCCCS - Admit - LIVE" },
  dui_closed_won:       { ca_id: CA_DUI_CLOSED_WON,    value_usd: VAL_DUI_CLOSED_WON,    ca_name: "DUI - Closed Won - LIVE" },
  commercial_ctm_45:    { ca_id: CA_CTM_COMMERCIAL_45, value_usd: VAL_CTM_COMMERCIAL_45, ca_name: "CTM 4's + 5's (Commercial Insurance)" },
  commercial_ctm45_zoho:{ ca_id: CA_CTM_COMMERCIAL_45, value_usd: VAL_CTM_COMMERCIAL_45, ca_name: "CTM 4's + 5's (Commercial Insurance)" },
  dui_ctm_45:           { ca_id: CA_CTM_DUI_45,        value_usd: VAL_CTM_DUI_45,        ca_name: "CTM DUI 4's + 5's" },
};
type EventType = keyof typeof EVENT_CONFIG;

interface UnifiedEvent { event_type: EventType; audit_lead_id: string | null; audit_zoho_id: string; email: string | null; phone: string | null; first_name: string | null; last_name: string | null; postal_code: string | null; city: string | null; state: string | null; gclid: string | null; gclid_source: "zoho_gclid" | "zoho_recovered" | "zoho_recovered_deal" | "zoho_recovered_lead" | "call_session" | "ctm_call" | "none"; event_time_iso: string; zoho_module?: "Deals" | "Leads"; zoho_record_id?: string; zoho_idempotency_field?: "VOB_Approved_Conversion_Sent_to_G_Ads" | "Conversion_Event_Sent_to_Google"; ctm_call_score_id?: string; ctm_call_score_stamp_field?: "ahcccs_3star_pushed_at" | "commercial_lead_pushed_at" | "ctm_45_commercial_pushed_at" | "ctm_45_dui_pushed_at"; }

// v30: VOB fires on VOB_Submitted=true OR Probability>=25 (catches deals where
// staff skipped the VOB checkbox but progressed the deal). Two queries merged in code.
async function fetchZohoVobEvents(zohoToken: string, limit: number): Promise<{ events: UnifiedEvent[]; tooOld: number }> {
  const baseSelect = `select id, Deal_Name, Pipeline, Probability, VOB_Submitted, VOB_Submitted_Date, Created_Time, Modified_Time, Email, Phone, Phone_2, City, State, Mailing_Zip, Recovered_GCLID, Contact_Name.id, Contact_Name.First_Name, Contact_Name.Last_Name, Contact_Name.Email, Contact_Name.Phone, Contact_Name.Mobile, Contact_Name.Mailing_City, Contact_Name.Mailing_State, Contact_Name.Mailing_Zip, Contact_Name.GCLID, Contact_Name.Recovered_GCLID from Deals`;
  const queryA = `${baseSelect} where VOB_Submitted = true and VOB_Approved_Conversion_Sent_to_G_Ads = false order by VOB_Submitted_Date desc limit ${limit}`;
  const queryB = `${baseSelect} where Probability >= 25 and VOB_Approved_Conversion_Sent_to_G_Ads = false order by Modified_Time desc limit ${limit}`;
  const [rowsA, rowsB] = await Promise.all([zohoCoql(zohoToken, queryA), zohoCoql(zohoToken, queryB)]);
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const r of [...rowsA, ...rowsB]) { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } }

  const events: UnifiedEvent[] = [];
  let tooOld = 0;
  for (const r of rows) {
    const eventDateRaw = r.VOB_Submitted_Date ?? r.Modified_Time;
    if (!isWithinDays(eventDateRaw, MAX_DEAL_AGE_DAYS)) { tooOld++; continue; }
    let event_type: EventType;
    if (r.Pipeline === "Commercial-Cash") event_type = "commercial_vob";
    else if (r.Pipeline === "AHCCCS")     event_type = "ahcccs_vob";
    else continue;
    let gclid: string | null = null;
    let gclid_source: UnifiedEvent['gclid_source'] = "none";
    if (r["Contact_Name.GCLID"]) { gclid = r["Contact_Name.GCLID"]; gclid_source = "zoho_gclid"; }
    else if (r.Recovered_GCLID) { gclid = r.Recovered_GCLID; gclid_source = "zoho_recovered_deal"; }
    else if (r["Contact_Name.Recovered_GCLID"]) { gclid = r["Contact_Name.Recovered_GCLID"]; gclid_source = "zoho_recovered"; }
    const email = pickFirst(r.Email, r["Contact_Name.Email"]);
    const phone = pickFirst(r.Phone, r.Phone_2, r["Contact_Name.Phone"], r["Contact_Name.Mobile"]);
    const dn = parseNameFromDealName(r.Deal_Name);
    const first_name = pickFirst(r["Contact_Name.First_Name"], dn.first);
    const last_name = pickFirst(r["Contact_Name.Last_Name"], dn.last);
    const postal_code = pickFirst(r.Mailing_Zip, r["Contact_Name.Mailing_Zip"]);
    const city = pickFirst(r.City, r["Contact_Name.Mailing_City"]);
    const state = pickFirst(r.State, r["Contact_Name.Mailing_State"]);
    const eventTimeIso = r.VOB_Submitted_Date ? `${r.VOB_Submitted_Date}T12:00:00Z` : (r.Created_Time ?? new Date().toISOString());
    events.push({ event_type, audit_lead_id: r["Contact_Name.id"] ?? null, audit_zoho_id: r.id, email, phone, first_name, last_name, postal_code, city, state, gclid, gclid_source, event_time_iso: eventTimeIso, zoho_module: "Deals", zoho_record_id: r.id, zoho_idempotency_field: "VOB_Approved_Conversion_Sent_to_G_Ads" });
  }
  return { events, tooOld };
}

async function fetchZohoAdmitEvents(zohoToken: string, limit: number): Promise<{ events: UnifiedEvent[]; tooOld: number }> {
  const query = `select id, Deal_Name, Pipeline, Probability, Created_Time, Modified_Time, Closing_Date, Email, Phone, Phone_2, City, State, Mailing_Zip, Recovered_GCLID, Contact_Name.id, Contact_Name.First_Name, Contact_Name.Last_Name, Contact_Name.Email, Contact_Name.Phone, Contact_Name.Mobile, Contact_Name.Mailing_City, Contact_Name.Mailing_State, Contact_Name.Mailing_Zip, Contact_Name.GCLID, Contact_Name.Recovered_GCLID from Deals where Probability >= 50 and Conversion_Event_Sent_to_Google = false order by Modified_Time desc limit ${limit}`;
  const rows = await zohoCoql(zohoToken, query);
  const events: UnifiedEvent[] = [];
  let tooOld = 0;
  for (const r of rows) {
    if (!isWithinDays(r.Modified_Time, MAX_DEAL_AGE_DAYS)) { tooOld++; continue; }
    let event_type: EventType;
    if (r.Pipeline === "Commercial-Cash") event_type = "commercial_admit";
    else if (r.Pipeline === "AHCCCS")     event_type = "ahcccs_admit";
    else continue;
    let gclid: string | null = null;
    let gclid_source: UnifiedEvent['gclid_source'] = "none";
    if (r["Contact_Name.GCLID"]) { gclid = r["Contact_Name.GCLID"]; gclid_source = "zoho_gclid"; }
    else if (r.Recovered_GCLID) { gclid = r.Recovered_GCLID; gclid_source = "zoho_recovered_deal"; }
    else if (r["Contact_Name.Recovered_GCLID"]) { gclid = r["Contact_Name.Recovered_GCLID"]; gclid_source = "zoho_recovered"; }
    const email = pickFirst(r.Email, r["Contact_Name.Email"]);
    const phone = pickFirst(r.Phone, r.Phone_2, r["Contact_Name.Phone"], r["Contact_Name.Mobile"]);
    const dn = parseNameFromDealName(r.Deal_Name);
    const first_name = pickFirst(r["Contact_Name.First_Name"], dn.first);
    const last_name = pickFirst(r["Contact_Name.Last_Name"], dn.last);
    const postal_code = pickFirst(r.Mailing_Zip, r["Contact_Name.Mailing_Zip"]);
    const city = pickFirst(r.City, r["Contact_Name.Mailing_City"]);
    const state = pickFirst(r.State, r["Contact_Name.Mailing_State"]);
    const admitTimeIso = r.Closing_Date ? `${r.Closing_Date}T12:00:00Z` : (r.Created_Time ?? new Date().toISOString());
    events.push({ event_type, audit_lead_id: r["Contact_Name.id"] ?? null, audit_zoho_id: r.id, email, phone, first_name, last_name, postal_code, city, state, gclid, gclid_source, event_time_iso: admitTimeIso, zoho_module: "Deals", zoho_record_id: r.id, zoho_idempotency_field: "Conversion_Event_Sent_to_Google" });
  }
  return { events, tooOld };
}

async function fetchZohoDuiClosedWonEvents(zohoToken: string, limit: number): Promise<{ events: UnifiedEvent[]; tooOld: number }> {
  // v37: fire the DUI Closed-Won conversion for ANY DUI-Cash deal that has progressed to
  // "Scheduled Payment or further" — implemented as "every DUI stage EXCEPT the dead ones"
  // (Stuck Lead, Closed - Lost). So Qualifying Services, Scheduled Payment, Open Payment Plan,
  // and the three Closed - (Classes/Screening/Both) stages all pass back. (Was: Probability = 100.)
  // Exclude the dead stages in CODE, not COQL: Zoho COQL rejects `not in (...)` when combined with
  // other AND conditions ("SYNTAX_ERROR near where"). So fetch all unsent DUI-Cash deals (a proven
  // 2-condition query) and drop the excluded stages in the loop below.
  const DUI_EXCLUDED_STAGES = ["Stuck Lead - DUI (Cash)", "Closed - Lost (DUI)", "Closed - Lost (Treatment)"];
  const query = `select id, Deal_Name, Pipeline, Stage, Probability, Created_Time, Modified_Time, Closing_Date, Screening_Closed_Date, Course_Closed_Date, Email, Phone, Phone_2, City, State, Mailing_Zip, Recovered_GCLID, Contact_Name.id, Contact_Name.First_Name, Contact_Name.Last_Name, Contact_Name.Email, Contact_Name.Phone, Contact_Name.Mobile, Contact_Name.Mailing_City, Contact_Name.Mailing_State, Contact_Name.Mailing_Zip, Contact_Name.GCLID, Contact_Name.Recovered_GCLID from Deals where Pipeline = 'DUI - Cash' and Conversion_Event_Sent_to_Google = false order by Modified_Time desc limit ${limit}`;
  const rows = await zohoCoql(zohoToken, query);
  const events: UnifiedEvent[] = [];
  let tooOld = 0;
  for (const r of rows) {
    if (r.Pipeline !== "DUI - Cash") continue;
    if (DUI_EXCLUDED_STAGES.includes(r.Stage)) continue;
    if (!isWithinDays(r.Modified_Time, MAX_DEAL_AGE_DAYS)) { tooOld++; continue; }
    let gclid: string | null = null;
    let gclid_source: UnifiedEvent['gclid_source'] = "none";
    if (r["Contact_Name.GCLID"]) { gclid = r["Contact_Name.GCLID"]; gclid_source = "zoho_gclid"; }
    else if (r.Recovered_GCLID) { gclid = r.Recovered_GCLID; gclid_source = "zoho_recovered_deal"; }
    else if (r["Contact_Name.Recovered_GCLID"]) { gclid = r["Contact_Name.Recovered_GCLID"]; gclid_source = "zoho_recovered"; }
    const email = pickFirst(r.Email, r["Contact_Name.Email"]);
    const phone = pickFirst(r.Phone, r.Phone_2, r["Contact_Name.Phone"], r["Contact_Name.Mobile"]);
    const dn = parseNameFromDealName(r.Deal_Name);
    const first_name = pickFirst(r["Contact_Name.First_Name"], dn.first);
    const last_name = pickFirst(r["Contact_Name.Last_Name"], dn.last);
    const postal_code = pickFirst(r.Mailing_Zip, r["Contact_Name.Mailing_Zip"]);
    const city = pickFirst(r.City, r["Contact_Name.Mailing_City"]);
    const state = pickFirst(r.State, r["Contact_Name.Mailing_State"]);
    // v33: DUI ts fallback chain Screening_Closed_Date -> Course_Closed_Date -> Closing_Date -> Created_Time.
    const duiTimeIso = r.Screening_Closed_Date ? `${r.Screening_Closed_Date}T12:00:00Z`
      : r.Course_Closed_Date ? `${r.Course_Closed_Date}T12:00:00Z`
      : r.Closing_Date ? `${r.Closing_Date}T12:00:00Z`
      : (r.Created_Time ?? new Date().toISOString());
    events.push({ event_type: "dui_closed_won", audit_lead_id: r["Contact_Name.id"] ?? null, audit_zoho_id: r.id, email, phone, first_name, last_name, postal_code, city, state, gclid, gclid_source, event_time_iso: duiTimeIso, zoho_module: "Deals", zoho_record_id: r.id, zoho_idempotency_field: "Conversion_Event_Sent_to_Google" });
  }
  return { events, tooOld };
}

async function fetchZohoLeadEvents(zohoToken: string, limit: number): Promise<{ events: UnifiedEvent[]; tooOld: number; unrouted: number }> {
  const baseFields = "id, First_Name, Last_Name, Lead_Score_Rating, Email, Phone, Mobile, City, State, Zip_Code, GCLID, GCLID1, Recovered_GCLID, Created_Time, Modified_Time";
  const ratings = [
    { value: LEAD_RATING_3STAR, event_type: "ahcccs_lead_zoho" as EventType },
    { value: LEAD_RATING_4STAR, event_type: "commercial_lead_zoho" as EventType },
    { value: LEAD_RATING_5STAR, event_type: "commercial_lead_zoho" as EventType },
  ];
  const events: UnifiedEvent[] = [];
  let tooOld = 0;
  for (const { value, event_type } of ratings) {
    const safeValue = value.replace(/'/g, "''");
    const q = `select ${baseFields} from Leads where Conversion_Event_Sent_to_Google = false and Lead_Score_Rating = '${safeValue}' order by Modified_Time desc limit ${limit}`;
    const rows = await zohoCoql(zohoToken, q);
    for (const r of rows) {
      const t = r.Modified_Time ?? r.Created_Time;
      if (!isWithinDays(t, MAX_DEAL_AGE_DAYS)) { tooOld++; continue; }
      let gclid: string | null = null;
      let gclid_source: UnifiedEvent['gclid_source'] = "none";
      if (r.GCLID1) { gclid = r.GCLID1; gclid_source = "zoho_gclid"; }
      else if (r.GCLID) { gclid = r.GCLID; gclid_source = "zoho_gclid"; }
      else if (r.Recovered_GCLID) { gclid = r.Recovered_GCLID; gclid_source = "zoho_recovered_lead"; }
      const email = r.Email ?? null;
      const phone = pickFirst(r.Phone, r.Mobile);
      events.push({ event_type, audit_lead_id: r.id, audit_zoho_id: r.id, email, phone, first_name: r.First_Name ?? null, last_name: r.Last_Name ?? null, postal_code: r.Zip_Code ?? null, city: r.City ?? null, state: r.State ?? null, gclid, gclid_source, event_time_iso: r.Created_Time ?? new Date().toISOString(), zoho_module: "Leads", zoho_record_id: r.id, zoho_idempotency_field: "Conversion_Event_Sent_to_Google" });
    }
  }
  return { events, tooOld, unrouted: 0 };
}
// --- CTM queue-routing helpers (call_path is more reliable than the dui/commercial tags) ---
function last10(phone: string | null): string | null { if (!phone) return null; const d = String(phone).replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; }
function callPathHas(raw: any, routeType: string | null, routeName: string): boolean {
  const cp = Array.isArray(raw?.call_path) ? raw.call_path : [];
  return cp.some((s: any) => s?.route_name === routeName && (routeType === null || s?.route_type === routeType));
}
function isDuiRouted(raw: any): boolean {
  return callPathHas(raw, "CallQueue", "DUI Queue 2025") || callPathHas(raw, null, "Main Admissions IVR:2");
}
function isCommercialRouted(raw: any): boolean {
  return callPathHas(raw, "CallQueue", "Treatment Reps - Commercial");
}

async function fetchCtmBotLeadEvents(limit: number): Promise<{ events: UnifiedEvent[]; tooOldOrSkipped: number; error?: string }> {
  if (!ctmBot) return { events: [], tooOldOrSkipped: 0, error: "CTM_BOT_SERVICE_ROLE_KEY missing" };
  const cutoffIso = new Date(Date.now() - MAX_DEAL_AGE_DAYS * 86400000).toISOString();

  // AHCCCS medicaid 3-star (unchanged) → ahcccs_lead_ctm
  const { data: ahcccsScores, error: ahcccsErr } = await ctmBot.from("call_score").select("id, call_id, score, override_score, insurance_type, scored_at, ahcccs_3star_pushed_at").eq("insurance_type", "medicaid").is("ahcccs_3star_pushed_at", null).gte("scored_at", cutoffIso).order("scored_at", { ascending: false }).limit(limit * 2);
  if (ahcccsErr) return { events: [], tooOldOrSkipped: 0, error: `ctm bot ahcccs fetch: ${ahcccsErr.message}` };

  // 4/5-star calls not yet routed to EITHER action; queue decides commercial vs DUI destination.
  const { data: starScores, error: starErr } = await ctmBot.from("call_score").select("id, call_id, score, override_score, scored_at, ctm_45_commercial_pushed_at, ctm_45_dui_pushed_at").is("ctm_45_commercial_pushed_at", null).is("ctm_45_dui_pushed_at", null).gte("scored_at", cutoffIso).or("score.in.(4,5),override_score.in.(4,5)").order("scored_at", { ascending: false }).limit(limit * 4);
  if (starErr) return { events: [], tooOldOrSkipped: 0, error: `ctm bot star fetch: ${starErr.message}` };

  type ScoreRow = { id: string; call_id: string; score: number | null; override_score: number | null; scored_at: string };
  const ahcccsRows = ((ahcccsScores ?? []) as ScoreRow[]).filter(r => (r.override_score ?? r.score) === 3);
  const starRows = ((starScores ?? []) as ScoreRow[]).filter(r => { const e = r.override_score ?? r.score; return e === 4 || e === 5; });
  const callIds = [...new Set([...ahcccsRows, ...starRows].map(r => r.call_id))];
  if (callIds.length === 0) return { events: [], tooOldOrSkipped: 0 };

  const { data: calls, error: callsErr } = await ctmBot.from("ctm_call").select("call_id, caller_number, raw_payload, received_at").in("call_id", callIds);
  if (callsErr) return { events: [], tooOldOrSkipped: 0, error: `ctm bot ctm_call fetch: ${callsErr.message}` };
  const callMap = new Map<string, any>();
  for (const c of (calls ?? [])) callMap.set(c.call_id, c);

  const events: UnifiedEvent[] = [];

  for (const row of ahcccsRows) {
    const call = callMap.get(row.call_id);
    const phone = call?.caller_number ?? null;
    const gclid = call?.raw_payload?.ga?.gclid ?? null;
    events.push({ event_type: "ahcccs_lead_ctm", audit_lead_id: row.call_id, audit_zoho_id: row.id, email: null, phone, first_name: null, last_name: null, postal_code: null, city: null, state: null, gclid, gclid_source: gclid ? "ctm_call" : "none", event_time_iso: call?.received_at ?? row.scored_at ?? new Date().toISOString(), ctm_call_score_id: row.id, ctm_call_score_stamp_field: "ahcccs_3star_pushed_at" });
  }

  for (const row of starRows) {
    const call = callMap.get(row.call_id);
    const raw = call?.raw_payload;
    const phone = call?.caller_number ?? null;
    const email = normalizeEmail(raw?.email ?? null);
    const gclid = raw?.ga?.gclid ?? null;
    // Queue routing: DUI-routed-and-not-commercial → DUI action; everything else → commercial action.
    const isDui = isDuiRouted(raw) && !isCommercialRouted(raw);
    const event_type: EventType = isDui ? "dui_ctm_45" : "commercial_ctm_45";
    const stamp_field = isDui ? "ctm_45_dui_pushed_at" : "ctm_45_commercial_pushed_at";
    events.push({ event_type, audit_lead_id: row.call_id, audit_zoho_id: row.id, email, phone, first_name: null, last_name: null, postal_code: null, city: null, state: null, gclid, gclid_source: gclid ? "ctm_call" : "none", event_time_iso: call?.received_at ?? row.scored_at ?? new Date().toISOString(), ctm_call_score_id: row.id, ctm_call_score_stamp_field: stamp_field });
  }

  return { events, tooOldOrSkipped: 0 };
}

// Second pass: Zoho Commercial-Cash deals (within 90d) NOT already covered by the CTM 4/5★ pass.
// Dedup by phone(last-10)/email against CTM-pushed calls (this run + prior DB stamps).
// Idempotency via conversion_push_log (event_type commercial_ctm45_zoho) — NOT a Zoho field.
async function fetchZohoCommercialBackstopEvents(zohoToken: string, ctmCommercialEvents: UnifiedEvent[]): Promise<{ events: UnifiedEvent[]; scanned: number; skipped_covered: number; skipped_already_sent: number }> {
  const cutoffIso = new Date(Date.now() - MAX_DEAL_AGE_DAYS * 86400000).toISOString();

  // 1) CTM coverage set (phone last-10 + email): this run's commercial events + prior DB-stamped pushes.
  const coverPhones = new Set<string>();
  const coverEmails = new Set<string>();
  for (const e of ctmCommercialEvents) {
    const p = last10(e.phone); if (p) coverPhones.add(p);
    const em = normalizeEmail(e.email); if (em) coverEmails.add(em);
  }
  if (ctmBot) {
    const { data: prior } = await ctmBot.from("call_score").select("call_id").not("ctm_45_commercial_pushed_at", "is", null).gte("scored_at", cutoffIso);
    const priorIds = [...new Set((prior ?? []).map((r: any) => r.call_id))];
    for (let i = 0; i < priorIds.length; i += 100) {
      const { data: pc } = await ctmBot.from("ctm_call").select("caller_number, raw_payload").in("call_id", priorIds.slice(i, i + 100));
      for (const c of (pc ?? []) as any[]) {
        const p = last10(c.caller_number); if (p) coverPhones.add(p);
        const em = normalizeEmail(c.raw_payload?.email ?? null); if (em) coverEmails.add(em);
      }
    }
  }

  // 2) Already-settled backstop deal ids (log-based idempotency; deal id stored in zoho_lead_id).
  // Settled = pushed OK, OR rejected with a code Google will never accept on retry.
  // Backstop events carry no zoho_idempotency_field and no ctm_call_score_stamp_field, so this
  // log query is their ONLY memory of a prior attempt. Counting successes alone meant a
  // permanently-rejected deal was rescanned and re-pushed every run forever — 9 deals had burned
  // 534 attempts (worst: 234) before this was caught. error_msg holds the bare Google error code
  // for permanent failures, so it matches PERMANENT_ERROR_CODES directly; transient codes
  // (INTERNAL_ERROR, upload/transport failures) are deliberately NOT settled and still retry.
  // PostgREST caps a single select at 1000 rows, and success+failed here is already ~1.8k and
  // grows every run — so this MUST page. A truncated read silently drops settled deals back into
  // the scan and re-pushes them to Google as duplicate conversions (that happened: 104 deals
  // double-pushed on 2026-09-09 when this query was widened from success-only without paging).
  const doneDeals = new Set<string>();
  for (let from = 0; from <= 100000; from += 1000) {
    const { data: logged, error } = await supabase.from("conversion_push_log")
      .select("zoho_lead_id, status, error_msg")
      .eq("event_type", "commercial_ctm45_zoho")
      .in("status", ["success", "failed"])
      .range(from, from + 999);
    if (error) { console.error("doneDeals page failed:", error.message); break; }
    if (!logged || logged.length === 0) break;
    for (const r of logged as any[]) {
      if (!r.zoho_lead_id) continue;
      if (r.status === "success" || PERMANENT_ERROR_CODES.has(r.error_msg)) doneDeals.add(r.zoho_lead_id);
    }
    if (logged.length < 1000) break;
  }

  // 2b) Recovered gclid -> the CTM call time it came from (a guaranteed >= click timestamp).
  // Recovered gclids are stamped onto deals by phone-match, so Deal.Created_Time can be BEFORE the
  // click -> Google rejects with CONVERSION_PRECEDES_EVENT. Date such conversions at the source call
  // instead. Earliest call bearing the gclid is closest to (and safely after) the click.
  const gclidToCallTime = new Map<string, string>();
  if (ctmBot) {
    const gsince = new Date(Date.now() - (MAX_DEAL_AGE_DAYS + 30) * 86400000).toISOString();
    for (let from = 0; from <= 20000; from += 1000) {
      const { data, error } = await ctmBot.from("ctm_call")
        .select("received_at, raw_payload")
        .not("raw_payload->ga->>gclid", "is", null)
        .gte("received_at", gsince)
        .order("received_at", { ascending: true })
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const c of data as any[]) {
        const g = c.raw_payload?.ga?.gclid;
        if (g && !gclidToCallTime.has(g)) gclidToCallTime.set(g, c.received_at); // asc order → earliest kept
      }
      if (data.length < 1000) break;
    }
  }

  // 3) Commercial-Cash deals created within the window.
  const selectFields = "id, Deal_Name, Pipeline, Created_Time, Email, Phone, Phone_2, City, State, Mailing_Zip, Recovered_GCLID, Contact_Name.id, Contact_Name.First_Name, Contact_Name.Last_Name, Contact_Name.Email, Contact_Name.Phone, Contact_Name.Mobile, Contact_Name.Mailing_City, Contact_Name.Mailing_State, Contact_Name.Mailing_Zip, Contact_Name.GCLID, Contact_Name.Recovered_GCLID";
  const rows = await paginateModule(zohoToken, "Deals", selectFields, `Pipeline = 'Commercial-Cash' and Created_Time >= '${toZohoDateTime(cutoffIso)}'`);

  const events: UnifiedEvent[] = [];
  let scanned = 0, skipped_covered = 0, skipped_already_sent = 0;
  for (const r of rows) {
    if (!isWithinDays(r.Created_Time, MAX_DEAL_AGE_DAYS)) continue;
    scanned++;
    if (doneDeals.has(r.id)) { skipped_already_sent++; continue; }
    const email = pickFirst(r.Email, r["Contact_Name.Email"]);
    const phone = pickFirst(r.Phone, r.Phone_2, r["Contact_Name.Phone"], r["Contact_Name.Mobile"]);
    const p10 = last10(phone); const em = normalizeEmail(email);
    if ((p10 && coverPhones.has(p10)) || (em && coverEmails.has(em))) { skipped_covered++; continue; }
    let gclid: string | null = null;
    let gclid_source: UnifiedEvent['gclid_source'] = "none";
    if (r["Contact_Name.GCLID"]) { gclid = r["Contact_Name.GCLID"]; gclid_source = "zoho_gclid"; }
    else if (r.Recovered_GCLID) { gclid = r.Recovered_GCLID; gclid_source = "zoho_recovered_deal"; }
    else if (r["Contact_Name.Recovered_GCLID"]) { gclid = r["Contact_Name.Recovered_GCLID"]; gclid_source = "zoho_recovered"; }
    // Fix CONVERSION_PRECEDES_EVENT: a RECOVERED gclid is phone-matched, so Deal.Created_Time can be
    // before the click. Date the conversion at the source CTM call (>= click). If the gclid can't be
    // traced to a call, drop it and let hashed identifiers carry the match rather than send a bad pair.
    let eventTimeIso = r.Created_Time ?? new Date().toISOString();
    const isRecovered = gclid_source === "zoho_recovered_deal" || gclid_source === "zoho_recovered";
    if (gclid && isRecovered) {
      const callTime = gclidToCallTime.get(gclid);
      if (callTime) eventTimeIso = callTime;
      else { gclid = null; gclid_source = "none"; }
    }
    const dn = parseNameFromDealName(r.Deal_Name);
    const first_name = pickFirst(r["Contact_Name.First_Name"], dn.first);
    const last_name = pickFirst(r["Contact_Name.Last_Name"], dn.last);
    const postal_code = pickFirst(r.Mailing_Zip, r["Contact_Name.Mailing_Zip"]);
    const city = pickFirst(r.City, r["Contact_Name.Mailing_City"]);
    const state = pickFirst(r.State, r["Contact_Name.Mailing_State"]);
    // No zoho_module / zoho_idempotency_field: idempotency is via conversion_push_log only,
    // so this never touches the deal's Conversion_Event_Sent_to_Google (used by the Admit push).
    events.push({ event_type: "commercial_ctm45_zoho", audit_lead_id: r["Contact_Name.id"] ?? null, audit_zoho_id: r.id, email, phone, first_name, last_name, postal_code, city, state, gclid, gclid_source, event_time_iso: eventTimeIso });
  }
  return { events, scanned, skipped_covered, skipped_already_sent };
}

Deno.serve(async (req) => {
  const _pre = handleCorsPreflight(req);
  if (_pre) return _pre;
  try {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "method not allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const dryRun = typeof body.dry_run === "boolean" ? body.dry_run : GA_DRY_RUN_ENV;

    if (body.diagnose === true) {
      const caIds = [CA_COMMERCIAL_VOB, CA_COMMERCIAL_LEAD, CA_AHCCCS_LEAD, CA_AHCCCS_ADMIT, CA_COMMERCIAL_ADMIT, CA_AHCCCS_VOB, CA_DUI_CLOSED_WON];
      const caIdsList = caIds.join(",");
      const metaQ = `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, conversion_action.click_through_lookback_window_days FROM conversion_action WHERE conversion_action.id IN (${caIdsList})`;
      const custQ = `SELECT customer.id, customer.descriptive_name, customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled, customer.conversion_tracking_setting.accepted_customer_data_terms FROM customer WHERE customer.id = ${GA_CUSTOMER_ID}`;
      const statsQ = `SELECT customer.id, segments.conversion_action, segments.date, metrics.all_conversions, metrics.all_conversions_value FROM customer WHERE segments.date DURING LAST_30_DAYS AND segments.conversion_action IN (${caIdsList.split(',').map(id => `'customers/${GA_CUSTOMER_ID}/conversionActions/${id}'`).join(',')})`;
      const [meta, cust, stats] = await Promise.all([gaSearchStream(metaQ), gaSearchStream(custQ), gaSearchStream(statsQ)]);
      return jsonResponse({ ok: true, api_version: GA_API_VERSION, customer: cust, conversion_action_metadata: meta, conversion_action_stats_last_30_days: stats });
    }

    // Zoho token may be unavailable (expired/revoked refresh token). Don't let that block the
    // CTM-sourced conversions (commercial/AHCCCS/DUI calls), which don't need Zoho — just skip the
    // Zoho-sourced paths (VOB/admit/leads/DUI-deals/backstop) and surface zoho_token_ok in the result.
    const zohoToken = await getZohoAccessToken();
    const emptyZoho = { events: [] as UnifiedEvent[], tooOld: 0 };
    const [vob, admit, dui, zLeads] = zohoToken
      ? await Promise.all([fetchZohoVobEvents(zohoToken, limit), fetchZohoAdmitEvents(zohoToken, limit), fetchZohoDuiClosedWonEvents(zohoToken, limit), fetchZohoLeadEvents(zohoToken, limit)])
      : [emptyZoho, emptyZoho, emptyZoho, { events: [] as UnifiedEvent[], tooOld: 0, unrouted: 0 }];
    const ctm = await fetchCtmBotLeadEvents(limit);
    // Second pass: Zoho Commercial-Cash backstop, deduped against this run's CTM 4/5★ commercial events.
    const ctmCommercial = ctm.events.filter(e => e.event_type === "commercial_ctm_45");
    const backstop = zohoToken
      ? await fetchZohoCommercialBackstopEvents(zohoToken, ctmCommercial)
      : { events: [] as UnifiedEvent[], scanned: 0, skipped_covered: 0, skipped_already_sent: 0 };
    const allEvents = [...vob.events, ...admit.events, ...dui.events, ...zLeads.events, ...ctm.events, ...backstop.events];

    const conversions: any[] = [];
    const meta: Array<{ ev: UnifiedEvent; identifierCount: number; ca: typeof EVENT_CONFIG[EventType] }> = [];
    const skippedEvents: UnifiedEvent[] = [];
    const logRows: any[] = [];
    let skippedNoIdent = 0;

    for (const ev of allEvents) {
      const ca = EVENT_CONFIG[ev.event_type];
      const identifiers = await buildUserIdentifiers({ email: ev.email, phone: ev.phone, first_name: ev.first_name, last_name: ev.last_name, postal_code: ev.postal_code, city: ev.city, state: ev.state });
      const hasIdent = Boolean(ev.gclid) || identifiers.length > 0;
      if (!hasIdent) {
        logRows.push({ event_type: ev.event_type, lead_id: ev.audit_lead_id, zoho_lead_id: ev.audit_zoho_id, gclid: null, gclid_source: "none", identifier_count: 0, conversion_value_usd: ca.value_usd, conversion_action_id: ca.ca_id, payload: null, dry_run: dryRun, status: "skipped_no_identifier" });
        skippedNoIdent++;
        skippedEvents.push(ev);
        continue;
      }
      const conv: any = { conversion_action: `customers/${GA_CUSTOMER_ID}/conversionActions/${ca.ca_id}`, conversion_date_time: toGaTimestamp(clampNotFuture(ev.event_time_iso)), conversion_value: ca.value_usd, currency_code: "USD" };
      if (ev.gclid) conv.gclid = ev.gclid;
      if (identifiers.length > 0) conv.user_identifiers = identifiers;
      conversions.push(conv);
      meta.push({ ev, identifierCount: identifiers.length, ca });
    }

    let pushed = 0, failed = 0, dryRunOnly = 0;
    let permanentFailures = 0, transientFailures = 0;
    const errorBreakdown: Record<string, number> = {};
    const zohoUpdates: Record<"Deals" | "Leads", Map<string, Record<string, any>>> = { Deals: new Map(), Leads: new Map() };
    const ctmStampsByField: Record<string, string[]> = {};

    if (dryRun) {
      for (let i = 0; i < conversions.length; i++) {
        const m = meta[i];
        logRows.push({ event_type: m.ev.event_type, lead_id: m.ev.audit_lead_id, zoho_lead_id: m.ev.audit_zoho_id, gclid: m.ev.gclid, gclid_source: m.ev.gclid_source, identifier_count: m.identifierCount, conversion_value_usd: m.ca.value_usd, conversion_action_id: m.ca.ca_id, payload: conversions[i], dry_run: true, status: "dry_run" });
        dryRunOnly++;
      }
    } else {
      const nowZoho = toZohoDateTime(new Date().toISOString());
      for (const ev of skippedEvents) {
        if (!ev.zoho_module || !ev.zoho_record_id || !ev.zoho_idempotency_field) continue;
        const moduleMap = zohoUpdates[ev.zoho_module];
        const existing = moduleMap.get(ev.zoho_record_id) ?? { id: ev.zoho_record_id };
        existing.Conversion_Pushed_At = nowZoho;
        existing.Conversion_Push_Status = "Skipped";
        existing[ev.zoho_idempotency_field] = true;
        moduleMap.set(ev.zoho_record_id, existing);
      }
      const result = await uploadClickConversions({ conversions, partial_failure: true, validate_only: false });
      const results = result.response?.results ?? [];

      const failedByIndex = new Map<number, string>();
      const pfe = result.response?.partialFailureError;
      if (pfe) {
        for (const det of (pfe.details ?? [])) {
          for (const err of (det.errors ?? [])) {
            const code = extractErrorCode(err);
            const idx = err.location?.fieldPathElements?.find((p: any) => p.fieldName === "conversions")?.index ?? -1;
            if (idx >= 0) failedByIndex.set(idx, code);
          }
        }
      }

      const globalError = !result.ok ? (result.error ?? "upload_failed") : null;

      for (let i = 0; i < conversions.length; i++) {
        const m = meta[i];
        const r = results[i];
        const failureCode = globalError ? "UPLOAD_FAILED" : failedByIndex.get(i);
        const ok = !failureCode && !!r;
        const permanent = failureCode ? PERMANENT_ERROR_CODES.has(failureCode) : false;

        logRows.push({ event_type: m.ev.event_type, lead_id: m.ev.audit_lead_id, zoho_lead_id: m.ev.audit_zoho_id, gclid: m.ev.gclid, gclid_source: m.ev.gclid_source, identifier_count: m.identifierCount, conversion_value_usd: m.ca.value_usd, conversion_action_id: m.ca.ca_id, payload: conversions[i], dry_run: false, status: ok ? "success" : "failed", google_response: ok ? r : (r ?? null), error_msg: ok ? null : (globalError ?? failureCode ?? "unknown") });

        if (m.ev.zoho_module && m.ev.zoho_record_id) {
          const moduleMap = zohoUpdates[m.ev.zoho_module];
          const existing = moduleMap.get(m.ev.zoho_record_id) ?? { id: m.ev.zoho_record_id };
          existing.Conversion_Pushed_At = nowZoho;
          existing.Conversion_Push_Status = ok ? "Success" : "Failure";
          if (ok && m.ev.zoho_idempotency_field) existing[m.ev.zoho_idempotency_field] = true;
          else if (!ok) {
            existing.Conversion_Push_Error = mapErrorToZohoPicklist(failureCode ?? "UNKNOWN");
            if (permanent && m.ev.zoho_idempotency_field) existing[m.ev.zoho_idempotency_field] = true;
          }
          moduleMap.set(m.ev.zoho_record_id, existing);
        }

        if ((ok || permanent) && m.ev.ctm_call_score_id && m.ev.ctm_call_score_stamp_field) {
          (ctmStampsByField[m.ev.ctm_call_score_stamp_field] ||= []).push(m.ev.ctm_call_score_id);
        }

        if (ok) pushed++;
        else {
          failed++;
          if (permanent) permanentFailures++; else transientFailures++;
          if (failureCode) errorBreakdown[failureCode] = (errorBreakdown[failureCode] ?? 0) + 1;
        }
      }
    }

    const zohoWriteback: any = { Deals: null, Leads: null };
    for (const mod of ["Deals", "Leads"] as const) {
      if (zohoToken && zohoUpdates[mod].size > 0) {
        const records = Array.from(zohoUpdates[mod].values());
        const r = await zohoUpdateModule(zohoToken, mod, records);
        zohoWriteback[mod] = { total: records.length, ok: r.ok, batches: r.batches };
      }
    }

    let totalCtmStamps = 0;
    if (ctmBot) {
      const nowIso = new Date().toISOString();
      for (const [field, ids] of Object.entries(ctmStampsByField)) {
        // Chunk the id list: a single .in() with hundreds/thousands of UUIDs overflows the request URL.
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const { error } = await ctmBot.from("call_score").update({ [field]: nowIso }).in("id", chunk);
          if (error) console.error(`ctm call_score ${field} stamp failed:`, error.message);
          else totalCtmStamps += chunk.length;
        }
      }
    }

    if (logRows.length > 0) {
      const { error } = await supabase.from("conversion_push_log").insert(logRows);
      if (error) console.error("conversion_push_log insert failed:", error.message);
    }

    // A null Zoho token zeroes every Zoho-sourced event (VOB/admit/leads/DUI-deals/backstop) while
    // the CTM paths still push, so the run reads as healthy: HTTP 200, ok:true, and the only trace
    // is a zoho_token_ok field nobody queries. Three consecutive runs were lost that way before it
    // was spotted (2026-09-09). The CTM work above is already committed and is still reported here
    // — but the response is marked failed so pg_net's status_code surfaces it.
    const zohoOk = !!zohoToken;
    return jsonResponse({ ok: zohoOk, ...(zohoOk ? {} : { error: "zoho_auth_unavailable: refresh returned no access token; Zoho-sourced conversions were skipped this run (CTM-sourced still pushed)" }), version: "v40", dry_run: dryRun, zoho_token_ok: zohoOk, max_deal_age_days: MAX_DEAL_AGE_DAYS, api_version: GA_API_VERSION, scanned: { dui_closed_won: dui.events.length, vob: vob.events.length, admit: admit.events.length, zoho_leads: zLeads.events.length, ctm: ctm.events.length, commercial_ctm_45: ctmCommercial.length, commercial_backstop: backstop.events.length }, backstop: { scanned: backstop.scanned, skipped_covered: backstop.skipped_covered, skipped_already_sent: backstop.skipped_already_sent }, pushed, dry_run_only: dryRunOnly, skipped_no_identifier: skippedNoIdent, failed, permanent_failures: permanentFailures, transient_failures: transientFailures, error_breakdown: errorBreakdown, zoho_writeback: zohoWriteback, ctm_call_scores_stamped: totalCtmStamps }, zohoOk ? 200 : 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
