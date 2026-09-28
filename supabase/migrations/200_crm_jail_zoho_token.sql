-- 200_crm_jail_zoho_token.sql
--
-- The CRM Jail bot needs a Zoho token shared across its nine per-rep
-- invocations: nine simultaneous mints got a rep throttled outright
-- ("You have made too many requests continuously").
--
-- It does NOT reuse public.zoho_token_cache. That singleton is written by
-- another function on its own schedule and with its own OAuth scopes; reading
-- it produced a 401 on every call. A token this bot did not mint is a token
-- whose scopes and lifetime it cannot reason about.

create table if not exists public.crm_jail_zoho_token (
  singleton    boolean primary key default true check (singleton),
  access_token text        not null,
  expires_at   timestamptz not null,
  refreshed_at timestamptz not null default now()
);

alter table public.crm_jail_zoho_token enable row level security;

-- No policies: the edge function uses the service role and bypasses RLS.
-- Nothing else should ever read this table, so it gets no policy at all.

comment on table public.crm_jail_zoho_token is
  'Zoho access token shared across the CRM Jail bot''s per-rep invocations. Service role only; deliberately separate from zoho_token_cache.';
