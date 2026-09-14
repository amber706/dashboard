// backfill-gclid-to-zoho v14 — v13 PLUS email match, Tier-2 guardian/linked-contact sourcing,
// paginated CTM fetch (fixes silent 1000-row cap), and surfaced CTM-fetch errors + dry_run mode.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCtmIndexes, gatherDealIdentifiers, matchByIdentifiers, last10, normEmail, type PPCBundle } from "./matching.ts";

const corsHeaders: Record<string, string> = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-max-age": "86400" };
function handleCorsPreflight(req: Request): Response | null { if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders }); return null; }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CTM_BOT_SUPABASE_URL = Deno.env.get("CTM_BOT_SUPABASE_URL") ?? "https://fbfhjugvurcqcfaeqpnr.supabase.co";
const CTM_BOT_SERVICE_ROLE_KEY = Deno.env.get("CTM_BOT_SERVICE_ROLE_KEY");

const ZOHO_CLIENT_ID = Deno.env.get("ZOHO_CLIENT_ID");
const ZOHO_CLIENT_SECRET = Deno.env.get("ZOHO_CLIENT_SECRET");
const ZOHO_REFRESH_TOKEN = Deno.env.get("ZOHO_REFRESH_TOKEN");
const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";
const ZOHO_ACCOUNTS_DOMAIN = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") ?? "https://accounts.zoho.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ctmBot = CTM_BOT_SERVICE_ROLE_KEY ? createClient(CTM_BOT_SUPABASE_URL, CTM_BOT_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const DEFAULT_LOOKBACK_DAYS = 90;
const LEAD_FETCH_LIMIT = 1000;
const CTM_FETCH_LIMIT = 5000;
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders } }); }
function toZohoDate(iso: string): string { return iso.slice(0, 10); }

async function getZohoAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) throw new Error("ZOHO secrets not set");
  const body = new URLSearchParams({ refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: "refresh_token" });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (!res.ok) throw new Error(`Zoho OAuth refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token as string;
}
async function coql(token: string, query: string): Promise<any[]> {
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/coql`, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" }, body: JSON.stringify({ select_query: query }) });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`Zoho COQL failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data ?? [];
}
async function putRecords(token: string, module: "Contacts" | "Deals" | "Leads", records: Array<Record<string, any>>): Promise<any> {
  if (records.length === 0) return { data: [] };
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v6/${module}`, { method: "PUT", headers: { Authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" }, body: JSON.stringify({ data: records }) });
  const j = await res.json();
  if (!res.ok) throw new Error(`Zoho ${module} PUT failed (${res.status}): ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}
async function writeRecords(token: string, module: "Contacts" | "Deals" | "Leads", records: Array<Record<string, any>>, dryRun: boolean): Promise<any> {
  if (dryRun) return { data: records.map(() => ({ code: "SUCCESS" })) };
  return await putRecords(token, module, records);
}

