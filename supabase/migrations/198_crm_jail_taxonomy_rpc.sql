-- 198_crm_jail_taxonomy_rpc.sql
--
-- The reporting schema is not exposed through PostgREST, and the CRM Jail rule
-- engine needs the raw -> normalized taxonomy to gate conditional items
-- (BD-sourced, referred out, closed won, closed lost).
--
-- Rather than exposing the whole schema, this returns just the two mapping
-- tables. SECURITY DEFINER with a pinned search_path, and EXECUTE granted to
-- service_role only — anon and authenticated cannot call it, unlike the older
-- reporting_* RPCs the security advisor flags.

create or replace function public.crm_jail_taxonomy()
returns table (kind text, raw_value text, normalized_value text)
language sql
security definer
set search_path = reporting, public, pg_temp
stable
as $$
  select 'stage'::text,  s.raw_value::text, s.normalized_value::text
    from reporting.stage_mapping s
  union all
  select 'source'::text, c.raw_value::text, c.normalized_value::text
    from reporting.source_category_mapping c
$$;

revoke all on function public.crm_jail_taxonomy() from public, anon, authenticated;
grant execute on function public.crm_jail_taxonomy() to service_role;

comment on function public.crm_jail_taxonomy() is
  'Raw -> normalized stage and source-category mappings for the CRM Jail audit bot. Service role only.';
