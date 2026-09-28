// ctm-opt-out-to-zoho — CTM opt-out → Zoho CRM suppression.
//
// Called by CTM webhook "Suppression: Inbound STOP → Zoho Opt-Out" (id 279464),
// which only fires "Through a trigger" — i.e. from the CTM trigger
// "Suppression: Inbound STOP → DNC + Zoho sync" (STOP-word texts) and any other
// trigger that tags an activity with one of OPT_OUT_TAGS.
//
// Why the activity is re-fetched from CTM instead of trusting the POST body:
// the callback URL carries no shared secret (a secret in a CTM form field is
// something we deliberately never type), so anyone who guessed the URL could
// POST a phone number. Re-fetching the activity with our own CTM credentials
// makes the caller number and the opt-out evidence (tag / STOP text) come from
// CTM, not from the request. A forged request therefore can only opt out a
// number that CTM itself already shows as opted out.
//
// Zoho writes (all three modules, matched on the caller's last 10 digits):
//   Leads    — Text/Email/SMS opt-out, Opt_Out_Source=CTM, Opt_Out_Scope=Global,
//              Opt_Out_Date, Lead_Status="Requested No Further Contact",
//              + tag "Do Not Contact"
//   Contacts — same minus Lead_Status
//   Deals    — Text/Email/SMS opt-out + tag (Deals have no Opt_Out_* fields)
// The "Do Not Contact" tag is what the existing Zoho DNC workflows key on, so
// adding it keeps every downstream rule (Interaction Status backstop etc.)
// consistent with a rep-applied opt-out.
//
// Query params: ?dry_run=1 (report matches, write nothing), ?debug=1 (echo the
// CTM activity shape — for wiring/troubleshooting only).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CTM_HOST = Deno.env.get("CTM_API_HOST") ?? "api.calltrackingmetrics.com";
const CTM_ACCOUNT_ID = Deno.env.get("CTM_ACCOUNT_ID");
const CTM_ACCESS_KEY = Deno.env.get("CTM_ACCESS_KEY");
const CTM_SECRET_KEY = Deno.env.get("CTM_SECRET_KEY");
const CTM_API_TOKEN = Deno.env.get("CTM_API_TOKEN")
  ?? (CTM_ACCESS_KEY && CTM_SECRET_KEY ? btoa(`${CTM_ACCESS_KEY}:${CTM_SECRET_KEY}`) : undefined);

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID");
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET");
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN");
const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
const ZOHO_ACCOUNTS_DOMAIN = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";

// Tags a CTM trigger (or an agent) can apply to mean "this caller opted out".
const OPT_OUT_TAGS = new Set([
  "opt-out", "opt out", "optout", "do not contact", "do-not-contact", "dnc", "zoho-opt-out",
]);
// Same STOP vocabulary as the CTM trigger's Message Body rules.
const STOP_RE = /^\s*(stop|stopall|stop all|unsubscribe|cancel|end|quit)\b/i;

const DNC_TAG = "Do Not Contact";
const OPT_OUT_SOURCE = "CTM";
const OPT_OUT_SCOPE = "Global";
const LEAD_DNC_STATUS = "Requested No Further Contact";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Json = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function last10(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// CTM posts application/json for this webhook, but accept form-encoding too so
// a re-configured webhook cannot silently break the path.
async function readBody(req: Request): Promise<Json> {
  const ct = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (!text) return {};
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text)) as Json;
  }
  try { return JSON.parse(text) as Json; } catch { /* fall through */ }
  try { return Object.fromEntries(new URLSearchParams(text)) as Json; } catch { return {}; }
}

// ---------------------------------------------------------------------------
// CTM
// ---------------------------------------------------------------------------

