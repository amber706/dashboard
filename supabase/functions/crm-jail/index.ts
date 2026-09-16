// CRM Jail audit bot — orchestrator.
//
// Wednesday 09:00 America/Phoenix: audit last Mon-Sun for every active rep,
// file the scorecards in the CRM Audits shared drive, and share each one with
// its auditor so Google sends the notification.
//
// Two failure postures, deliberately different:
//   - One REP failing is recorded and the run continues. A single bad record
//     must not cost the other eight reps their audit.
//   - AUTH failing aborts the whole run. Emitting scorecards that look
//     complete but are empty is the expensive failure mode — it is what made
//     the conversion-push incident costly.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { auditWindowFor, coqlBounds } from "./window.ts";
import { getZohoAccessToken } from "./zoho.ts";
import { getGoogleAccessToken } from "./google-auth.ts";
import { auditRep, type RosterRep } from "./audit-rep.ts";
import { notifyAuditors, shareAndNotify, type RepResult } from "./notify.ts";
import { judgeDiagnostics } from "./notes-judge.ts";
import type { Team } from "./sheets.ts";

const DRIVE_ID = Deno.env.get("CRM_JAIL_DRIVE_ID") ?? "0AHjwwQeACWHRUk9PVA";

/**
 * Loads both taxonomy lookups in one call.
 *
 * Taxonomy literals are never inlined in the rule engine — they come from
 * reporting.stage_mapping and reporting.source_category_mapping. That schema
 * is not exposed through PostgREST, so public.crm_jail_taxonomy() surfaces
 * just those two tables to the service role.
 */
async function loadTaxonomy(supabase: SupabaseClient): Promise<{
  stageCategory: (raw: unknown) => string | null;
  sourceCategory: (raw: unknown) => string | null;
}> {
  const { data, error } = await supabase.rpc("crm_jail_taxonomy");
  if (error) throw new Error(`Could not load taxonomy: ${error.message}`);
  const stage = new Map<string, string>();
  const source = new Map<string, string>();
  for (const row of (data ?? []) as Array<Record<string, string>>) {
    (row.kind === "stage" ? stage : source).set(row.raw_value, row.normalized_value);
  }
  if (stage.size === 0 || source.size === 0) {
    // An empty mapping would silently score every conditional item N/A,
    // excusing exactly the failures the audit exists to catch.
    throw new Error(`Taxonomy came back empty (stage=${stage.size}, source=${source.size})`);
  }
  return {
    stageCategory: (raw) => stage.get(String(raw ?? "")) ?? null,
    sourceCategory: (raw) => source.get(String(raw ?? "")) ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = Boolean(body.dry_run);
  const window = auditWindowFor(body.run_at ? new Date(String(body.run_at)) : new Date());
  const bounds = coqlBounds(window);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });


  // Auth and taxonomy up front: if any of this is broken, produce nothing.
  let zohoToken: string, googleToken: string;
  let stageCategory: (r: unknown) => string | null;
  let sourceCategory: (r: unknown) => string | null;
  try {
    const [zt, gt, tax] = await Promise.all([
      getZohoAccessToken(),
      getGoogleAccessToken(),
      loadTaxonomy(supabase),
    ]);
    zohoToken = zt;
    googleToken = gt;
    stageCategory = tax.stageCategory;
    sourceCategory = tax.sourceCategory;
  } catch (e) {
    return json({ error: "STARTUP_FAILED", detail: String(e), window }, 500);
  }

  const { data: roster, error: rosterErr } = await supabase
    .from("crm_jail_roster").select("*").eq("active", true).order("team").order("full_name");
  if (rosterErr) return json({ error: "ROSTER_FAILED", detail: rosterErr.message }, 500);

  const results: RepResult[] = [];

  for (const row of (roster ?? []) as unknown as Array<RosterRep & { id: string }>) {
    try {
      const r = await auditRep(row, window, bounds, {
        zohoToken, googleToken, driveId: DRIVE_ID, stageCategory, sourceCategory, dryRun,
      });
      results.push({
        rep: r.rep, team: r.team, status: r.status, sheetId: r.sheetId, sheetUrl: r.sheetUrl,
        deferredCells: r.deferredCells, auditorEmail: r.auditorEmail,
      });
      if (!dryRun) await recordRun(supabase, window, row, r.status, r.sheetId, r.sheetUrl, r.deferredCells, null);
    } catch (e) {
      const msg = String(e);
      // The token died mid-run. Stop rather than finish with empty scorecards.
      if (msg.includes("ZOHO_AUTH_FAILED") || msg.includes("GOOGLE_AUTH_FAILED")) {
        if (!dryRun) {
          await notifyAuditors(window, results, {
            createSummarySheet: () => Promise.reject(new Error("aborted")),
            share: () => Promise.resolve(),
          }).catch(() => {});
        }
        return json({ error: "AUTH_FAILED_MIDRUN", detail: msg, completed: results.length, window }, 500);
      }
      results.push({ rep: row.full_name, team: row.team, status: "failed", error: msg });
      if (!dryRun) await recordRun(supabase, window, row, "failed", null, null, 0, msg);
    }
  }

  let notified: { summaryUrl: string | null; failures: string[] } = { summaryUrl: null, failures: [] };
  if (!dryRun) {
    notified = await notifyAuditors(window, results, {
      createSummarySheet: (title, rows) => createSummarySheet(googleToken, title, rows),
      share: (fileId, email, message) => shareAndNotify(googleToken, fileId, email, message),
    });
  }

  return json({
    window, dryRun, results,
    summaryUrl: notified.summaryUrl,
    shareFailures: notified.failures,
    judge: { ...judgeDiagnostics },
  });
});

async function recordRun(
  supabase: SupabaseClient,
  window: { startISO: string; endISO: string },
  rep: RosterRep,
  status: string,
  sheetId: string | null | undefined,
  sheetUrl: string | null | undefined,
  deferredCells: number,
  errorMsg: string | null,
): Promise<void> {
  await supabase.from("crm_jail_runs").upsert({
    window_start: window.startISO,
    window_end: window.endISO,
    zoho_user_id: rep.zoho_user_id,
    full_name: rep.full_name,
    team: rep.team,
    sheet_id: sheetId ?? null,
    sheet_url: sheetUrl ?? null,
    status,
    deferred_cells: deferredCells,
    error_msg: errorMsg,
    run_at: new Date().toISOString(),
  }, { onConflict: "zoho_user_id,window_start" });
}

/** The weekly roll-up, created in the shared drive so the drive owns it. */
async function createSummarySheet(
  token: string,
  title: string,
  rows: string[][],
): Promise<{ id: string; url: string }> {
  const create = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [DRIVE_ID],
    }),
  });
  if (!create.ok) throw new Error(`Summary create failed: ${create.status} ${await create.text()}`);
  const id = (await create.json()).id as string;

  const put = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!put.ok) throw new Error(`Summary write failed: ${put.status} ${await put.text()}`);
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
