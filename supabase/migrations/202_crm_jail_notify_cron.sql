-- 202_crm_jail_notify_cron.sql
--
-- Split delivery out of the audit run.
--
-- The 2026-09-23 run worked and told nobody. All 14 reps were audited and 13
-- scorecards were written — the last at 16:03:14, 194s after the 16:00:00
-- trigger — and not one share notification was sent. Amber noticed on 9/25
-- that she had received nothing; her mailbox confirms the last crm-jail-bot
-- share email was 2026-09-17.
--
-- The cause is structural, not a bug in the notify code. The dispatcher awaits
-- every fanned-out child, THEN calls notifyAuditors. Notification is therefore
-- the last thing a single long-lived invocation does, after the slowest rep
-- has finished. Each child writes its own crm_jail_runs row from its own
-- invocation, so the ledger fills in and the scorecards appear whether or not
-- the parent lives long enough to reach the notify step. That is the worst
-- possible failure shape: it looks exactly like success from the database.
--
-- The roster went from 9 reps to 14 on 2026-09-16, which is what pushed the
-- run past the point where the parent survives it.
--
-- So delivery gets its own job. The audit run now passes skip_notify and does
-- one thing: write scorecards. A second job 25 minutes later calls notify_only,
-- which reads crm_jail_runs and shares what it finds — a few seconds of work
-- that cannot be starved by the audit. It also self-heals: a rep whose audit
-- failed is simply absent from the ledger, and everyone else still goes out.
--
-- 25 minutes is ~7x the observed run. notify_only derives the same Monday-to-
-- Sunday window from its own trigger time, so the two jobs agree without
-- having to pass one between them.
--
-- Exactly one job notifies. Leaving the dispatcher's own notify enabled as a
-- belt-and-braces would double-mail both auditors every week on the runs where
-- the parent does survive.

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
    -- Writes scorecards only. crm-jail-weekly-notify delivers them.
    body    := '{"skip_notify": true}'::jsonb,
    timeout_milliseconds := 600000
  );
  $$
);

select cron.unschedule('crm-jail-weekly-notify')
where exists (select 1 from cron.job where jobname = 'crm-jail-weekly-notify');

select cron.schedule(
  'crm-jail-weekly-notify',
  '25 16 * * 3',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    -- Reads crm_jail_runs for the window this trigger time implies and shares
    -- each scorecard with its auditor. Touches no CRM.
    body    := '{"notify_only": true}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- To inspect both:
--   select j.jobname, d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname like 'crm-jail-weekly%' order by d.start_time desc limit 10;
