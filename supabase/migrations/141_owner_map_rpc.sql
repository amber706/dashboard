-- ───────────────────────────────────────────────────────────────────────────
-- Migration 141 — Bulk owner map RPC
--
-- The sync functions (deals/meetings/calls) need to map Zoho Owner.id to
-- reporting.user_identity.id for every row. Calling
-- reporting_resolve_owner_id() per row inflates a 20k-deal backfill into
-- 20k+ round trips and trips the edge function timeout.
--
-- This RPC returns the entire user_identity map in one call. The function
-- loads it once at start and resolves owners locally via a Map lookup.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_load_owner_map()
RETURNS TABLE (zoho_user_id TEXT, user_id UUID)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = reporting, public
AS $$
  SELECT zoho_user_id, id FROM reporting.user_identity;
$$;

REVOKE ALL ON FUNCTION public.reporting_load_owner_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_load_owner_map() TO service_role;
