-- 205_crm_jail_daily_digest.sql
--
-- Split the daily digest out of the daily run, as 202 did for the weekly.
--
-- 2026-10-02: crm-jail-daily took ~3.5 minutes for 14 reps. The gateway
-- answered pg_net with 504 IDLE_TIMEOUT at 150s. The worker kept going and
-- every rep's list went out, but the digests were the dispatcher's last step
-- and neither Aaron nor Megan got one. Each daily child now writes its outcome
-- here, and a second job 30 minutes later builds the digests from this table.
-- A rep whose check never finished has no row, and the digest says so.

create table if not exists public.crm_jail_daily_runs (
  run_date        date        not null,
  zoho_user_id    text        not null,
  full_name       text        not null,
  team            text        not null,
  -- sent | clean | no_activity | failed
  status          text        not null,
  records_checked integer     not null default 0,
  -- The rep's misses, so the digest can count records and fields. Same
  -- content the rep's own sheet carries.
  misses          jsonb       not null default '[]'::jsonb,
  sheet_url       text,
  sent_to         text,
  error_msg       text,
  recorded_at     timestamptz not null default now(),
  primary key (run_date, zoho_user_id)
);

-- Service role only, like crm_jail_runs: the edge function writes and reads it.
alter table public.crm_jail_daily_runs enable row level security;

select cron.unschedule('crm-jail-daily-digest')
where exists (select 1 from cron.job where jobname = 'crm-jail-daily-digest');

-- 15:40 UTC = 08:40 Phoenix, 30 minutes after crm-jail-daily. Reads the same
-- audited day (yesterday, Phoenix) and touches no CRM.
select cron.schedule(
  'crm-jail-daily-digest',
  '40 15 * * *',
  $$
  select net.http_post(
    url     := 'https://fortdxbbazifklqwydnk.supabase.co/functions/v1/crm-jail',
    headers := jsonb_build_object(
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{"daily_digest": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To inspect a day:
--   select full_name, team, status, records_checked, jsonb_array_length(misses) misses, error_msg
--   from crm_jail_daily_runs where run_date = current_date - 1 order by team, full_name;
