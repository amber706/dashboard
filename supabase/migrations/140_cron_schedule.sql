-- ───────────────────────────────────────────────────────────────────────────
-- Migration 140 — Staggered Phoenix-time cron for the sync functions.
--
-- Phoenix is UTC-7 year-round (no DST). The staggered schedule lets each
-- sync finish before the next starts, and lets the op_metric builder
-- (Phase 1B chunk 3) read consistent data at 02:00 Phoenix / 09:00 UTC.
--
-- Schedule (all UTC):
--   07:15  reporting-sync-users     (00:15 Phoenix) — first because
--                                                    deals/meetings/calls
--                                                    reference user_identity
--   07:30  reporting-sync-leads     (00:30 Phoenix) — disabled until the
--                                                    Zoho refresh token is
--                                                    re-issued with Analytics
--                                                    scope (OPEN_QUESTIONS #18)
--   07:45  reporting-sync-deals     (00:45 Phoenix)
--   08:00  reporting-sync-calls     (01:00 Phoenix)
--   08:15  reporting-sync-meetings  (01:15 Phoenix)
--   09:00  build_op_metrics         (02:00 Phoenix) — added by chunk 3
--
-- Requires pg_cron + pg_net extensions (both present per chunk 1).
-- ───────────────────────────────────────────────────────────────────────────

-- Helper: invoke a Supabase Edge Function via pg_net. We inline the anon JWT
-- here rather than reading it from a session GUC (`ALTER DATABASE ... SET`
-- requires superuser, which the MCP connection lacks). The anon JWT is the
-- same one shipped to public clients — `verify_jwt` on the edge function
-- just needs *some* valid Supabase JWT; the function itself uses the
-- service-role key internally.

CREATE OR REPLACE FUNCTION reporting.invoke_edge_function(p_slug TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_url     TEXT := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/' || p_slug;
  v_token   TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcnRkeGJiYXppZmtscXd5ZG5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTA0MzUsImV4cCI6MjA5MzA4NjQzNX0.I3Tilnhu6jA3zURRASmTK2QpNXd41GciX2Sofpdt9YE';
  v_request BIGINT;
BEGIN
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) INTO v_request;
  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION reporting.invoke_edge_function(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.invoke_edge_function(TEXT) TO postgres, service_role;

-- Schedule. Leads is intentionally disabled — see header note.
SELECT cron.schedule('reporting-sync-users',     '15 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-users');     $$);
SELECT cron.schedule('reporting-sync-deals',     '45 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-deals');     $$);
SELECT cron.schedule('reporting-sync-calls',     '0  8 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-calls');     $$);
SELECT cron.schedule('reporting-sync-meetings',  '15 8 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-meetings');  $$);
-- Leads (re-enable once the Zoho refresh token includes Analytics scope):
-- SELECT cron.schedule('reporting-sync-leads', '30 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-leads'); $$);

-- Phase 1B chunk 3: op-metric builder (rebuilds trailing 14 days every run)
SELECT cron.schedule('reporting-build-op-metrics', '0 9 * * *', $$ SELECT reporting.invoke_edge_function('reporting-build-op-metrics'); $$);
