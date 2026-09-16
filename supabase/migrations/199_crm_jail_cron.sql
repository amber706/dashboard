-- 199_crm_jail_cron.sql
--
-- Weekly CRM Jail audit run. APPLIED 2026-09-16.
--
-- Wednesday 09:00 America/Phoenix == 16:00 UTC year round; Arizona does not
-- observe DST, so this needs no seasonal adjustment.
--
-- The body carries no rep, so the function acts as dispatcher and fans out one
-- invocation per active rep.
--
-- Auth uses the vault secret, matching hourly_generate_suggestions. An earlier
-- draft of this file used current_setting('app.service_role_key', true) — that
-- setting does not exist on this project and returns NULL, which would have
-- sent an empty bearer token and failed silently every Wednesday.

select cron.unschedule('crm-jail-weekly')
where exists (select 1 from cron.job where jobname = 'crm-jail-weekly');

select cron.schedule(
  'crm-jail-weekly',
  '0 16 * * 3',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    -- A full run takes ~110s; allow generous headroom before pg_net gives up.
    timeout_milliseconds := 600000
  );
  $$
);

-- To pause:   select cron.unschedule('crm-jail-weekly');
-- To inspect: select * from cron.job_run_details
--             where jobid = (select jobid from cron.job where jobname = 'crm-jail-weekly')
--             order by start_time desc limit 5;