async function fetchCtmActivity(id: string): Promise<Json | null> {
  if (!CTM_ACCOUNT_ID || !CTM_API_TOKEN) throw new Error("CTM credentials not set");
  const headers = { authorization: `Basic ${CTM_API_TOKEN}`, accept: "application/json" };
  // Messages and calls are both "activities"; /calls/{id} serves both, but keep
  // /messages as a fallback in case CTM routes SMS records separately.
  for (const path of [`/calls/${id}.json`, `/messages/${id}.json`]) {
    const res = await fetch(`https://${CTM_HOST}/api/v1/accounts/${CTM_ACCOUNT_ID}${path}`, { headers });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`CTM ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json() as Json;
  }
  return null;
}

function activityText(a: Json): string {
  for (const k of ["message", "body", "text", "sms", "content", "transcription_text", "notes"]) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function activityTags(a: Json): string[] {
  const t = (a.tag_list ?? a.tags) as unknown;
  if (Array.isArray(t)) return t.map((x) => String(x).toLowerCase().trim());
  if (typeof t === "string") return t.split(",").map((x) => x.toLowerCase().trim());
  return [];
}

function isInboundMessage(a: Json): boolean {
  const type = String(a.type ?? a.direction ?? "").toLowerCase();
  return type.includes("msg") || type.includes("message") || type.includes("sms") ||
    (String(a.direction ?? "") === "inbound" && !!activityText(a) && !a.duration);
}

// Returns the reason CTM's own record justifies an opt-out, or null.
function optOutReason(a: Json): string | null {
  const tags = activityTags(a);
  const hit = tags.find((t) => OPT_OUT_TAGS.has(t));
  if (hit) return `tag:${hit}`;
  if (isInboundMessage(a) && STOP_RE.test(activityText(a))) return "stop_message";
  return null;
}

// ---------------------------------------------------------------------------
// Zoho
// ---------------------------------------------------------------------------

async function zohoToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) throw new Error("ZOHO secrets not set");
  const body = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET, grant_type: "refresh_token",
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`Zoho OAuth failed (${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

async function coql(token: string, query: string): Promise<Json[]> {
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/coql`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ select_query: query }),
  });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`COQL failed (${res.status}): ${(await res.text()).slice(0, 300)} :: ${query}`);
  return ((await res.json()).data ?? []) as Json[];
}

// Zoho stores phones in whatever shape the writer sent — "+14803941332",
// "4803941332", "(480) 394-1332", "480-394-1332". COQL LIKE cannot strip
// punctuation, so match on the last seven digits in the three common shapes
// and let the caller re-check the full last-10 on the returned rows.
function phoneClauses(fields: string[], l10: string): string {
  const l7 = l10.slice(3), dash = `${l10.slice(3, 6)}-${l10.slice(6)}`, dot = `${l10.slice(3, 6)}.${l10.slice(6)}`;
  const preds = fields.flatMap((f) => [`${f} like '%${l7}'`, `${f} like '%${dash}'`, `${f} like '%${dot}'`]);
  // COQL wants binary nesting: every OR must join exactly two parenthesised terms.
  const nest = (xs: string[]): string => xs.length === 1 ? xs[0] : `(${xs[0]} or ${nest(xs.slice(1))})`;
  return nest(preds);
}

function rowMatches(row: Json, fields: string[], l10: string): boolean {
  return fields.some((f) => last10(row[f]) === l10);
}

async function updateRecords(token: string, module: string, records: Json[]): Promise<Json[]> {
  if (records.length === 0) return [];
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/${module}`, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ data: records, trigger: ["workflow"] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Zoho ${module} PUT failed (${res.status}): ${JSON.stringify(j).slice(0, 400)}`);
  return (j.data ?? []) as Json[];
}

// add_tags is additive (over_write defaults to false), so a rep's other tags
// survive. Sending Tag inside the PUT would replace the whole list.
async function addDncTag(token: string, module: string, ids: string[]): Promise<Json[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/${module}/actions/add_tags`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ tags: [{ name: DNC_TAG }], ids }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Zoho ${module} add_tags failed (${res.status}): ${JSON.stringify(j).slice(0, 400)}`);
  return (j.data ?? []) as Json[];
}

// Zoho datetime: yyyy-MM-ddTHH:mm:ss±HH:mm (UTC offset spelled out, no "Z").
function zohoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const debug = url.searchParams.get("debug") === "1";

  const started = Date.now();
  let stage = "parse";
  const log: Json = { dry_run: dryRun };

  try {
    const body = await readBody(req);
    const activityId = String(body.id ?? body.call_id ?? url.searchParams.get("id") ?? "").trim();
    log.activity_id = activityId || null;
    if (!activityId) return json({ ok: false, stage, error: "missing activity id" }, 400);

    stage = "verify_with_ctm";
    const activity = await fetchCtmActivity(activityId);
    if (!activity) return json({ ok: false, stage, error: "activity not found in CTM" }, 404);

    const reason = optOutReason(activity);
    const l10 = last10(activity.caller_number ?? activity.contact_number ?? activity.caller_number_bare);
    log.reason = reason;
    log.phone_last10 = l10;
    if (debug) {
      log.ctm_activity = {
        keys: Object.keys(activity), type: activity.type, direction: activity.direction,
        tags: activityTags(activity), text: activityText(activity).slice(0, 80),
      };
    }
    if (!reason) {
      await persist({ ...log, status: "rejected", error: "CTM record shows no opt-out (no tag, no STOP text)" });
      return json({ ok: false, stage, error: "not an opt-out per CTM", ...(debug ? log : {}) }, 403);
    }
    if (!l10) return json({ ok: false, stage, error: "no caller number on activity" }, 422);

    stage = "zoho_search";
    const token = await zohoToken();
    const leadFields = ["Phone", "Mobile"];
    const contactFields = ["Phone", "Mobile"];
    const dealFields = ["Phone", "Phone_2", "Phone_3", "Phone_4"];

    const leads = (await coql(token,
      `select id, Full_Name, Phone, Mobile, Lead_Status from Leads where ${phoneClauses(leadFields, l10)} limit 200`,
    )).filter((r) => rowMatches(r, leadFields, l10));
    const contacts = (await coql(token,
      `select id, Full_Name, Phone, Mobile from Contacts where ${phoneClauses(contactFields, l10)} limit 200`,
    )).filter((r) => rowMatches(r, contactFields, l10));

    let deals = (await coql(token,
      `select id, Deal_Name, Phone, Phone_2, Phone_3, Phone_4, Contact_Name from Deals where ${phoneClauses(dealFields, l10)} limit 200`,
    )).filter((r) => rowMatches(r, dealFields, l10));
    // Deals usually carry the phone on the linked Contact, not on the deal.
    for (const c of contacts) {
      const linked = await coql(token, `select id, Deal_Name, Contact_Name from Deals where Contact_Name.id = ${c.id} limit 200`);
      for (const d of linked) if (!deals.some((x) => x.id === d.id)) deals.push(d);
    }

    log.matched = {
      leads: leads.map((r) => ({ id: r.id, name: r.Full_Name })),
      contacts: contacts.map((r) => ({ id: r.id, name: r.Full_Name })),
      deals: deals.map((r) => ({ id: r.id, name: r.Deal_Name })),
    };

    if (dryRun) {
      await persist({ ...log, status: "dry_run" });
      return json({ ok: true, stage: "dry_run", ...log });
    }

    stage = "zoho_write";
    const now = zohoNow();
    const optOut = {
      Text_Opt_Out: true, Email_Opt_Out: true, twiliosmsforzohocrm__SMS_Opt_Out: true,
      Opt_Out_Source: OPT_OUT_SOURCE, Opt_Out_Scope: OPT_OUT_SCOPE, Opt_Out_Date: now,
    };
    const results: Json = {};
    results.leads = await updateRecords(token, "Leads",
      leads.map((r) => ({ id: r.id, ...optOut, Lead_Status: LEAD_DNC_STATUS })));
    results.contacts = await updateRecords(token, "Contacts",
      contacts.map((r) => ({ id: r.id, ...optOut })));
    results.deals = await updateRecords(token, "Deals",
      deals.map((r) => ({ id: r.id, Text_Opt_Out: true, Email_Opt_Out: true, twiliosmsforzohocrm__SMS_Opt_Out: true })));
    results.tags = {
      leads: await addDncTag(token, "Leads", leads.map((r) => String(r.id))),
      contacts: await addDncTag(token, "Contacts", contacts.map((r) => String(r.id))),
      deals: await addDncTag(token, "Deals", deals.map((r) => String(r.id))),
    };

    const failures = ["leads", "contacts", "deals"]
      .flatMap((m) => (results[m] as Json[]).filter((x) => x.code !== "SUCCESS").map((x) => ({ module: m, ...x })));
    log.write_results = results;
    await persist({ ...log, status: failures.length ? "partial" : "success", error: failures.length ? JSON.stringify(failures).slice(0, 500) : null });

    return json({
      ok: failures.length === 0, stage: "done", ms: Date.now() - started,
      reason, phone_last10: l10, matched: log.matched, failures,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persist({ ...log, status: "error", error: `${stage}: ${message}` });
    return json({ ok: false, stage, error: message }, 500);
  }
});

async function persist(row: Json): Promise<void> {
  const { error } = await supabase.from("ctm_opt_out_log").insert({
    activity_id: row.activity_id ?? null,
    phone_last10: row.phone_last10 ?? null,
    reason: row.reason ?? null,
    status: row.status,
    dry_run: row.dry_run ?? false,
    matched: row.matched ?? null,
    write_results: row.write_results ?? null,
    error: row.error ?? null,
  });
  if (error) console.error("ctm_opt_out_log insert failed", error.message);
}
