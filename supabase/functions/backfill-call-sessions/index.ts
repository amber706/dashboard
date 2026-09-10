// backfill-call-sessions — one-off recovery for a ctm-webhook outage window.
//
// Why this exists: on 2026-09-09 22:49:33Z the CTM_WEBHOOK_SECRET on this project was
// rotated without updating the ?key= in CTM's four webhook URLs, so every delivery
// 401'd until 02:31Z. call_sessions has a ~3h40m hole (~108 calls). CTM itself kept
// the calls, so they are recoverable.
//
// Approach: pull the authoritative call list from CTM's API for the window and replay
// each raw payload through this project's own ctm-webhook. That reuses the production
// payload -> call_sessions mapping (lead matching, specialist linking, routing path,
// timings) instead of reimplementing it here and getting it subtly wrong.
//
// The webhook's shared secret is read from THIS function's env and never leaves it.
//
// Body: { start?: "YYYY-MM-DD", end?: "YYYY-MM-DD", after_iso?, before_iso?,
//         dry_run?: boolean, max?: number, delay_ms?: number }
// dry_run defaults to TRUE — an accidental invocation reports and writes nothing.
//
// Pacing: Supabase rate-limits function-to-function invocations per trace. A first
// attempt at 60ms spacing got 30 through and then ate 79 "Rate limit exceeded ...
// retry after ~40s". So calls are spaced DEFAULT_DELAY_MS apart and each invocation
// handles at most `max`. Re-run until to_replay reports 0 — already-present calls are
// skipped, so repeat runs resume rather than duplicate.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CTM_HOST = Deno.env.get("CTM_API_HOST") ?? "api.calltrackingmetrics.com";
const CTM_ACCOUNT_ID = Deno.env.get("CTM_ACCOUNT_ID");
const CTM_ACCESS_KEY = Deno.env.get("CTM_ACCESS_KEY");
const CTM_SECRET_KEY = Deno.env.get("CTM_SECRET_KEY");
const CTM_WEBHOOK_SECRET = Deno.env.get("CTM_WEBHOOK_SECRET");

// Defaults are the actual outage window, so a bare {} run targets exactly the hole.
const DEFAULT_AFTER = "2026-09-09T22:49:33Z";
const DEFAULT_BEFORE = "2026-09-10T02:31:02Z";
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_MAX = 40;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { "content-type": "application/json" } });

function ctmAuth(): string {
  return `Basic ${btoa(`${CTM_ACCESS_KEY}:${CTM_SECRET_KEY}`)}`;
}

async function fetchCtmPage(start: string, end: string, page: number, perPage = 150) {
  const url = `https://${CTM_HOST}/api/v1/accounts/${CTM_ACCOUNT_ID}/calls.json`
    + `?start_date=${start}&end_date=${end}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url, { headers: { authorization: ctmAuth(), accept: "application/json" } });
  if (!res.ok) throw new Error(`CTM calls page ${page} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return (body.calls ?? body) as Record<string, unknown>[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  try {
    if (!CTM_ACCOUNT_ID || !CTM_ACCESS_KEY || !CTM_SECRET_KEY) {
      return json({ ok: false, error: "CTM_ACCOUNT_ID / CTM_ACCESS_KEY / CTM_SECRET_KEY not set" }, 500);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dry_run !== false; // default true
    const afterMs = Date.parse(String(body.after_iso ?? DEFAULT_AFTER));
    const beforeMs = Date.parse(String(body.before_iso ?? DEFAULT_BEFORE));
    const start = String(body.start ?? DEFAULT_AFTER.slice(0, 10));
    const end = String(body.end ?? DEFAULT_BEFORE.slice(0, 10));
    const maxThisRun = Math.min(Number(body.max ?? DEFAULT_MAX), 200);
    const delayMs = Math.max(Number(body.delay_ms ?? DEFAULT_DELAY_MS), 250);

    // 1) Pull every call CTM has for the calendar days spanning the window.
    const calls: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await fetchCtmPage(start, end, page);
      calls.push(...batch);
      if (batch.length < 150) break;
      await new Promise((r) => setTimeout(r, 120)); // gentle on CTM
    }

    // 2) Narrow to the outage window. unix_time is seconds; fall back to called_at.
    const inWindow = calls.filter((c) => {
      const ms = typeof c.unix_time === "number"
        ? (c.unix_time as number) * 1000
        : Date.parse(String(c.called_at ?? ""));
      return Number.isFinite(ms) && ms >= afterMs && ms <= beforeMs;
    });

    // 3) Drop any this project already has — the replay is idempotent regardless
    //    (ctm-webhook upserts on ctm_call_id) but skipping keeps the report honest.
    const ids = inWindow.map((c) => String(c.id ?? "")).filter(Boolean);
    const present = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("call_sessions").select("ctm_call_id").in("ctm_call_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as { ctm_call_id: string }[]) present.add(r.ctm_call_id);
    }
    const missing = inWindow.filter((c) => !present.has(String(c.id ?? "")));

    const summary = {
      ctm_calls_fetched: calls.length,
      in_outage_window: inWindow.length,
      already_present: inWindow.length - missing.length,
      to_replay: missing.length,
      window: { after: new Date(afterMs).toISOString(), before: new Date(beforeMs).toISOString() },
    };

    if (dryRun) {
      return json({
        ok: true, dry_run: true, ...summary,
        sample: missing.slice(0, 5).map((c) => ({
          id: c.id, direction: c.direction, called_at: c.called_at, status: c.call_status ?? c.status,
        })),
      });
    }

    if (!CTM_WEBHOOK_SECRET) {
      return json({ ok: false, error: "CTM_WEBHOOK_SECRET not set — cannot authenticate the replay" }, 500);
    }

    // 4) Replay through the real webhook, sequentially. It does lead matching and a
    //    Zoho lookup per call, so parallelism here would just cause contention.
    const target = `${SUPABASE_URL}/functions/v1/ctm-webhook?key=${encodeURIComponent(CTM_WEBHOOK_SECRET)}`;
    let replayed = 0, failed = 0, rateLimited = 0;
    const errors: string[] = [];
    for (const call of missing.slice(0, maxThisRun)) {
      try {
        const res = await fetch(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(call),
        });
        if (res.ok) replayed++;
        else {
          const txt = (await res.text()).slice(0, 160);
          failed++;
          if (/rate limit/i.test(txt)) rateLimited++;
          if (errors.length < 5) errors.push(`${call.id}: ${res.status} ${txt}`);
        }
      } catch (err) {
        failed++;
        if (errors.length < 10) errors.push(`${call.id}: ${(err as Error).message.slice(0, 160)}`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }

    return json({
      ok: failed === 0, dry_run: false, ...summary,
      attempted_this_run: Math.min(missing.length, maxThisRun),
      replayed, failed, rate_limited: rateLimited,
      remaining_after_run: Math.max(0, missing.length - replayed),
      errors,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
