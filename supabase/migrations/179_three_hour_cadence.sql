-- ───────────────────────────────────────────────────────────────────────────
-- Migration 179 — 3-hour reporting cadence + 60-day rolling build + weekly full rebuild
--
-- Goal: Op Reporting dashboards lag prod by at most 3 hours, with backstop
-- coverage for late-arriving deals via a weekly full-window rebuild.
--
-- Why the 14-day default in migration 151 wasn't enough: deals get
-- modified in Zoho long after their `admit_date`. When the daily build
-- runs, only the trailing 14 days are DELETEd + re-INSERTed; admits
-- whose admit_date falls before that window but whose deal was modified
-- inside it never get reflected. Surfaced when MTD admit counts on
-- /analytics/op-overview lagged the source by ~40%.
--
-- New schedule (UTC):
--   Every 3 hours (00,03,06,09,12,15,18,21):
--     :00  reporting-sync-deals
--     :01  reporting-sync-leads
--     :02  reporting-sync-meetings
--     :03  reporting-sync-calls
--     :08  reporting-build-op-metrics  (days_back = 60)
--   Daily:
--     07:15  reporting-sync-users      (roster rarely changes)
--   Weekly Sunday 02:30 UTC:
--     reporting-build-op-metrics  (days_back = 365 — backstop)
--
-- The 02:30 Sunday slot sits between the 00:08 build and the 03:00 sync,
-- giving ~30 min headroom in either direction so the 365-day rebuild and
-- the regular 60-day rebuild can't overlap on the same table.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Helper that posts an arbitrary JSONB body — needed so the build cron
--    can pass {"days_back": 60} or {"days_back": 365}. Mirrors the existing
--    `reporting.invoke_edge_function(slug)` helper but takes a body too.
CREATE OR REPLACE FUNCTION reporting.invoke_edge_function_with_body(p_slug TEXT, p_body JSONB)
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
    body := p_body,
    timeout_milliseconds := 600000
  ) INTO v_request;
  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION reporting.invoke_edge_function_with_body(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.invoke_edge_function_with_body(TEXT, JSONB) TO postgres, service_role;

-- 2. Unschedule the old daily jobs that are moving to 3-hourly cadence.
--    Users stays daily (kept by migration 140).
SELECT cron.unschedule('reporting-sync-deals');
SELECT cron.unschedule('reporting-sync-leads');
SELECT cron.unschedule('reporting-sync-meetings');
SELECT cron.unschedule('reporting-sync-calls');
SELECT cron.unschedule('reporting-build-op-metrics');

-- 3. New 3-hour cadence (UTC). Sync jobs stagger by minute so they don't
--    fight for the same edge runtime memory; build runs 5 min after the
--    last sync to give it time to land its writes.
SELECT cron.schedule('reporting-sync-deals',    '0 */3 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-deals');    $$);
SELECT cron.schedule('reporting-sync-leads',    '1 */3 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-leads');    $$);
SELECT cron.schedule('reporting-sync-meetings', '2 */3 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-meetings'); $$);
SELECT cron.schedule('reporting-sync-calls',    '3 */3 * * *', $$ SELECT reporting.invoke_edge_function('reporting-sync-calls');    $$);

-- 60-day rolling rebuild every 3h. 60 days catches the typical
-- modify-after-admit lag (a few days to a couple weeks) with plenty of
-- buffer. Weekly full rebuild below catches anything older.
SELECT cron.schedule(
  'reporting-build-op-metrics',
  '8 */3 * * *',
  $$ SELECT reporting.invoke_edge_function_with_body('reporting-build-op-metrics', '{"days_back": 60}'::jsonb); $$
);

-- 4. Weekly 365-day full rebuild. Sunday 02:30 UTC — outside the 3-hourly
--    cycle so the two builds can't trample each other.
SELECT cron.schedule(
  'reporting-build-op-metrics-weekly-full',
  '30 2 * * 0',
  $$ SELECT reporting.invoke_edge_function_with_body('reporting-build-op-metrics', '{"days_back": 365}'::jsonb); $$
);
