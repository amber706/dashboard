// reporting-build-op-metrics — Phase 1B chunk 3 edge function.
//
// Thin wrapper around the Postgres RPC `reporting_build_op_metrics(days_back)`.
// The function does all the heavy lifting in SQL — we just call it, capture
// the per-table row counts, and write a sync_runs row for observability.
//
// Default window: 14 days. Override via POST body { "days_back": N }.
// Cron schedule: 09:00 UTC daily (after the five upstream sync jobs).

import {
  finishSyncRun,
  handleCorsPreflight,
  jsonResponse,
  startSyncRun,
  supa,
} from "./_shared/reporting-sync.ts";

interface BuildRow {
  table_name: string;
  rows_written: number;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ ok: false, error: "method not allowed" }, 405);
  }

  let daysBack = 14;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (typeof body?.days_back === "number" && body.days_back > 0 && body.days_back <= 365) {
        daysBack = Math.floor(body.days_back);
      }
    } catch {
      // ignore — fall back to default
    }
  }

  const run = await startSyncRun("reporting-build-op-metrics", "internal.op_metrics");

  try {
    const { data, error } = await supa().rpc("reporting_build_op_metrics", { p_days_back: daysBack });
    if (error) throw new Error(`reporting_build_op_metrics failed: ${error.message}`);

    const rows = (data ?? []) as BuildRow[];
    const totalRows = rows.reduce((acc, r) => acc + Number(r.rows_written ?? 0), 0);

    await finishSyncRun(run, { status: "success", rowsProcessed: totalRows });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      days_back: daysBack,
      tables: rows,
      total_rows: totalRows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishSyncRun(run, { status: "failure", rowsProcessed: 0, errorMessage: msg });
    return jsonResponse({ ok: false, error: msg, run_id: run.id }, 500);
  }
});
