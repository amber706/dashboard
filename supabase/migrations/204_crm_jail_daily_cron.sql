-- 204_crm_jail_daily_cron.sql
--
-- Schedule the daily correction lists (see the header of
-- supabase/functions/crm-jail/daily.ts).
--
-- 15:00 UTC is 08:00 Phoenix year round (Arizona has no DST), which is the
-- time daily.ts's phoenixToday() and previousDay() were written against: the
-- job audits the day that just ended. It runs every day on purpose. A rep who
-- did not work yesterday owns no records from yesterday and hears nothing, so
-- weekends and holidays need no calendar logic.
--
-- PREVIEW PHASE. Every rep's list goes to Aaron instead of the rep, and both
-- digests go to Aaron only. The only live test of this mode so far was one
-- dry run on one rep, and that run produced 220 corrections across 32 of 34
-- records. Nothing that mails fourteen employees unprompted should reach them
-- before one person has read a week of it. To go live, a later migration
-- reschedules this job without preview_to.
--
-- Zoho load: this checks EVERY record each rep touched, not the weekly's
-- sample of five. Run one whole-team dry run by hand before applying this and
-- note its duration and failures; the weekly's ~575 calls in two minutes is
-- the known ceiling that other syncs tolerate.

select cron.unschedule('crm-jail-daily')
where exists (select 1 from cron.job where jobname = 'crm-jail-daily');

select cron.schedule(
  'crm-jail-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    -- Preview: every list and digest goes to Aaron, none to reps.
    body    := '{"daily": true, "preview_to": "aaron@cornerstonehealingcenter.com"}'::jsonb,
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
