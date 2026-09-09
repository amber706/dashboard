// bd-meeting-write — create or update a BD meeting in two-way sync.
// Phase 4 of the BD module.
//
// Write path:
//   1. UPSERT into public.meeting_records with sync_status='pending_*'.
//   2. Push to Zoho (POST /crm/v6/Events for create, PUT for update).
//   3. On success: UPDATE meeting_records → sync_status='synced',
//      stamp last_synced_at, store the returned zoho_event_id.
//   4. On failure: leave sync_status as pending_* and write sync_error
//      so a future retry can pick it up.
//
// Either the local INSERT or the Zoho push succeeds independently —
// we always return the local row's id even if the Zoho push fails, so
// the user can see their scheduled meeting (with a "sync error" badge)
// and retry later. This is intentional: nothing is more frustrating
// than scheduling a meeting and seeing it disappear because Zoho was
// flaky.
//
// Request shapes:
//   create:  { action: "create", title, start_at, end_at?, description?,
//              venue?, account_zoho_id?, account_name?, contact_zoho_id?,
//              contact_name?, deal_zoho_id?, deal_name?, zoho_owner_id? }
//   update:  { action: "update", id, ...same fields, all optional }
//
// Response: { ok, id, zoho_event_id, sync_status, sync_error?, record }

import { corsHeaders, handleCorsPreflight } from "./_shared/cors.ts";
import { getZohoToken, getLastZohoFailureReason } from "./_shared/zoho.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

const ZOHO_API_DOMAIN = Deno.env.get("ZOHO_API_DOMAIN") ?? "https://www.zohoapis.com";

interface MeetingPayload {
  title?: string;
  description?: string | null;
  start_at?: string;          // ISO timestamp
  end_at?: string | null;
  venue?: string | null;
  account_zoho_id?: string | null;
  account_name?: string | null;
  contact_zoho_id?: string | null;
  contact_name?: string | null;
  deal_zoho_id?: string | null;
  deal_name?: string | null;
  zoho_owner_id?: string | null;
}

