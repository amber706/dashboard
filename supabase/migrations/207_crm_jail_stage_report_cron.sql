-- 207_crm_jail_stage_report_cron.sql
--
-- Daily BD company stage-compliance report (Aaron, 2026-10-26).
--
-- 23:30 UTC is 16:30 Phoenix year round, half an hour before the reps' 17:00
-- staging deadline in the "Zoho Company Staging Rules". Every Company each
-- active BD rep owns is checked against those rules (supabase/functions/
-- crm-jail/stage.ts) and the report is shared with Aaron as a Google Sheet,
-- which arrives as an email. Archive and Delete accounts are not checked.
--
-- `team: bd` keeps the run to BD even though the report filters to BD itself.

select cron.unschedule('crm-jail-stage-report')
where exists (select 1 from cron.job where jobname = 'crm-jail-stage-report');

select cron.schedule(
  'crm-jail-stage-report',
  '30 23 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{"stage_report": true, "team": "bd"}'::jsonb,
    timeout_milliseconds := 400000
  );
  $$
);

-- To pause:
--   select cron.unschedule('crm-jail-stage-report');
