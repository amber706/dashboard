-- 196_crm_jail_roster_and_runs.sql
--
-- CRM Jail Audit Bot, Phase 1. Two tables:
--   crm_jail_roster  who gets audited
--   crm_jail_runs    one row per (rep, window) attempt
--
-- WHY NOT public.profiles, and why not the Zoho profile picklist:
--
--   1. profiles already carries is_admissions_rep / is_bd_rep / team columns,
--      but as of 2026-09-15 they are dead: every active profile has both flags
--      false and team null. Nothing populates them.
--   2. profiles is missing 5 of the 9 reps being audited — Joey Masterson,
--      Ben Coulter, Kenny Reitz, Andrew Pritchert and Taylor Bertchie have no
--      row. BD reps do not use the dashboard, so they have no auth user, and
--      minting auth users purely to audit them would be wrong.
--   3. Zoho profiles identify a CANDIDATE POOL, not the roster. Confirmed by
--      Amber 2026-09-15: admissions reps carry "TREATMENT Standard" — but so
--      does intake, which is the exact problem the original spec named
--      ("intake having the same roles and profiles"). That profile holds 14
--      users, of whom 3 were audited, and includes a Court Services
--      Coordinator. The pool also misses a real rep: Sabrina Johnson was
--      audited but carries "Administrator".
--
-- So crm-jail/roster-sync.ts discovers candidates from mapped profiles and
-- inserts them INACTIVE; a human activates the ones who are really reps.
-- This table is that human decision, keyed on the Zoho user id — the only
-- identifier that covers every rep. Seeded below with verified live ids.
--
-- Status columns are free text on purpose: a CHECK constraint is what
-- silently killed gclid_backfill_log.

create table if not exists public.crm_jail_roster (
  id            uuid primary key default gen_random_uuid(),
  zoho_user_id  text not null unique,
  full_name     text not null,
  email         text not null,
  team          text not null,            -- 'admissions' | 'bd'
  auditor_email text not null,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_jail_roster_active_idx
  on public.crm_jail_roster (active, team);

create table if not exists public.crm_jail_runs (
  id             uuid primary key default gen_random_uuid(),
  run_at         timestamptz not null default now(),
  window_start   date not null,
  window_end     date not null,
  zoho_user_id   text not null,
  full_name      text,
  team           text,
  sheet_id       text,
  sheet_url      text,
  overall_note   text,
  status         text,                    -- 'ok' | 'failed' | 'skipped_no_activity'
  deferred_cells integer default 0,
  error_msg      text,
  created_at     timestamptz not null default now()
);

create unique index if not exists crm_jail_runs_rep_window_idx
  on public.crm_jail_runs (zoho_user_id, window_start);

alter table public.crm_jail_roster enable row level security;
alter table public.crm_jail_runs   enable row level security;

-- Scorecards reference real client records, so these are admin-only.
-- The edge function uses the service role and bypasses RLS.
drop policy if exists crm_jail_roster_admin_all on public.crm_jail_roster;
create policy crm_jail_roster_admin_all on public.crm_jail_roster
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists crm_jail_runs_admin_read on public.crm_jail_runs;
create policy crm_jail_runs_admin_read on public.crm_jail_runs
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Seed. Zoho user ids verified live 2026-09-15.
-- BD is the exact Business Development profile membership.
-- Admissions is the 4 reps Megan actually audited for 8/31-9/4 and MUST be
-- confirmed by her before the first live run.
insert into public.crm_jail_roster
  (zoho_user_id, full_name, email, team, auditor_email, notes)
values
  ('5162065000343001001', 'Andrew Pritchert', 'andrewp@cornerstonehealingcenter.com',        'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('5162065000329857001', 'Ben Coulter',      'benc@cornerstonehealingcenter.com',           'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('5162065000088795001', 'Joey Masterson',   'joelm@cornerstonehealingcenter.com',          'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('5162065000338140002', 'Kenny Reitz',      'kennyr@cornerstonehealingcenter.com',         'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('5162065000138237001', 'Mike Mcluty',      'mikemcluty@cornerstonehealingcenter.com',     'bd',         'aaron@cornerstonehealingcenter.com', 'Business Development profile'),
  ('5162065000242111001', 'Eric Wade',        'ericw@cornerstonehealingcenter.com',          'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4'),
  ('5162065000207341001', 'Michael Mendez',   'michaelm@cornerstonehealingcenter.com',       'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4'),
  ('5162065000095953001', 'Sabrina Johnson',  'sabrinaj@cornerstonehealingcenter.com',       'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4; Administrator profile in Zoho, not TREATMENT Standard'),
  ('5162065000185233001', 'Taylor Bertchie',  'taylorbertchie@cornerstonehealingcenter.com', 'admissions', 'megan@cornerstonehealingcenter.com', 'audited 8/31-9/4')
on conflict (zoho_user_id) do nothing;
