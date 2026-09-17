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
import { auditWindowFor, coqlBounds, windowFrom } from "./window.ts";
import { getCachedZohoAccessToken, zohoTokenWorks } from "./zoho.ts";
import { getGoogleAccessToken } from "./google-auth.ts";
import { auditRep, replayRecords, type RosterRep } from "./audit-rep.ts";
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
  // Write the scorecards but tell nobody. Lets a real write path be verified
  // without putting bot output in front of Aaron and Megan, or emailing them,
  // before anyone has decided they should see it.
  const skipNotify = Boolean(body.skip_notify);
  // When set, audit exactly this rep. The dispatcher below calls the function
  // once per rep so each gets its own wall-clock budget — a single invocation
  // auditing all nine times out once the notes judge is doing real work.
  const onlyRep = typeof body.rep === "string" ? body.rep : null;
  // Prepended to every share notification — used to mark a run as a trial so
  // an auditor does not mistake bot output for scores to act on.
  const note = typeof body.note === "string" ? body.note : undefined;
  // A fanned-out child is told the window outright. It must not re-derive one
  // from a timestamp: auditWindowFor counts back from the week containing its
  // argument, so any date inside the target window yields the week before it.
  const window = typeof body.window_start === "string"
    ? windowFrom(body.window_start)
    : auditWindowFor(body.run_at ? new Date(String(body.run_at)) : new Date());
  const bounds = coqlBounds(window);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });


  // Can the bot actually read a given sheet? EOD sheets are created by Zoho in
  // a person's own Drive, so whether the service account can see one depends on
  // where it was filed and who shared it — and guessing wrong sends someone
  // hunting a permission problem that may not exist.
  if (typeof body.sheet_probe === "string") {
    try {
      const gt = await getGoogleAccessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${body.sheet_probe}` +
          `?includeGridData=false`,
        { headers: { Authorization: `Bearer ${gt}` } },
      );
      if (!res.ok) {
        return json({ readable: false, status: res.status, detail: (await res.text()).slice(0, 300) });
      }
      const meta = await res.json();
      return json({
        readable: true,
        title: meta.properties?.title,
        tabs: (meta.sheets ?? []).map((sh: Record<string, Record<string, unknown>>) =>
          sh.properties?.title
        ),
      });
    } catch (e) {
      return json({ readable: false, detail: String(e) }, 500);
    }
  }

  // Backfill: create an EOD sheet in the CRM Audits drive and append rows to it.
  //
  // Both EOD pipes had been silently dead for months (BD's Google auth lapsed,
  // the admissions Zap stopped), so ~90 days of submissions exist only inside
  // Zoho Forms. Zoho pushes new entries only and never backfills, so the
  // history has to be loaded once by hand or A1-A3 cannot be scored for any
  // window before the pipes were fixed.
  //
  // Rows are posted straight from the exported CSV over HTTP. Deliberately a
  // separate action rather than a general "write any sheet" endpoint: it only
  // ever creates or appends inside DRIVE_ID.
  if (body.backfill && typeof body.backfill === "object") {
    const bf = body.backfill as { title?: string; sheetId?: string; rows?: string[][] };
    const rows = Array.isArray(bf.rows) ? bf.rows : [];
    if (rows.length === 0) return json({ error: "BACKFILL_NO_ROWS" }, 400);
    try {
      const gt = await getGoogleAccessToken();
      if (bf.sheetId) {
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${bf.sheetId}/values/A1:append` +
            `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${gt}`, "content-type": "application/json" },
            body: JSON.stringify({ values: rows }),
          },
        );
        if (!res.ok) return json({ error: "APPEND_FAILED", detail: await res.text() }, 500);
        return json({ ok: true, sheetId: bf.sheetId, appended: rows.length });
      }
      const made = await createSummarySheet(gt, bf.title ?? "EOD Backfill", rows);
      return json({ ok: true, sheetId: made.id, url: made.url, appended: rows.length });
    } catch (e) {
      return json({ error: "BACKFILL_FAILED", detail: String(e) }, 500);
    }
  }

  // Auth and taxonomy up front: if any of this is broken, produce nothing.
  let zohoToken: string, googleToken: string;
  let stageCategory: (r: unknown) => string | null;
  let sourceCategory: (r: unknown) => string | null;
  try {
    const [zt, gt, tax] = await Promise.all([
      resolveZohoToken(supabase),
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

  let rosterQuery = supabase
    .from("crm_jail_roster").select("*").eq("active", true).order("team").order("full_name");
  if (onlyRep) rosterQuery = rosterQuery.eq("zoho_user_id", onlyRep);
  // Replay: score an explicit record set (the one a human auditor sampled) and
  // return raw item results for diffing. No sheets, no notifications.
  if (body.replay && typeof body.replay === "object") {
    const rp = body.replay as { team: Team; records: Record<string, string[]> };
    try {
      const scored = await replayRecords(rp.team, window, rp.records, {
        zohoToken, googleToken, driveId: DRIVE_ID, stageCategory, sourceCategory, dryRun: true,
      });
      return json({ window, replay: true, team: rp.team, scored });
    } catch (e) {
      return json({ error: "REPLAY_FAILED", detail: String(e) }, 500);
    }
  }

  // Notify-only: re-send the share notifications for a window whose scorecards
  // already exist. The first live run wrote all nine sheets and shared none of
  // them (the permissions call was missing supportsAllDrives), and re-auditing
  // to fix that would re-spend the Zoho quota and re-judge every record for
  // sheets that are already correct. Reads crm_jail_runs; touches no CRM.
  if (body.notify_only) {
    // A correction usually concerns one team. Re-notifying the other team's
    // auditor about scorecards that did not change is noise they have to
    // re-review, so notify_only can be scoped.
    const onlyTeam = typeof body.team === "string" ? body.team : null;
    let runsQuery = supabase
      .from("crm_jail_runs").select("*")
      .eq("window_start", window.startISO).eq("window_end", window.endISO)
      .order("created_at", { ascending: false });
    if (onlyTeam) runsQuery = runsQuery.eq("team", onlyTeam);
    const { data: runs, error: runsErr } = await runsQuery;
    if (runsErr) return json({ error: "RUNS_FAILED", detail: runsErr.message }, 500);

    const { data: roster, error: rErr } = await rosterQuery;
    if (rErr) return json({ error: "ROSTER_FAILED", detail: rErr.message }, 500);
    const auditorOf = new Map(
      (roster ?? []).map((r) => [r.zoho_user_id as string, r.auditor_email as string]),
    );

    // Newest row per rep — a re-run leaves older rows pointing at stale sheets.
    const latest = new Map<string, Record<string, unknown>>();
    for (const r of runs ?? []) {
      const k = String(r.zoho_user_id);
      if (!latest.has(k)) latest.set(k, r);
    }
    const results: RepResult[] = [...latest.values()].map((r) => ({
      rep: String(r.full_name),
      team: String(r.team),
      status: String(r.status),
      sheetId: (r.sheet_id as string) ?? undefined,
      sheetUrl: (r.sheet_url as string) ?? undefined,
      deferredCells: Number(r.deferred_cells ?? 0),
      auditorEmail: auditorOf.get(String(r.zoho_user_id)),
    }));
    if (results.length === 0) {
      return json({ error: "NO_RUNS_FOR_WINDOW", window }, 404);
    }

    // Re-share the summary the run already built rather than making a second
    // one, so the auditors get one link per window and not a pile of them.
    const existingSummary = typeof body.summary_sheet_id === "string"
      ? body.summary_sheet_id
      : null;
    // Everyone on `cc` gets every scorecard in this batch and the summary, with
    // the same message the auditor gets.
    const cc = Array.isArray(body.cc) ? (body.cc as unknown[]).map(String) : [];
    const notified = await notifyAuditors(window, results, {
      createSummarySheet: existingSummary
        ? (() =>
          Promise.resolve({
            id: existingSummary,
            url: `https://docs.google.com/spreadsheets/d/${existingSummary}/edit`,
          }))
        : ((title, rows) => createSummarySheet(googleToken, title, rows)),
      share: (fileId, email, message) => shareAndNotify(googleToken, fileId, email, message),
    }, note, cc);
    return json({
      window, notifyOnly: true, team: onlyTeam, cc, reps: results.length,
      summaryUrl: notified.summaryUrl, shareFailures: notified.failures,
    });
  }

  const { data: roster, error: rosterErr } = await rosterQuery;
  if (rosterErr) return json({ error: "ROSTER_FAILED", detail: rosterErr.message }, 500);

  // Dispatcher: fan out one invocation per rep, then summarise what comes back.
  if (!onlyRep) {
    return await dispatch(
      (roster ?? []) as unknown as Array<RosterRep>,
      window, dryRun, skipNotify, googleToken, req.headers.get("Authorization") ?? "", note,
    );
  }

  const results: RepResult[] = [];

  for (const row of (roster ?? []) as unknown as Array<RosterRep & { id: string }>) {
    try {
      const r = await auditRep(row, window, bounds, {
        zohoToken, googleToken, driveId: DRIVE_ID, stageCategory, sourceCategory, dryRun,
        rosterNames: ((roster ?? []) as unknown as Array<RosterRep>).map((x) => x.full_name),
      });
      results.push({
        rep: r.rep, team: r.team, status: r.status, sheetId: r.sheetId, sheetUrl: r.sheetUrl,
        deferredCells: r.deferredCells, auditorEmail: r.auditorEmail,
        timings: r.timings,
      });
      if (!dryRun) await recordRun(supabase, window, row, r.status, r.sheetId, r.sheetUrl, r.deferredCells, null);
    } catch (e) {
      const msg = String(e);
      // The token died mid-run. Stop rather than finish with empty scorecards.
      // A rate limit is transient and rep-scoped: record it and keep going.
      // Only a genuine auth failure aborts the run.
      if (
        (msg.includes("ZOHO_AUTH_FAILED") || msg.includes("GOOGLE_AUTH_FAILED")) &&
        !msg.includes("RATE_LIMITED")
      ) {
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

  // A per-rep invocation returns its result; the dispatcher does the notifying
  // so the summary is sent once, not once per rep.
  return json({ window, dryRun, results, judge: { ...judgeDiagnostics } });
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

/**
 * Returns a Zoho token known to work. A cached token can be stale or carry the
 * wrong scopes; validating once here costs one call and stops an entire run
 * being built on a token that 401s.
 */
async function resolveZohoToken(supabase: SupabaseClient): Promise<string> {
  const cached = await getCachedZohoAccessToken(supabase);
  if (await zohoTokenWorks(cached)) return cached;

  // The probe said no. That is weak evidence: it also fails when Zoho is
  // throttling data calls, which says nothing about the credential. Try a
  // fresh token, but do NOT let a failed re-mint discard a cached token that
  // has not expired — twice now this check has been the thing that killed a
  // run the cached token would have completed.
  try {
    const fresh = await getCachedZohoAccessToken(supabase, true);
    if (await zohoTokenWorks(fresh)) return fresh;
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

/**
 * Fans out one invocation per rep and waits for all of them. Each rep gets its
 * own function instance and therefore its own wall clock; the dispatcher only
 * waits on HTTP, so nine reps cost roughly one rep's time rather than nine.
 *
 * A rep whose invocation fails is recorded as failed and the others still land
 * — the same per-rep isolation the in-process loop had.
 */
async function dispatch(
  roster: RosterRep[],
  window: { startISO: string; endISO: string; label: string },
  dryRun: boolean,
  skipNotify: boolean,
  googleToken: string,
  authHeader: string,
  note?: string,
): Promise<Response> {
  const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/crm-jail`;

  // Firing all nine at once had Supabase refuse one with a 503, and put nine
  // simultaneous Zoho token mints through a throttled endpoint. Four at a time
  // still finishes well inside the wall clock and is far gentler on both.
  const CONCURRENCY = 4;
  const ATTEMPTS = 3;

  async function auditOne(rep: RosterRep): Promise<RepResult> {
    let lastErr = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await fetch(self, {
          method: "POST",
          headers: { Authorization: authHeader, "content-type": "application/json" },
          body: JSON.stringify({
            rep: rep.zoho_user_id, dry_run: dryRun, window_start: window.startISO,
          }),
        });
        // 5xx from the platform is transient and says nothing about the rep's
        // data — back off and try again rather than lose their audit.
        if (res.status >= 500) {
          lastErr = `HTTP ${res.status}`;
          if (attempt < ATTEMPTS) {
            await new Promise((r) => setTimeout(r, attempt * 2000));
            continue;
          }
        } else {
          const body = await res.json();
          if (!res.ok || !body.results?.[0]) {
            return {
              rep: rep.full_name, team: rep.team, status: "failed",
              error: body.detail ?? body.error ?? `HTTP ${res.status}`,
            };
          }
          return body.results[0] as RepResult;
        }
      } catch (e) {
        lastErr = String(e);
        if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    return { rep: rep.full_name, team: rep.team, status: "failed", error: lastErr };
  }

  const settled: RepResult[] = [];
  for (let i = 0; i < roster.length; i += CONCURRENCY) {
    settled.push(...await Promise.all(roster.slice(i, i + CONCURRENCY).map(auditOne)));
  }

  let notified: { summaryUrl: string | null; failures: string[] } = { summaryUrl: null, failures: [] };
  if (!dryRun && !skipNotify) {
    notified = await notifyAuditors(window, settled, {
      createSummarySheet: (title, rows) => createSummarySheet(googleToken, title, rows),
      share: (fileId, email, message) => shareAndNotify(googleToken, fileId, email, message),
    });
  }
  return json({
    window, dryRun, skipNotify, dispatched: roster.length, results: settled,
    summaryUrl: notified.summaryUrl, shareFailures: notified.failures,
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