Deno.serve(async (req) => {
  const _pre = handleCorsPreflight(req);
  if (_pre) return _pre;
  try {
    const body = await req.json();
    const action = body.action;
    if (action !== "create" && action !== "update") {
      return jsonResponse({ ok: false, error: "action must be 'create' or 'update'" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return jsonResponse({ ok: false, error: "supabase env not configured" }, 500);
    }
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Resolve the calling user from the bearer token so we can stamp
    // created_by and (on create) default owner_id to the caller. RLS is
    // bypassed here because we use the service role — but we still want
    // a real auth.uid() for the audit columns.
    //
    // The token MUST be passed to getUser() explicitly. The earlier
    // version built a second client with the JWT in
    // `global.headers.authorization` and called getUser() with no
    // argument — gotrue-js then looks for a *stored session*, finds
    // none (persistSession: false), and that header also collides with
    // the service-role Authorization header the auth client sets for
    // itself. Every caller came back as no-user, so scheduling a
    // meeting always failed with 401 "unauthorized".
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userJwt) return jsonResponse({ ok: false, error: "missing auth" }, 401);
    const { data: { user }, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: `unauthorized${userErr ? `: ${userErr.message}` : ""}` }, 401);
    }

    // Step 1 — UPSERT into meeting_records with sync_status pending_*.
    // We do this BEFORE pushing to Zoho so the row exists even if
    // Zoho is down. The frontend will see a "sync error" badge until
    // the retry succeeds.
    const payload = body as MeetingPayload & { action: "create" | "update"; id?: string };

    let recordId: string | null = null;
    let existingZohoId: string | null = null;

    if (action === "update") {
      if (!payload.id) return jsonResponse({ ok: false, error: "id required for update" }, 400);
      const { data: existing, error: fetchErr } = await supa
        .from("meeting_records")
        .select("id, zoho_event_id")
        .eq("id", payload.id)
        .maybeSingle();
      if (fetchErr || !existing) return jsonResponse({ ok: false, error: "meeting not found" }, 404);
      recordId = existing.id;
      existingZohoId = existing.zoho_event_id;

      const { error: updateErr } = await supa
        .from("meeting_records")
        .update({
          title:            payload.title,
          description:      payload.description,
          start_at:         payload.start_at,
          end_at:           payload.end_at,
          venue:            payload.venue,
          account_zoho_id:  payload.account_zoho_id,
          account_name:     payload.account_name,
          contact_zoho_id:  payload.contact_zoho_id,
          contact_name:     payload.contact_name,
          deal_zoho_id:     payload.deal_zoho_id,
          deal_name:        payload.deal_name,
          zoho_owner_id:    payload.zoho_owner_id,
          sync_status:      existingZohoId ? "pending_zoho_update" : "pending_zoho_create",
          sync_error:       null,
        })
        .eq("id", recordId);
      if (updateErr) return jsonResponse({ ok: false, error: `local update failed: ${updateErr.message}` }, 500);
    } else {
      // create
      if (!payload.title || !payload.start_at) {
        return jsonResponse({ ok: false, error: "title and start_at are required" }, 400);
      }
      // Map auth user id → profile id (they're 1:1 in this schema).
      const { data: insert, error: insertErr } = await supa
        .from("meeting_records")
        .insert({
          title:            payload.title,
          description:      payload.description,
          start_at:         payload.start_at,
          end_at:           payload.end_at,
          venue:            payload.venue,
          account_zoho_id:  payload.account_zoho_id,
          account_name:     payload.account_name,
          contact_zoho_id:  payload.contact_zoho_id,
          contact_name:     payload.contact_name,
          deal_zoho_id:     payload.deal_zoho_id,
          deal_name:        payload.deal_name,
          owner_id:         user.id,
          zoho_owner_id:    payload.zoho_owner_id,
          created_by:       user.id,
          sync_status:      "pending_zoho_create",
        })
        .select("id")
        .single();
      if (insertErr || !insert) return jsonResponse({ ok: false, error: `local insert failed: ${insertErr?.message ?? "unknown"}` }, 500);
      recordId = insert.id;
    }

    // Step 2 — Push to Zoho. If we don't have a token, mark the row as
    // sync_error and return success on the local write — the user can
    // retry later. The frontend shows the badge.
    const token = await getZohoToken();
    if (!token) {
      const reason = getLastZohoFailureReason();
      await supa.from("meeting_records").update({
        sync_error: `zoho not configured${reason ? ` — ${reason}` : ""}`,
        last_sync_attempt_at: new Date().toISOString(),
      }).eq("id", recordId);
      const { data: row } = await supa.from("meeting_records").select("*").eq("id", recordId).maybeSingle();
      return jsonResponse({ ok: true, id: recordId, zoho_event_id: null, sync_status: row?.sync_status, sync_error: row?.sync_error, record: row });
    }

    // Build the Zoho Event payload. What_Id can point at Account, Deal,
    // or Contact — we prefer account, then deal, then contact. Who_Id
    // is the contact (the person being met with).
    const zohoEvent: any = {
      Event_Title: payload.title,
      Description: payload.description ?? undefined,
      Start_DateTime: payload.start_at,
      End_DateTime: payload.end_at ?? undefined,
      Venue: payload.venue ?? undefined,
    };
    if (payload.account_zoho_id) zohoEvent.What_Id = { id: payload.account_zoho_id };
    else if (payload.deal_zoho_id) zohoEvent.What_Id = { id: payload.deal_zoho_id };
    if (payload.contact_zoho_id) zohoEvent.Who_Id = { id: payload.contact_zoho_id };
    if (payload.zoho_owner_id) zohoEvent.Owner = { id: payload.zoho_owner_id };

    const url = existingZohoId
      ? `${ZOHO_API_DOMAIN}/crm/v6/Events/${existingZohoId}`
      : `${ZOHO_API_DOMAIN}/crm/v6/Events`;
    const method = existingZohoId ? "PUT" : "POST";
    const zohoRes = await fetch(url, {
      method,
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: [zohoEvent] }),
    });

    let zohoEventId = existingZohoId;
    let syncStatus = "synced";
    let syncError: string | null = null;

    if (zohoRes.ok) {
      const zohoBody = await zohoRes.json();
      const result = zohoBody?.data?.[0];
      if (result?.code === "SUCCESS" || result?.status === "success") {
        zohoEventId = result.details?.id ?? existingZohoId;
      } else {
        syncStatus = action === "update" ? "pending_zoho_update" : "pending_zoho_create";
        syncError = `zoho rejected: ${JSON.stringify(result).slice(0, 400)}`;
      }
    } else {
      const text = await zohoRes.text().catch(() => "");
      syncStatus = action === "update" ? "pending_zoho_update" : "pending_zoho_create";
      syncError = `zoho ${zohoRes.status}: ${text.slice(0, 400)}`;
    }

    // Step 3 — Reflect Zoho's verdict back to the local row.
    await supa.from("meeting_records").update({
      zoho_event_id:        zohoEventId,
      sync_status:          syncStatus,
      sync_error:           syncError,
      last_synced_at:       syncStatus === "synced" ? new Date().toISOString() : undefined,
      last_sync_attempt_at: new Date().toISOString(),
    }).eq("id", recordId);

    const { data: finalRow } = await supa.from("meeting_records").select("*").eq("id", recordId).maybeSingle();
    return jsonResponse({
      ok: true,
      id: recordId,
      zoho_event_id: zohoEventId,
      sync_status: syncStatus,
      sync_error: syncError,
      record: finalRow,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