async function paginateModule(token: string, module: "Contacts" | "Leads" | "Deals", selectFields: string, whereClause: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const q = `select ${selectFields} from ${module} where ${whereClause} order by Created_Time desc limit ${PAGE_SIZE} offset ${offset}`;
    let rows: any[] = [];
    try { rows = await coql(token, q); } catch (err) { console.error(`paginate ${module} page ${p}:`, err instanceof Error ? err.message : String(err)); break; }
    if (rows.length === 0) break;
    all.push(...rows);
    offset += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

Deno.serve(async (req) => {
  const _pre = handleCorsPreflight(req);
  if (_pre) return _pre;
  let stage = "init";
  try {
    if (req.method !== "POST") return jsonResponse({ ok: false, error: "method not allowed" }, 405);
    if (!ctmBot) return jsonResponse({ ok: false, error: "CTM_BOT_SERVICE_ROLE_KEY not set" }, 500);

    const body = await req.json().catch(() => ({}));
    const lookbackDays = Number(body.lookback_days ?? DEFAULT_LOOKBACK_DAYS);
    const topupOnly: boolean = body.topup_only === true;
    const dryRun: boolean = body.dry_run === true;

    const token = await getZohoAccessToken();
    const logRows: any[] = [];
    const contactIdsWithGclid: Array<{ id: string; gclid: string }> = [];

    let step1Recovered = 0, step1SkippedAlreadyHas = 0;
    let step2aRecovered = 0;
    let step2bRecovered = 0, step2bPpcFieldsWritten = 0;
    let step2cRecovered = 0;
    const step2cByMethod: Record<string, number> = {};
    let step3DealsPropagated = 0;

    // Always pull CTM GCLID calls first. Paginate with .range(): PostgREST caps each
    // response at max-rows (1000 on this project), so a single .limit(5000) silently
    // returns only 1000. Surface fetch errors instead of swallowing them (a swallowed
    // error would make the whole run silently recover nothing).
    stage = "fetch_ctm_gclids";
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const ctmCalls: any[] = [];
    for (let from = 0; from < CTM_FETCH_LIMIT; from += 1000) {
      const { data, error } = await ctmBot.from("ctm_call")
        .select("call_id, caller_number, raw_payload, received_at")
        .gte("received_at", since)
        .not("raw_payload->ga->>gclid", "is", null)
        .order("received_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(`CTM ctm_call fetch failed (range ${from}): ${error.message}`);
      if (!data || data.length === 0) break;
      ctmCalls.push(...data);
      if (data.length < 1000) break;
    }
    const { byPhone: ctmP10Map, byEmail: ctmEmailMap } = buildCtmIndexes(ctmCalls);

    if (!topupOnly) {
      stage = "step1_converted_leads";
      const leadContactMap = new Map<string, { lead_id: string; gclid: string }>();
      for (const q of [
        `select id, GCLID, Converted_Contact from Leads where GCLID is not null and Converted__s = true limit ${LEAD_FETCH_LIMIT}`,
        `select id, GCLID1, Converted_Contact from Leads where GCLID1 is not null and Converted__s = true limit ${LEAD_FETCH_LIMIT}`,
      ]) {
        try {
          const rows = await coql(token, q);
          for (const r of rows) {
            const gclid = r.GCLID1 ?? r.GCLID ?? null;
            const contactId = r.Converted_Contact?.id ?? null;
            if (gclid && contactId && !leadContactMap.has(contactId)) leadContactMap.set(contactId, { lead_id: r.id, gclid: String(gclid) });
          }
        } catch (err) { console.error("step1:", err instanceof Error ? err.message : String(err)); }
      }
      if (leadContactMap.size > 0) {
        const ids = Array.from(leadContactMap.keys());
        const alreadyHas = new Set<string>();
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50).map((id) => `'${id}'`).join(",");
          try {
            const rows = await coql(token, `select id, Recovered_GCLID, GCLID from Contacts where id in (${chunk})`);
            for (const r of rows) if (r.Recovered_GCLID || r.GCLID) alreadyHas.add(r.id);
          } catch (err) { console.error("step1 existing:", err instanceof Error ? err.message : String(err)); }
        }
        const updates = Array.from(leadContactMap.entries()).filter(([cid]) => !alreadyHas.has(cid)).map(([cid, v]) => ({ id: cid, Recovered_GCLID: v.gclid }));
        step1SkippedAlreadyHas = leadContactMap.size - updates.length;
        for (let i = 0; i < updates.length; i += 100) {
          const batch = updates.slice(i, i + 100);
          try {
            const resp = await writeRecords(token, "Contacts", batch, dryRun);
            const results = resp.data ?? [];
            for (let j = 0; j < batch.length; j++) {
              const success = results[j]?.code === "SUCCESS";
              logRows.push({ zoho_module: "Contacts", zoho_record_id: batch[j].id, matched_gclid: batch[j].Recovered_GCLID, match_method: "converted_lead_direct", zoho_write_status: success ? "success" : "failed" });
              if (success) { step1Recovered++; contactIdsWithGclid.push({ id: batch[j].id, gclid: batch[j].Recovered_GCLID }); }
            }
          } catch (err) { console.error("step1 update:", err instanceof Error ? err.message : String(err)); }
        }
      }

      stage = "step2a_ctm_to_contact";
      const contactRows = await paginateModule(token, "Contacts", "id, Phone, Email, GCLID", "Recovered_GCLID is null");
      const contactPhoneMap = new Map<string, string>();
      for (const r of contactRows) {
        if (r.GCLID || !r.Phone) continue;
        const p10 = last10(r.Phone);
        if (p10 && !contactPhoneMap.has(p10)) contactPhoneMap.set(p10, r.id);
      }
      const contactEmailMap = new Map<string, string>(); // normalized email -> contact id
      for (const r of contactRows) {
        if (r.GCLID || !r.Email) continue;
        const em = normEmail(r.Email);
        if (em && !contactEmailMap.has(em)) contactEmailMap.set(em, r.id);
      }
      const contactMatched = new Map<string, { gclid: string; call_id: string; method: string }>();
      for (const [p10, info] of ctmP10Map) { const cid = contactPhoneMap.get(p10); if (cid && !contactMatched.has(cid)) contactMatched.set(cid, { gclid: info.gclid, call_id: info.call_id, method: "ctm_call_to_contact" }); }
      for (const [em, info] of ctmEmailMap) { const cid = contactEmailMap.get(em); if (cid && !contactMatched.has(cid)) contactMatched.set(cid, { gclid: info.gclid, call_id: info.call_id, method: "ctm_call_to_contact_email" }); }
      const contactUpdates = Array.from(contactMatched.entries()).map(([id, m]) => ({ id, Recovered_GCLID: m.gclid, call_id: m.call_id, method: m.method }));
      for (let i = 0; i < contactUpdates.length; i += 100) {
        const batch = contactUpdates.slice(i, i + 100).map(({ id, Recovered_GCLID }) => ({ id, Recovered_GCLID }));
        try {
          const resp = await writeRecords(token, "Contacts", batch, dryRun);
          const results = resp.data ?? [];
          for (let j = 0; j < batch.length; j++) {
            const meta = contactUpdates[i + j];
            const success = results[j]?.code === "SUCCESS";
            logRows.push({ zoho_module: "Contacts", zoho_record_id: meta.id, matched_call_id: meta.call_id, matched_gclid: meta.Recovered_GCLID, match_method: meta.method, zoho_write_status: success ? "success" : "failed" });
            if (success) { step2aRecovered++; contactIdsWithGclid.push({ id: meta.id, gclid: meta.Recovered_GCLID }); }
          }
        } catch (err) { console.error("step2a update:", err instanceof Error ? err.message : String(err)); }
      }

      stage = "step2b_ctm_to_lead_unrecovered";
      const leadRows = await paginateModule(token, "Leads", "id, Phone, Mobile, Email, GCLID, GCLID1, Paid_Keywords, Campaign_ID", "Recovered_GCLID is null");
      type LeadMeta = { id: string; has_gclid: boolean; has_keyword: boolean; has_campaign: boolean; has_adgroup: boolean; has_click_date: boolean };
      const leadInfoMap = new Map<string, LeadMeta>();
      const leadEmailInfoMap = new Map<string, LeadMeta>();
      for (const r of leadRows) {
        if (r.GCLID || r.GCLID1) continue;
        const lm: LeadMeta = { id: r.id, has_gclid: Boolean(r.GCLID || r.GCLID1), has_keyword: Boolean(r.Paid_Keywords), has_campaign: Boolean(r.Campaign_ID), has_adgroup: true, has_click_date: true };
        const p10 = last10(r.Phone) ?? last10(r.Mobile);
        if (p10 && !leadInfoMap.has(p10)) leadInfoMap.set(p10, lm);
        const em = normEmail(r.Email);
        if (em && !leadEmailInfoMap.has(em)) leadEmailInfoMap.set(em, lm);
      }
      const leadUpdates: Array<{ rec: Record<string, any>; meta: { id: string; call_id: string; gclid: string; ppc_fields_added: number; method: string } }> = [];
      const leadMatched = new Set<string>();
      const buildLeadUpdate = (lead: LeadMeta, info: PPCBundle, method: string) => {
        if (leadMatched.has(lead.id)) return;
        leadMatched.add(lead.id);
        const rec: Record<string, any> = { id: lead.id, Recovered_GCLID: info.gclid };
        let ppcCount = 0;
        // Only GCLID, Paid_Keywords, Campaign_ID and Recovered_GCLID are writable on Leads.
        // GCLID1 ("GCLID"), Keyword, ADGROUPID and Ad_Click_Date are field_read_only=true —
        // Zoho accepts the record update, returns SUCCESS, and silently discards them. See
        // the header note; writing them was a no-op that also drove an infinite re-match loop.
        if (!lead.has_gclid) { rec.GCLID = info.gclid; ppcCount++; }
        if (!lead.has_keyword && info.keyword) { rec.Paid_Keywords = info.keyword; ppcCount++; }
        if (!lead.has_campaign && info.campaign_id) { rec.Campaign_ID = info.campaign_id; ppcCount++; }
        leadUpdates.push({ rec, meta: { id: lead.id, call_id: info.call_id, gclid: info.gclid, ppc_fields_added: ppcCount, method } });
      };
      for (const [p10, info] of ctmP10Map) { const lead = leadInfoMap.get(p10); if (lead) buildLeadUpdate(lead, info, "ctm_call_to_lead"); }
      for (const [em, info] of ctmEmailMap) { const lead = leadEmailInfoMap.get(em); if (lead) buildLeadUpdate(lead, info, "ctm_call_to_lead_email"); }
      for (let i = 0; i < leadUpdates.length; i += 100) {
        const batch = leadUpdates.slice(i, i + 100);
        try {
          const resp = await writeRecords(token, "Leads", batch.map(x => x.rec), dryRun);
          const results = resp.data ?? [];
          for (let j = 0; j < batch.length; j++) {
            const meta = batch[j].meta;
            const success = results[j]?.code === "SUCCESS";
            logRows.push({ zoho_module: "Leads", zoho_record_id: meta.id, matched_call_id: meta.call_id, matched_gclid: meta.gclid, match_method: meta.method, zoho_write_status: success ? "success" : "failed", ppc_fields_added: meta.ppc_fields_added });
            if (success) { step2bRecovered++; step2bPpcFieldsWritten += meta.ppc_fields_added; }
          }
        } catch (err) { console.error("step2b update:", err instanceof Error ? err.message : String(err)); }
      }

      stage = "step2c_ctm_to_deal";
      const dealRows = await paginateModule(token, "Deals", "id, Phone, Phone_2, Phone_3, Phone_4, Emergency_Contact_Phone_Number, Email, Contact_Name", "Recovered_GCLID is null");
      const linkedContactIds = Array.from(new Set(dealRows.map((d: any) => d.Contact_Name?.id).filter(Boolean)));
      const contactById = new Map<string, any>();
      for (let i = 0; i < linkedContactIds.length; i += 50) {
        const chunk = linkedContactIds.slice(i, i + 50).map((id: string) => `'${id}'`).join(",");
        if (!chunk) continue;
        try {
          const rows = await coql(token, `select id, Phone, Mobile, Home_Phone, Other_Phone, Emergency_Contact_Phone_Number, Email from Contacts where id in (${chunk})`);
          for (const r of rows) contactById.set(r.id, r);
        } catch (err) { console.error("step2c linked-contact fetch:", err instanceof Error ? err.message : String(err)); }
      }
      const idx = { byPhone: ctmP10Map, byEmail: ctmEmailMap };
      const dealUpdatesDirect: Array<{ id: string; Recovered_GCLID: string; call_id: string; method: string }> = [];
      for (const d of dealRows as any[]) {
        const linked = d.Contact_Name?.id ? contactById.get(d.Contact_Name.id) : null;
        const ids = gatherDealIdentifiers(d, linked);
        const m = matchByIdentifiers(ids, idx);
        if (!m) continue;
        // "direct" = the same gclid is reachable from one of the deal's OWN identifiers
        // (any own phone or own email); "guardian" = only reachable via the linked contact.
        const ownMatch = matchByIdentifiers(gatherDealIdentifiers(d, null), idx);
        const method = m.via === "email"
          ? "ctm_call_to_deal_email"
          : (ownMatch?.bundle.gclid === m.bundle.gclid ? "ctm_call_to_deal_direct" : "ctm_call_to_deal_guardian");
        dealUpdatesDirect.push({ id: d.id, Recovered_GCLID: m.bundle.gclid, call_id: m.bundle.call_id, method });
      }
      for (let i = 0; i < dealUpdatesDirect.length; i += 100) {
        const batch = dealUpdatesDirect.slice(i, i + 100).map(({ id, Recovered_GCLID }) => ({ id, Recovered_GCLID }));
        try {
          const resp = await writeRecords(token, "Deals", batch, dryRun);
          const results = resp.data ?? [];
          for (let j = 0; j < batch.length; j++) {
            const meta = dealUpdatesDirect[i + j];
            const success = results[j]?.code === "SUCCESS";
            logRows.push({ zoho_module: "Deals", zoho_record_id: meta.id, matched_call_id: meta.call_id, matched_gclid: meta.Recovered_GCLID, match_method: meta.method, zoho_write_status: success ? "success" : "failed" });
            if (success) { step2cRecovered++; step2cByMethod[meta.method] = (step2cByMethod[meta.method] ?? 0) + 1; }
          }
        } catch (err) { console.error("step2c update:", err instanceof Error ? err.message : String(err)); }
      }

      stage = "step3_propagate_to_deals";
      if (contactIdsWithGclid.length > 0) {
        const gclidByContact = new Map<string, string>();
        for (const c of contactIdsWithGclid) if (!gclidByContact.has(c.id)) gclidByContact.set(c.id, c.gclid);
        const allContactIds = Array.from(gclidByContact.keys());
        for (let i = 0; i < allContactIds.length; i += 50) {
          const chunk = allContactIds.slice(i, i + 50).map((id) => `'${id}'`).join(",");
          const dealsQuery = `select id, Contact_Name from Deals where Recovered_GCLID is null and Contact_Name in (${chunk}) limit 500`;
          let dealsRaw: any[] = [];
          try { dealsRaw = await coql(token, dealsQuery); } catch (err) { console.error("step3 deals:", err instanceof Error ? err.message : String(err)); continue; }
          const dealUpdates: Array<{ id: string; Recovered_GCLID: string }> = [];
          for (const d of dealsRaw) {
            const contactId = d.Contact_Name?.id ?? d.Contact_Name;
            const gclid = gclidByContact.get(contactId);
            if (gclid) dealUpdates.push({ id: d.id, Recovered_GCLID: gclid });
          }
          for (let k = 0; k < dealUpdates.length; k += 100) {
            const batch = dealUpdates.slice(k, k + 100);
            try {
              const resp = await writeRecords(token, "Deals", batch, dryRun);
              const results = resp.data ?? [];
              for (let j = 0; j < batch.length; j++) {
                const success = results[j]?.code === "SUCCESS";
                logRows.push({ zoho_module: "Deals", zoho_record_id: batch[j].id, matched_gclid: batch[j].Recovered_GCLID, match_method: "propagated_contact_to_deal", zoho_write_status: success ? "success" : "failed" });
                if (success) step3DealsPropagated++;
              }
            } catch (err) { console.error("step3 update:", err instanceof Error ? err.message : String(err)); }
          }
        }
      }
    }

    // ========================================================================
    // STEP 2b TOPUP (v13): Leads already recovered but missing PPC fields
    // Scan in two passes for 3-predicate COQL safety.
    // ========================================================================
    stage = "step2b_topup_ppc";
    let topupScanned = 0, topupUpdated = 0, topupFieldsWritten = 0;
    // Filter on Paid_Keywords (writable), NOT Keyword (read-only). Keyword can never be set,
    // so "Keyword is null" matched the same leads on every run, forever.
    const topupLeads = await paginateModule(token, "Leads", "id, Phone, Mobile, GCLID, GCLID1, Recovered_GCLID, Paid_Keywords, Campaign_ID", "Recovered_GCLID is not null and Paid_Keywords is null");
    const topupP10Map = new Map<string, { id: string; has_gclid: boolean; has_keyword: boolean; has_campaign: boolean }>();
    for (const r of topupLeads) {
      topupScanned++;
      const p10 = last10(r.Phone) ?? last10(r.Mobile);
      if (!p10 || topupP10Map.has(p10)) continue;
      topupP10Map.set(p10, { id: r.id, has_gclid: Boolean(r.GCLID || r.GCLID1), has_keyword: Boolean(r.Paid_Keywords), has_campaign: Boolean(r.Campaign_ID) });
    }
    const topupUpdates: Array<{ rec: Record<string, any>; meta: { id: string; call_id: string; gclid: string; ppc_fields_added: number } }> = [];
    for (const [p10, leadMeta] of topupP10Map) {
      const ctm = ctmP10Map.get(p10);
      if (!ctm) continue;
      const rec: Record<string, any> = { id: leadMeta.id };
      let ppcCount = 0;
      // Writable fields only — see block above. The unguarded Keyword write here was the
      // direct cause of the loop: ppcCount was always >= 1, so every matched lead was
      // re-written on every hourly run (~7,600 no-op writes across 172 leads in 2 days).
      if (!leadMeta.has_gclid) { rec.GCLID = ctm.gclid; ppcCount++; }
      if (!leadMeta.has_keyword && ctm.keyword) { rec.Paid_Keywords = ctm.keyword; ppcCount++; }
      if (!leadMeta.has_campaign && ctm.campaign_id) { rec.Campaign_ID = ctm.campaign_id; ppcCount++; }
      if (ppcCount > 0) topupUpdates.push({ rec, meta: { id: leadMeta.id, call_id: ctm.call_id, gclid: ctm.gclid, ppc_fields_added: ppcCount } });
    }
    for (let i = 0; i < topupUpdates.length; i += 100) {
      const batch = topupUpdates.slice(i, i + 100);
      try {
        const resp = await writeRecords(token, "Leads", batch.map(x => x.rec), dryRun);
        const results = resp.data ?? [];
        for (let j = 0; j < batch.length; j++) {
          const meta = batch[j].meta;
          const success = results[j]?.code === "SUCCESS";
          logRows.push({ zoho_module: "Leads", zoho_record_id: meta.id, matched_call_id: meta.call_id, matched_gclid: meta.gclid, match_method: "topup_ctm_ppc_to_lead", zoho_write_status: success ? "success" : "failed", ppc_fields_added: meta.ppc_fields_added });
          if (success) { topupUpdated++; topupFieldsWritten += meta.ppc_fields_added; }
        }
      } catch (err) { console.error("step2b_topup update:", err instanceof Error ? err.message : String(err)); }
    }

    stage = "persist_logs";
    let logInsertError: string | null = null;
    if (!dryRun) {
      for (let i = 0; i < logRows.length; i += 500) {
        const { error } = await supabase.from("gclid_backfill_log").insert(logRows.slice(i, i + 500));
        if (error) { logInsertError = error.message; console.error("log insert:", error.message); }
      }
    }

    return jsonResponse({
      ok: true,
      version: "v14",
      dry_run: dryRun,
      log_insert_error: logInsertError,
      lookback_days: lookbackDays,
      topup_only: topupOnly,
      ctm_phones_with_gclid: ctmP10Map.size,
      ctm_emails_with_gclid: ctmEmailMap.size,
      step1_converted_leads_to_contacts: { contacts_recovered: step1Recovered, already_had_gclid: step1SkippedAlreadyHas },
      step2a_ctm_to_contact: { contacts_recovered: step2aRecovered },
      step2b_ctm_to_lead: { leads_recovered: step2bRecovered, ppc_fields_written: step2bPpcFieldsWritten },
      step2c_ctm_to_deal_direct: { deals_recovered: step2cRecovered, by_method: step2cByMethod },
      step3_propagated_to_deals: step3DealsPropagated,
      step2b_topup_ppc: { topup_leads_scanned: topupScanned, topup_leads_matched_to_ctm: topupUpdates.length, topup_leads_updated: topupUpdated, topup_fields_written: topupFieldsWritten },
      total_records_recovered: step1Recovered + step2aRecovered + step2bRecovered + step2cRecovered + step3DealsPropagated + topupUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
