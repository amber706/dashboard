// reporting-sync-calls — Phase 1B sync edge function.
//
// Pulls Call Tracking Metrics (CTM) calls within the watermark window and
// upserts:
//   1. reporting.raw_ctm_calls  (raw payload)
//   2. reporting.calls          (normalized)
//
// Env required:
//   - CTM_ACCOUNT_ID
//   - CTM_ACCESS_KEY  (Basic auth username)
//   - CTM_SECRET_KEY  (Basic auth password)
//
// Status: scaffold deployed; smoke-test against CTM creds in next session.

import {
  finishSyncRun,
  handleCorsPreflight,
  jsonResponse,
  startSyncRun,
  supa,
  upsertRaw,
} from "./_shared/reporting-sync.ts";

const CTM_API_BASE = "https://api.calltrackingmetrics.com/api/v1";

interface CtmCall {
  id: number | string;
  direction?: string;
  duration?: number;
  called_at?: string;
  status?: string;
  agent?: { id?: number; name?: string };
  contact?: { id?: number; phone?: string };
  voicemail?: boolean;
}

async function fetchCtmCallsPage(
  accountId: string,
  basicAuth: string,
  page: number,
  since: Date | null,
): Promise<{ calls: CtmCall[]; total_pages: number }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: "200",
  });
  if (since) params.set("start_date", since.toISOString().slice(0, 10));
  const url = `${CTM_API_BASE}/accounts/${accountId}/calls.json?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
  if (!res.ok) {
    throw new Error(`CTM calls fetch failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }
  const j = await res.json();
  return { calls: (j.calls ?? []) as CtmCall[], total_pages: Number(j.total_pages ?? 1) };
}

function normalizeCall(c: CtmCall): {
  source_call_id: string;
  owner_user_id: string | null;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  duration_sec: number | null;
  occurred_at: string;
  missed: boolean;
} {
  const direction = (c.direction ?? "inbound").toLowerCase() === "outbound" ? "outbound" : "inbound";
  return {
    source_call_id: String(c.id),
    owner_user_id: null, // ctm_agent_id → user_identity lookup deferred
    lead_id: null,
    direction,
    duration_sec: c.duration ?? null,
    occurred_at: c.called_at ?? new Date().toISOString(),
    missed: Boolean(c.voicemail) || c.status === "missed" || c.status === "no-answer",
  };
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ ok: false, error: "method not allowed" }, 405);

  const accountId = Deno.env.get("CTM_ACCOUNT_ID");
  const accessKey = Deno.env.get("CTM_ACCESS_KEY");
  const secretKey = Deno.env.get("CTM_SECRET_KEY");
  if (!accountId || !accessKey || !secretKey) {
    return jsonResponse({ ok: false, error: "CTM credentials not configured (CTM_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY)" }, 500);
  }
  const basicAuth = btoa(`${accessKey}:${secretKey}`);

  const run = await startSyncRun("reporting-sync-calls", "ctm.calls");

  try {
    const allCalls: CtmCall[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const r = await fetchCtmCallsPage(accountId, basicAuth, page, run.watermarkUsed);
      allCalls.push(...r.calls);
      totalPages = r.total_pages;
      page++;
    } while (page <= totalPages && page <= 100); // safety cap

    const rawRows = allCalls.map((c) => ({
      source_id: String(c.id),
      source_modified_at: c.called_at ?? null,
      raw_payload: c,
    }));
    await upsertRaw("raw_ctm_calls", rawRows);

    const normalized = allCalls.map(normalizeCall);

    let upserted = 0;
    if (normalized.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < normalized.length; i += CHUNK) {
        const slice = normalized.slice(i, i + CHUNK);
        const { data, error } = await supa().rpc("reporting_upsert_calls", { p_rows: slice });
        if (error) throw new Error(`reporting_upsert_calls failed: ${error.message}`);
        upserted += Number(data ?? slice.length);
      }
    }

    await finishSyncRun(run, { status: "success", rowsProcessed: upserted });

    return jsonResponse({ ok: true, run_id: run.id, calls_pulled: allCalls.length, calls_upserted: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
