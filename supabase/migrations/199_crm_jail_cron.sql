-- 199_crm_jail_cron.sql
--
-- Weekly CRM Jail audit run.
--
-- Wednesday 09:00 America/Phoenix == 16:00 UTC year round: Arizona does not
-- observe DST, so this needs no seasonal adjustment.
--
-- The invocation carries no rep, so the function acts as the dispatcher and
-- fans out one invocation per active rep.
--
-- NOT APPLIED until a full run completes inside the edge function wall clock.
-- Scheduling a run that reliably 504s would produce partial audits every week
-- and, worse, would look like it had run.

select cron.schedule(
  'crm-jail-weekly',
  '0 16 * * 3',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)),
    body    := '{}'::jsonb,
    timeout_milliseconds := 600000
  );
  $$
);

-- To remove:  select cron.unschedule('crm-jail-weekly');
