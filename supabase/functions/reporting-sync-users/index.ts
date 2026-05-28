// reporting-sync-users — Phase 1B sync edge function.
//
// Pulls active Zoho CRM users and upserts:
//   1. reporting.raw_zoho_crm_users  (raw payload)
//   2. reporting.user_identity       (normalized: zoho_user_id, full_name,
//                                     email, profile_name, role_derived)
//
// All writes go through RPCs defined in supabase/migrations/135_sync_rpcs.sql.
// Idempotent — re-running produces no duplicates.

import {
  finishSyncRun,
  getZohoToken,
  handleCorsPreflight,
  jsonResponse,
  profileToRepRole,
  startSyncRun,
  upsertRaw,
  upsertUserIdentity,
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
  Modified_Time?: string;
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

    const rawRows = users.map((u) => ({
      source_id: u.id,
      source_modified_at: u.Modified_Time ?? null,
      raw_payload: u,
    }));
    await upsertRaw("raw_zoho_crm_users", rawRows);

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
      };
    });

    const upserted = await upsertUserIdentity(normalizedRows);

    await finishSyncRun(run, { status: "success", rowsProcessed: upserted });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      users_pulled: users.length,
      users_upserted: upserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
