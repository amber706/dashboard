-- 204_crm_jail_daily_cron.sql
--
-- Schedule the daily correction lists (see the header of
-- supabase/functions/crm-jail/daily.ts).
--
-- 15:10 UTC is 08:10 Phoenix year round (Arizona has no DST). Ten minutes past
-- the hour on purpose: the reporting-sync-* jobs hit Zoho at :00-:03 every
-- third hour, 15:00 included. The first live run (2026-09-30, 08:10) covered
-- all 14 reps in about two minutes.
--
-- Every day, auditing the day before. Who gets a list is decided by activity,
-- not by a calendar (Aaron, 2026-10-01):
--   - A rep with no records created or modified on the audited day was not on
--     shift and hears nothing. Weekday-only reps get no list on Sunday for
--     Saturday.
--   - Friday's list goes out Saturday morning, so it is waiting on Monday.
--   - A rep who worked and has nothing to fix also hears nothing.
--   - A team digest is skipped when nobody on the team worked.
--
-- Recipients: each rep their own list; admissions digest to Aaron and Megan,
-- BD digest to Aaron (DIGEST_RECIPIENTS in index.ts).

select cron.unschedule('crm-jail-daily')
where exists (select 1 from cron.job where jobname = 'crm-jail-daily');

select cron.schedule(
  'crm-jail-daily',
  '10 15 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{"daily": true}'::jsonb,
    timeout_milliseconds := 600000
  );
  $$
);

-- To inspect:
--   select d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname = 'crm-jail-daily' order by d.start_time desc limit 10;
-- To pause:
--   select cron.unschedule('crm-jail-daily');
