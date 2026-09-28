// Daily Referred Out - Coming Back report.
//
// Every morning: pull every deal parked in the coming-back stage from Zoho,
// group it by the facility we sent the client to, write it to a Google Sheet
// in the CRM Audits shared drive, and share that sheet with the leadership
// list so Google sends the email. Same delivery as CRM Jail, for the same
// reason: client names are PHI, and this way they never leave Google or Zoho.
//
// Reuses CRM Jail's Zoho token cache on purpose. Minting a fresh Zoho token
// per run is what throttled push-google-conversions into silent zeroes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { coql, getCachedZohoAccessToken, zohoTokenWorks } from "../crm-jail/zoho.ts";
import { getGoogleAccessToken } from "../crm-jail/google-auth.ts";
import { shareAndNotify } from "../crm-jail/notify.ts";
import { ensureFolderPath } from "../crm-jail/sheets.ts";
import { phoenixToday } from "../crm-jail/daily.ts";
import { buildMessage, buildRows, groupByFacility, toDeal } from "./report.ts";

const DRIVE_ID = Deno.env.get("CRM_JAIL_DRIVE_ID") ?? "0AHjwwQeACWHRUk9PVA";

const RECIPIENTS = [
  "amber@cornerstonehealingcenter.com",
  "aaron@cornerstonehealingcenter.com",
  "joelm@cornerstonehealingcenter.com",
  "ericw@cornerstonehealingcenter.com",
  "megan@cornerstonehealingcenter.com",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // verify_jwt only proves the caller holds *a* project key — the public anon
  // key passes it. This report carries client names, so only the service role
  // (the cron job) may run it. The gateway has already checked the signature;
  // this checks the role. It cannot be a string compare against
  // SUPABASE_SERVICE_ROLE_KEY: the vault key cron sends is a different
  // service-role JWT from the one in the function env, and that compare
  // rejected the first real call.
  if (jwtRole(req.headers.get("Authorization")) !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  // Return the rows without writing a sheet or emailing anyone.
  const dryRun = Boolean(body.dry_run);
  // Send only to these addresses — for checking the email before it goes wide.
  const previewTo = Array.isArray(body.preview_to) ? body.preview_to.map(String) : null;
  // A second run on the same day would email everyone a duplicate sheet.
  const force = Boolean(body.force);
  const todayISO = typeof body.date === "string" ? body.date : phoenixToday();

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    // The stage's raw Zoho name comes from the mapping table, never a literal,
    // so a stage rename in Zoho is fixed in one place for every report.
    const { data: tax, error: taxErr } = await supabase.rpc("crm_jail_taxonomy");
    if (taxErr) throw new Error(`Could not load taxonomy: ${taxErr.message}`);
    const stages = ((tax ?? []) as Array<Record<string, string>>)
      .filter((r) => r.kind === "stage" && r.normalized_value === "referred_out_coming_back")
      .map((r) => r.raw_value);
    // An empty list would query nothing and mail a confident "0 active".
    if (stages.length === 0) throw new Error("No raw stage maps to referred_out_coming_back");

    let token = await getCachedZohoAccessToken(supabase);
    if (!(await zohoTokenWorks(token))) token = await getCachedZohoAccessToken(supabase, true);

    const stageIn = stages.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(", ");
    const raw: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await coql(
        token,
        "select Deal_Name, Referred_Out.Account_Name, Refer_Out_Date, Refer_Out_Type, " +
          "Pipeline, Outbound_Referral_BD_Rep, Owner.first_name, Owner.last_name, " +
          `Admitted_at_Referred_Facility from Deals where Stage in (${stageIn}) ` +
          `limit 200 offset ${offset}`,
      );
      raw.push(...page);
      if (page.length < 200) break;
    }

    const groups = groupByFacility(raw.map(toDeal));
    const rows = buildRows(todayISO, groups);
    const message = buildMessage(todayISO, groups);
    if (dryRun) return json({ dryRun, todayISO, count: raw.length, message, rows });

    const g = await getGoogleAccessToken();
    const [y, m] = todayISO.split("-");
    const folder = await ensureFolderPath(g, DRIVE_ID, [
      "Referred Out Coming Back", y, MONTHS[Number(m) - 1],
    ]);
    const title = `Referred Out Coming Back ${todayISO}`;

    if (!force && !previewTo) {
      const existing = await findFile(g, folder, title);
      if (existing) return json({ skipped: "already sent today", sheet: existing });
    }

    const sheet = await createSheet(g, folder, title, rows);
    const failures: string[] = [];
    for (const to of previewTo ?? RECIPIENTS) {
      try {
        await shareAndNotify(g, sheet.id, to, message);
      } catch (e) {
        // One bad address must not stop the others from getting the report.
        failures.push(String(e));
      }
    }
    return json({ todayISO, count: raw.length, sheet: sheet.url, failures }, failures.length ? 207 : 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function jwtRole(auth: string | null): string | null {
  const payload = auth?.replace(/^Bearer /, "").split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4))).role ?? null;
  } catch {
    return null;
  }
}

async function findFile(token: string, parent: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(
    `'${parent}' in parents and name = '${name}' and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true&driveId=${DRIVE_ID}&corpora=drive`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive lookup failed: ${res.status} ${await res.text()}`);
  const id = (await res.json()).files?.[0]?.id;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

async function createSheet(
  token: string,
  parent: string,
  title: string,
  rows: string[][],
): Promise<{ id: string; url: string }> {
  const create = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parent],
    }),
  });
  if (!create.ok) throw new Error(`Sheet create failed: ${create.status} ${await create.text()}`);
  const id = (await create.json()).id as string;

  // RAW, not USER_ENTERED: a client name starting with "=" or "+" must stay text.
  const put = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!put.ok) throw new Error(`Sheet write failed: ${put.status} ${await put.text()}`);
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}
