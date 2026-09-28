-- Audit log for ctm-opt-out-to-zoho (CTM STOP/opt-out → Zoho suppression).
-- One row per webhook invocation, including rejections, so a "why didn't
-- this number get suppressed?" question is answerable from the DB.

create table if not exists public.ctm_opt_out_log (
  id            bigint generated always as identity primary key,
  received_at   timestamptz not null default now(),
  activity_id   text,
  phone_last10  text,
  reason        text,
  status        text not null,          -- success | partial | rejected | dry_run | error
  dry_run       boolean not null default false,
  matched       jsonb,
  write_results jsonb,
  error         text
);

create index if not exists ctm_opt_out_log_received_at_idx on public.ctm_opt_out_log (received_at desc);
create index if not exists ctm_opt_out_log_phone_idx on public.ctm_opt_out_log (phone_last10);

alter table public.ctm_opt_out_log enable row level security;
-- Service role only; nothing in the app reads this yet.
