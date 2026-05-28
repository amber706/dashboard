// reporting-sync-users — Phase 1B sync edge function.
//
// Pulls active Zoho CRM users and upserts:
//   1. reporting.raw_zoho_crm_users  (raw payload)
//   2. reporting.user_identity       (normalized: zoho_user_id, full_name,
//                                     email, profile_name, role_derived)
//
// Trigger: scheduled (07:15 UTC = 00:15 Phoenix per the Phase 1B cron in
// supabase/migrations/140_cron_schedule.sql). Idempotent — re-running
// produces no duplicates.
//
// Returns JSON summary: { ok, run_id, users_pulled, users_upserted }.

import {
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  profileToRepRole,
  startSyncRun,
  supa,
  upsertRaw,
  ZOHO_API_DOMAIN,
} from "./_shared/reporting-sync.ts";

interface ZohoUser {
  id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile?: { name: string; id: string };
  status?: string;
  confirm?: boolean;
  Modified_Time?: string;
  type__s?: string;
}

async function fetchAllActiveUsers(token: string): Promise<ZohoUser[]> {
  const out: ZohoUser[] = [];
  let page = 1;
  while (page <= 20) {
    const res = await fetch(
      `${ZOHO_API_DOMAIN}/crm/v6/users?type=ActiveUsers&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Zoho users fetch failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const j = await res.json();
    const users = (j.users ?? []) as ZohoUser[];
    out.push(...users);
    if (!j.info?.more_records) break;
    page++;
  }
  return out;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ ok: false, error: "method not allowed" }, 405);
  }

  const run = await startSyncRun("reporting-sync-users", "zoho_crm.users");

  try {
    const token = await getZohoToken();
    const users = await fetchAllActiveUsers(token);

    // 1. Raw mirror upsert
    const rawRows = users.map((u) => ({
      source_id: u.id,
      source_modified_at: u.Modified_Time ?? null,
      raw_payload: u,
    }));
    await upsertRaw("raw_zoho_crm_users", rawRows);

    // 2. Normalized user_identity upsert
    const normalizedRows = users.map((u) => {
      const profileName = u.profile?.name ?? null;
      const joinedName = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      const fullName = u.full_name || joinedName || u.email || u.id;
      return {
        zoho_user_id: u.id,
        full_name: fullName,
        email: u.email ?? null,
        profile_name: profileName,
        role_derived: profileToRepRole(profileName),
        active: u.status === "active",
        updated_at: new Date().toISOString(),
      };
    });

    // Upsert chunk-by-chunk on zoho_user_id
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < normalizedRows.length; i += CHUNK) {
      const slice = normalizedRows.slice(i, i + CHUNK);
      const { error } = await supa()
        .schema("reporting")
        .from("user_identity")
        .upsert(slice, { onConflict: "zoho_user_id" });
      if (error) throw new Error(`user_identity upsert failed: ${error.message}`);
      upserted += slice.length;
    }

    // TODO: link user_identity rows to Supabase auth.users by lowercased
    // email match. Deferred to a follow-up migration that defines a
    // reporting.link_user_identity_to_auth() RPC. Until that lands,
    // supabase_auth_user_id stays NULL and RLS effectively scopes
    // admissions_rep/bd_rep users to nothing — fine for chunk 2 where
    // the only consumer is service_role (sync functions and the future
    // op_metric builder). Phase 1C is where we wire RLS to real users.

    await finishSyncRun(run, {
      status: "success",
      rowsProcessed: upserted,
    });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      users_pulled: users.length,
      users_upserted: upserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, {
      status: "failure",
      rowsProcessed: 0,
      errorMessage: msg,
    });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
