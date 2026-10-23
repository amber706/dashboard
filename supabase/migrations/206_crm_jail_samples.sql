-- 206_crm_jail_samples.sql
--
-- Which owned records each weekly audit drew, and what they failed.
--
-- Aaron, 2026-10-14: BD Companies and Business Contacts are now sampled from
-- everything the rep owns, not from what they touched that week, to see
-- whether the corrections a record draws are made and stay made. This table
-- enforces the no-repeat rule (not within 90 days when the rep owns enough,
-- never within 30; see sampleRotating in crm-jail/sampler.ts) and keeps each
-- draw's failed items so a record's next draw can be compared to its last.

create table if not exists public.crm_jail_samples (
  window_start  date        not null,
  zoho_user_id  text        not null,
  -- "Companies" | "BusinessContacts"
  section       text        not null,
  record_id     text        not null,
  record_name   text        not null default '',
  -- Item ids that scored 0, e.g. {CO4,CO7}. Empty means the record passed.
  failed_items  text[]      not null default '{}',
  sampled_at    timestamptz not null default now(),
  primary key (window_start, zoho_user_id, section, record_id)
);

create index if not exists crm_jail_samples_history
  on public.crm_jail_samples (zoho_user_id, section, window_start);

-- Service role only, like crm_jail_runs.
alter table public.crm_jail_samples enable row level security;

-- Whether fixes stuck: every record drawn more than once, oldest draw first.
--   select record_name, section, window_start, failed_items
--   from crm_jail_samples s
--   where (select count(*) from crm_jail_samples t
--          where t.record_id = s.record_id and t.section = s.section) > 1
--   order by record_id, window_start;
