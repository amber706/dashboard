-- 203_referred_out_report_cron.sql
--
-- Daily Referred Out - Coming Back report, 06:50 America/Phoenix == 13:50 UTC
-- year round (Arizona does not observe DST), with a retry at 07:20. Every day,
-- weekends included: clients come back on weekends too.
--
-- Why two jobs: the first manual run died on ZOHO_RATE_LIMITED minting a
-- token. A throttle clears in minutes, so a second attempt 30 minutes later
-- recovers the day instead of silently skipping it. 06:50 also stays clear of
-- the 14:00 UTC pile-up (daily-digest, daily-warehouse-digest, the :05 ETL).
--
-- The function writes a Google Sheet in the CRM Audits shared drive and shares
-- it with Amber, Aaron, Joel, Eric and Megan; Google's share email IS the
-- report. Recipients live in the function (RECIPIENTS in index.ts), not here.
--
-- Auth uses the vault service_role_key, same as crm-jail-weekly. The function
-- checks the JWT's role claim rather than comparing against its own
-- SUPABASE_SERVICE_ROLE_KEY — the two are different service-role JWTs.
--
-- The retry is safe because a second call on the same Phoenix day is a no-op
-- (the function finds the day's sheet already filed), so it cannot double-mail.

select cron.unschedule('referred-out-report-daily')
where exists (select 1 from cron.job where jobname = 'referred-out-report-daily');

select cron.schedule(
  'referred-out-report-daily',
  '50 13 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/referred-out-report',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.unschedule('referred-out-report-retry')
where exists (select 1 from cron.job where jobname = 'referred-out-report-retry');

select cron.schedule(
  'referred-out-report-retry',
  '20 14 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/referred-out-report',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To pause:   select cron.unschedule('referred-out-report-daily');
--             select cron.unschedule('referred-out-report-retry');
-- To inspect: select * from cron.job_run_details
--             where jobid = (select jobid from cron.job where jobname = 'referred-out-report-daily')
--             order by start_time desc limit 5;
