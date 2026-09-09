// Sync CTM agent presence into profiles.availability_status.
//
// CTM exposes per-user presence at GET /accounts/{id}/users. The status
// values from CTM (online / on_call / away / offline / busy / wrap_up)
// map cleanly to our rep_availability enum, so this is a thin polling
// shim — pull every minute via pg_cron, mirror status to profiles.
//
// Required Supabase secrets:
//   CTM_API_TOKEN     — base64 "access_key:secret_key" or a bearer token
//                       depending on how the account is configured. We
//                       attach it as Basic auth.
//   CTM_ACCOUNT_ID    — numeric account id (Cornerstone is 388272)
//
// Matching strategy:
//   1. profiles.ctm_user_id literal match (preferred — set on first sync)
//   2. profiles.email match against CTM user email
//   3. profiles.full_name match against CTM user name
// First sync also backfills profiles.ctm_user_id when matched by email/name.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// CTM_API_TOKEN is base64("access_key:secret_key"). That combined secret was never
// set on this project, so the function sat inert for months (1,440 no-op runs/day)
// even though CTM_ACCESS_KEY and CTM_SECRET_KEY were both present and working —
// the CTM Scoring Bot project builds its Basic header from exactly this pair. Derive
// it here rather than storing the same credential a third time under a third name.
// An explicit CTM_API_TOKEN still wins if one is ever set.
const CTM_ACCESS_KEY = Deno.env.get("CTM_ACCESS_KEY");
const CTM_SECRET_KEY = Deno.env.get("CTM_SECRET_KEY");
const CTM_API_TOKEN = Deno.env.get("CTM_API_TOKEN")
  ?? (CTM_ACCESS_KEY && CTM_SECRET_KEY ? btoa(`${CTM_ACCESS_KEY}:${CTM_SECRET_KEY}`) : undefined);
const CTM_ACCOUNT_ID = Deno.env.get("CTM_ACCOUNT_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// CTM user.status string -> our rep_availability enum.
//
// CTM returns plenty of variations; map the common ones and fall back to
// "offline" for anything we don't recognize so a typo on CTM's side
// doesn't poison the floor view.
function mapStatus(raw: unknown): "available" | "on_call" | "away" | "offline" | "busy" | "wrap_up" {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "online" || v === "available" || v === "ready" || v === "active") return "available";
  if (v === "on_call" || v === "incall" || v === "in_call" || v === "talking") return "on_call";
  if (v === "wrap_up" || v === "wrap" || v === "after_call" || v === "acw") return "wrap_up";
  if (v === "busy" || v === "do_not_disturb" || v === "dnd") return "busy";
  if (v === "away" || v === "break" || v === "lunch" || v === "paused" || v === "on_break") return "away";
  return "offline";
}

interface CtmUser {
  id: string | number;
  name?: string;
  email?: string;
  status?: string;
}

Deno.serve(async (_req) => {
  const _pre = handleCorsPreflight(_req);
  if (_pre) return _pre;
  let stage = "init";
  try {
    if (!CTM_API_TOKEN || !CTM_ACCOUNT_ID) {
      return jsonResponse({
        ok: false,
        error: "CTM credentials not set — need CTM_ACCOUNT_ID plus either CTM_API_TOKEN or the CTM_ACCESS_KEY/CTM_SECRET_KEY pair",
      }, 200); // 200 so cron job doesn't error-spam
    }

    stage = "fetch_ctm_users";
    const url = `https://api.calltrackingmetrics.com/api/v1/accounts/${CTM_ACCOUNT_ID}/users.json`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${CTM_API_TOKEN}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`CTM /users returned ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json = await res.json();
    const users: CtmUser[] = Array.isArray(json) ? json
      : Array.isArray(json.users) ? json.users
      : Array.isArray(json.data) ? json.data
      : [];

    if (users.length === 0) {
      return jsonResponse({ ok: true, ctm_users: 0, updated: 0, note: "CTM returned no users" });
    }

    stage = "load_profiles";
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, ctm_user_id, is_ai_agent")
      .eq("is_active", true)
      .neq("is_ai_agent", true);
    if (profErr) throw new Error(`profiles fetch failed: ${profErr.message}`);

    // Build lookup tables
    const byCtmId = new Map<string, string>();   // ctm_user_id -> profile.id
    const byEmail = new Map<string, string>();   // email -> profile.id
    const byName  = new Map<string, string>();   // full_name (lower) -> profile.id
    for (const p of (profiles ?? []) as any[]) {
      if (p.ctm_user_id) byCtmId.set(String(p.ctm_user_id), p.id);
      if (p.email) byEmail.set(String(p.email).toLowerCase(), p.id);
      if (p.full_name) byName.set(String(p.full_name).toLowerCase(), p.id);
    }

    stage = "update_profiles";
    let updated = 0;
    let backfilledCtmId = 0;
    const nowIso = new Date().toISOString();

    for (const u of users) {
      const ctmId = String(u.id);
      let profileId = byCtmId.get(ctmId) ?? null;
      let needsCtmIdBackfill = false;

      if (!profileId && u.email) {
        const matched = byEmail.get(u.email.toLowerCase());
        if (matched) {
          profileId = matched;
          needsCtmIdBackfill = true;
        }
      }
      if (!profileId && u.name) {
        const matched = byName.get(u.name.toLowerCase());
        if (matched) {
          profileId = matched;
          needsCtmIdBackfill = true;
        }
      }
      if (!profileId) continue; // CTM user we don't have a Cornerstone profile for

      const status = mapStatus(u.status);
      const update: Record<string, unknown> = {
        availability_status: status,
        availability_status_set_at: nowIso,
      };
      if (needsCtmIdBackfill) {
        update.ctm_user_id = ctmId;
        backfilledCtmId++;
      }

      const { error: updErr } = await supabase
        .from("profiles")
        .update(update)
        .eq("id", profileId);
      if (!updErr) updated++;
    }

    // Anyone in profiles not present in the CTM payload is implicitly
    // offline. Set them so the floor view doesn't show stale "available"
    // statuses for people who logged out of CTM.
    stage = "mark_missing_offline";
    const presentProfileIds = new Set<string>();
    for (const u of users) {
      const ctmId = String(u.id);
      const pid = byCtmId.get(ctmId)
        ?? (u.email ? byEmail.get(u.email.toLowerCase()) : undefined)
        ?? (u.name ? byName.get(u.name.toLowerCase()) : undefined);
      if (pid) presentProfileIds.add(pid);
    }
    const missing = ((profiles ?? []) as any[])
      .filter((p) => !presentProfileIds.has(p.id) && !p.is_ai_agent)
      .map((p) => p.id);
    if (missing.length > 0) {
      await supabase
        .from("profiles")
        .update({ availability_status: "offline", availability_status_set_at: nowIso })
        .in("id", missing)
        .neq("availability_status", "offline"); // skip rows already offline
    }

    return jsonResponse({
      ok: true,
      ctm_users: users.length,
      updated,
      backfilled_ctm_id: backfilledCtmId,
      marked_offline: missing.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, stage, error: message }, 500);
  }
});
