-- ───────────────────────────────────────────────────────────────────────────
-- Migration 140 — Staggered Phoenix-time cron for the 5 sync functions.
--
-- Phoenix is UTC-7 year-round (no DST). The staggered schedule lets each
-- sync finish before the next starts, and lets the op_metric builder
-- (Phase 1B chunk 3) read consistent data at 02:00 Phoenix / 09:00 UTC.
--
-- Schedule (all UTC):
--   07:15  reporting-sync-users     (00:15 Phoenix) — runs first because
--                                                    deals/meetings/calls
--                                                    reference user_identity
--   07:30  reporting-sync-leads     (00:30 Phoenix)
--   07:45  reporting-sync-deals     (00:45 Phoenix)
--   08:00  reporting-sync-calls     (01:00 Phoenix)
--   08:15  reporting-sync-meetings  (01:15 Phoenix)
--   09:00  build_op_metrics         (02:00 Phoenix) — Phase 1B chunk 3
--
-- This migration is COMMENTED OUT until all 5 sync functions have been
-- deployed and individually smoke-tested. Enable by removing the comment
-- block and re-running.
--
-- Requires pg_cron + pg_net extensions (both present per Phase 1B chunk 1
-- inspection).
-- ───────────────────────────────────────────────────────────────────────────

-- COMMENTED OUT: enable once chunk 2 syncs are all smoke-tested.

/*
-- Helper: invoke a Supabase Edge Function via pg_net using the anon JWT.
-- (The function itself uses SUPABASE_SERVICE_ROLE_KEY internally; the
-- request just needs *some* valid JWT to pass `verify_jwt`.)

CREATE OR REPLACE FUNCTION reporting.invoke_edge_function(p_slug TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_url     TEXT := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/' || p_slug;
  v_token   TEXT := current_setting('app.settings.anon_jwt', true);
  v_request BIGINT;
BEGIN
  IF v_token IS NULL OR v_token = '' THEN
    RAISE EXCEPTION 'app.settings.anon_jwt must be set for cron-driven edge function invocation';
  END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) INTO v_request;
  RETURN v_request;
END;
$fn$;

GRANT EXECUTE ON FUNCTION reporting.invoke_edge_function(TEXT) TO postgres;

-- Schedule
SELECT cron.schedule('reporting-sync-users',     '15 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-users');     $$);
SELECT cron.schedule('reporting-sync-leads',     '30 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-leads');     $$);
SELECT cron.schedule('reporting-sync-deals',     '45 7 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-deals');     $$);
SELECT cron.schedule('reporting-sync-calls',     '0  8 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-calls');     $$);
SELECT cron.schedule('reporting-sync-meetings',  '15 8 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-meetings');  $$);
-- Phase 1B chunk 3 will add:
-- SELECT cron.schedule('build-op-metrics', '0 9 * * *', $$ SELECT reporting.invoke_edge_function('build-op-metrics'); $$);
*/

-- ── Enable procedure (run by hand to activate) ────────────────────────────
-- 1. Set the anon JWT once per cluster:
--    ALTER DATABASE postgres SET app.settings.anon_jwt TO '<anon-jwt-from-supabase-publishable-keys>';
-- 2. Uncomment the block above and re-apply this migration.
-- 3. Verify with: SELECT * FROM cron.job WHERE jobname LIKE 'reporting-%';
