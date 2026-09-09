// admin-invite-user — invite a teammate via Supabase Auth's magic-link
// flow and provision their public.profiles row in one step.
//
// Caller must be authenticated AND have role='admin' on their profile.
// We re-verify that server-side (not just on the frontend) so a
// non-admin can't bypass the UI by hitting the function directly.
//
// Flow:
//   1. Verify caller's JWT + role.
//   2. Call supabase.auth.admin.inviteUserByEmail with full_name + role
//      packed into user_metadata. Supabase fires the magic-link email.
//   3. The handle_new_user() trigger on auth.users INSERT picks up the
//      metadata and creates a profiles row with the right role + name.
//      We don't need to write to profiles directly — the trigger has it.
//   4. Return the new user's id + the profile row so the frontend
//      refresh shows the invitee immediately.
//
// Request:  { email: string, full_name: string, role: 'specialist'|'manager'|'admin' }
// Response: { ok, user_id, profile }

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
    // explicitly: with no argument gotrue-js looks for a *stored*
    // session, and edge functions run with persistSession: false, so it
    // finds none. (The earlier version instead built a second client
    // with the caller's JWT in `global.headers.authorization` — that
    // collides with the service-role `Authorization` header the auth
    // client sets for itself, and every caller, admin or not, came back
    // as no-user → 401 "unauthorized". Invites never worked.)
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userJwt) return jsonResponse({ ok: false, error: "missing auth" }, 401);
    const { data: { user }, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: `unauthorized${userErr ? `: ${userErr.message}` : ""}` }, 401);
    }

    // Verify caller is admin. Read directly via service role since
    // we don't want to depend on RLS for an auth check.
    const { data: callerProfile, error: profErr } = await supa
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr || !callerProfile) return jsonResponse({ ok: false, error: "caller has no profile" }, 403);
    if (!callerProfile.is_active) return jsonResponse({ ok: false, error: "caller is inactive" }, 403);
    if (callerProfile.role !== "admin") return jsonResponse({ ok: false, error: "admin role required" }, 403);

    // Validate inputs.
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "specialist";
    if (!email || !/.+@.+\..+/.test(email)) {
      return jsonResponse({ ok: false, error: "valid email required" }, 400);
    }
    if (!fullName) {
      return jsonResponse({ ok: false, error: "full_name required" }, 400);
    }
    if (!VALID_ROLES.has(role)) {
      return jsonResponse({ ok: false, error: `role must be one of ${[...VALID_ROLES].join("|")}` }, 400);
    }

    // Send the magic-link invite. The handle_new_user trigger will pick
    // up full_name + role from user_metadata when the auth.users row
    // is created.
    const { data: invited, error: inviteErr } = await (supa.auth.admin as any).inviteUserByEmail(email, {
      data: { full_name: fullName, role },
    });
    if (inviteErr) {
      // Most common case: user already exists. Surface that cleanly.
      const msg = inviteErr.message ?? String(inviteErr);
      const alreadyExists = /already|registered|exists/i.test(msg);
      return jsonResponse({
        ok: false,
        error: alreadyExists
          ? "A user with that email already exists. Use the role picker on the existing row to update them."
          : `invite failed: ${msg}`,
      }, alreadyExists ? 409 : 500);
    }
    const newUserId = invited?.user?.id ?? null;
    if (!newUserId) return jsonResponse({ ok: false, error: "invite returned no user id" }, 500);

    // The trigger should have created the profile by now; fetch it
    // to return to the caller. If for any reason it didn't (trigger
    // misbehaving), fall back to inserting it directly so the new
    // user can still log in.
    let { data: profile } = await supa
      .from("profiles")
      .select("*")
      .eq("id", newUserId)
      .maybeSingle();
    if (!profile) {
      const { data: inserted, error: insErr } = await supa
        .from("profiles")
        .insert({
          id: newUserId,
          role,
          full_name: fullName,
          email,
          is_active: true,
        })
        .select()
        .single();
      if (insErr) {
        return jsonResponse({ ok: true, user_id: newUserId, profile: null, warning: `profile not auto-created: ${insErr.message}` });
      }
      profile = inserted;
    }

    return jsonResponse({ ok: true, user_id: newUserId, profile });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
