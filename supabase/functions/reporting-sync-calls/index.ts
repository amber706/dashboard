// reporting-sync-calls — Phase 1B sync edge function.
//
// Pulls Call Tracking Metrics (CTM) calls within the watermark window and
// upserts:
//   1. reporting.raw_ctm_calls  (raw payload)
//   2. reporting.calls          (normalized)
//
// CTM payloads are large (transcripts, etc.), so we stream page-by-page:
// fetch a page, upsert raw + normalized, drop the page, fetch next.
// Accumulating thousands of payloads in memory hits the Supabase edge
// runtime's WORKER_RESOURCE_LIMIT.
//
// Env required:
//   - CTM_ACCOUNT_ID
//   - CTM_ACCESS_KEY  (Basic auth username)
//   - CTM_SECRET_KEY  (Basic auth password)

import {
  finishSyncRun,
  handleCorsPreflight,
  jsonResponse,
  startSyncRun,
  supa,
  upsertRaw,
} from "./_shared/reporting-sync.ts";

const CTM_API_BASE = "https://api.calltrackingmetrics.com/api/v1";

// PostgreSQL JSONB rejects   in strings (even though JSON allows it).
// Strip NULL byte escapes from raw payloads before persisting.
function scrubJsonbNulls<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj).replace(/\\u0000/g, "")) as T;
}

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
    per_page: "150", // CTM enforces a max of 150 per page
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
    // Default first-backfill window: 90 days. Incremental runs use the
    // sync_runs watermark.
    const since = run.watermarkUsed ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const seen = new Set<string>(); // dedupe across pages (CTM pagination can shift)
    let totalPulled = 0;
    let totalUnique = 0;
    let totalUpserted = 0;

    let page = 1;
    let totalPages = 1;
    do {
      const r = await fetchCtmCallsPage(accountId, basicAuth, page, since);
      totalPulled += r.calls.length;
      totalPages = r.total_pages;

      // Per-page dedupe + scrub + upsert.
      const fresh = r.calls.filter((c) => {
        const id = String(c.id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      totalUnique += fresh.length;

      if (fresh.length > 0) {
        const rawRows = fresh.map((c) => ({
          source_id: String(c.id),
          source_modified_at: c.called_at ?? null,
          raw_payload: scrubJsonbNulls(c),
        }));
        await upsertRaw("raw_ctm_calls", rawRows, 50);

        const normalized = fresh.map(normalizeCall);
        const { data, error } = await supa().rpc("reporting_upsert_calls", { p_rows: normalized });
        if (error) throw new Error(`reporting_upsert_calls failed (page ${page}): ${error.message}`);
        totalUpserted += Number(data ?? normalized.length);
      }

      page++;
    } while (page <= totalPages && page <= 200); // safety cap

    await finishSyncRun(run, { status: "success", rowsProcessed: totalUpserted });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      pages_fetched: page - 1,
      calls_pulled: totalPulled,
      calls_unique: totalUnique,
      calls_upserted: totalUpserted,
      since: since.toISOString().slice(0, 10),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
