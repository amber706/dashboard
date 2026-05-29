-- ───────────────────────────────────────────────────────────────────────────
-- Migration 181 — reporting_load_ctm_agent_map RPC
--
-- Returns the ctm_agent_id -> user_identity.id mapping for active reps.
-- Used by reporting-sync-calls to resolve owner_user_id during CTM
-- ingest (replacing the hardcoded `owner_user_id: null` from earlier).
-- Same shape as reporting_load_owner_map (which does the same thing
-- for zoho_user_id -> user_identity.id).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_load_ctm_agent_map()
RETURNS TABLE(ctm_agent_id TEXT, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reporting, public
AS $$
BEGIN
  RETURN QUERY
    SELECT ui.ctm_agent_id::TEXT, ui.id
    FROM reporting.user_identity ui
    WHERE ui.ctm_agent_id IS NOT NULL
      AND ui.active = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_load_ctm_agent_map() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_load_ctm_agent_map() TO service_role;
