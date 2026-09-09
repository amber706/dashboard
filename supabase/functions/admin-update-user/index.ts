// admin-update-user — update an existing user's role or active flag.
//
// Caller must be admin. Self-updates ARE allowed for everything except
// role (you can't promote yourself); role changes always go through
// this function instead of through the profiles update RLS path so the
// audit trail flows through one chokepoint.
//
// Request:  { id: string, role?: 'specialist'|'manager'|'admin', is_active?: boolean,
//             full_name?: string, show_in_dashboards?: boolean,
//             is_bd_rep?: boolean, is_admissions_rep?: boolean }
// Response: { ok, profile }

import { corsHeaders, handleCorsPreflight } from "./_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

const VALID_ROLES = new Set(["specialist", "manager", "admin"]);

Deno.serve(async (req) => {
  const _pre = handleCorsPreflight(req);
  if (_pre) return _pre;
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return jsonResponse({ ok: false, error: "supabase env not configured" }, 500);
    }
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Resolve caller from JWT. The token MUST be handed to getUser()
    // explicitly — see the same note in admin-invite-user: with no
    // argument gotrue-js looks for a stored session, finds none under
    // persistSession: false, and every caller came back as no-user.
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userJwt) return jsonResponse({ ok: false, error: "missing auth" }, 401);
    const { data: { user }, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: `unauthorized${userErr ? `: ${userErr.message}` : ""}` }, 401);
    }

    const { data: callerProfile } = await supa
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (!callerProfile) return jsonResponse({ ok: false, error: "caller has no profile" }, 403);
    if (!callerProfile.is_active) return jsonResponse({ ok: false, error: "caller is inactive" }, 403);
    if (callerProfile.role !== "admin") return jsonResponse({ ok: false, error: "admin role required" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetId = typeof body.id === "string" ? body.id : "";
    if (!targetId) return jsonResponse({ ok: false, error: "id required" }, 400);

    if (targetId === user.id && body.role && body.role !== "admin") {
      return jsonResponse({ ok: false, error: "Can't demote yourself out of admin. Ask another admin to do it." }, 400);
    }
    if (targetId === user.id && body.is_active === false) {
      return jsonResponse({ ok: false, error: "Can't deactivate your own account. Ask another admin to do it." }, 400);
    }

    const update: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!VALID_ROLES.has(body.role)) {
        return jsonResponse({ ok: false, error: `role must be one of ${[...VALID_ROLES].join("|")}` }, 400);
      }
      update.role = body.role;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return jsonResponse({ ok: false, error: "is_active must be boolean" }, 400);
      }
      update.is_active = body.is_active;
    }
    if (body.full_name !== undefined) {
      if (typeof body.full_name !== "string" || !body.full_name.trim()) {
        return jsonResponse({ ok: false, error: "full_name must be non-empty string" }, 400);
      }
      update.full_name = body.full_name.trim();
    }
    if (body.show_in_dashboards !== undefined) {
      if (typeof body.show_in_dashboards !== "boolean") {
        return jsonResponse({ ok: false, error: "show_in_dashboards must be boolean" }, 400);
      }
      update.show_in_dashboards = body.show_in_dashboards;
    }
    if (body.is_bd_rep !== undefined) {
      if (typeof body.is_bd_rep !== "boolean") {
        return jsonResponse({ ok: false, error: "is_bd_rep must be boolean" }, 400);
      }
      update.is_bd_rep = body.is_bd_rep;
    }
    if (body.is_admissions_rep !== undefined) {
      if (typeof body.is_admissions_rep !== "boolean") {
        return jsonResponse({ ok: false, error: "is_admissions_rep must be boolean" }, 400);
      }
      update.is_admissions_rep = body.is_admissions_rep;
    }
    if (Object.keys(update).length === 0) {
      return jsonResponse({ ok: false, error: "no fields to update" }, 400);
    }

    const { data: profile, error: updateErr } = await supa
      .from("profiles")
      .update(update)
      .eq("id", targetId)
      .select()
      .single();
    if (updateErr) {
      return jsonResponse({ ok: false, error: `update failed: ${updateErr.message}` }, 500);
    }

    return jsonResponse({ ok: true, profile });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
