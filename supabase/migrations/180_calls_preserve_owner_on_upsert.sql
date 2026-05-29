-- ───────────────────────────────────────────────────────────────────────────
-- Migration 180 — reporting_upsert_calls: preserve owner_user_id on NULL
--
-- The CTM sync (reporting-sync-calls edge function) currently passes
-- owner_user_id = NULL on every row because the ctm_agent_id ->
-- user_identity.id lookup was never wired up (see TODO in
-- reporting-sync-calls/index.ts:78). We backfilled the existing 7,910
-- calls via SQL by joining raw_ctm_calls.agent.id -> user_identity
-- after populating user_identity.ctm_agent_id from email match.
--
-- Without this change, the next sync would clobber that work because
-- the original UPSERT did `owner_user_id = EXCLUDED.owner_user_id`
-- unconditionally. COALESCE preserves the existing value when the
-- incoming row sends NULL.
--
-- When the calls sync is updated to populate owner_user_id correctly,
-- this COALESCE becomes a no-op for typical rows.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_upsert_calls(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_count INTEGER;
BEGIN
  WITH input AS (
    SELECT (r->>'source_call_id')::TEXT AS source_call_id,
           NULLIF(r->>'owner_user_id','')::UUID AS owner_user_id,
           NULLIF(r->>'lead_id','')::UUID AS lead_id,
           (r->>'direction')::TEXT AS direction,
           NULLIF(r->>'duration_sec','')::INTEGER AS duration_sec,
           (r->>'occurred_at')::TIMESTAMPTZ AS occurred_at,
           COALESCE((r->>'missed')::BOOLEAN, FALSE) AS missed
    FROM jsonb_array_elements(p_rows) r
  )
  INSERT INTO reporting.calls (source_call_id, owner_user_id, lead_id, direction, duration_sec, occurred_at, missed)
  SELECT source_call_id, owner_user_id, lead_id, direction, duration_sec, occurred_at, missed FROM input
  ON CONFLICT (source_call_id) DO UPDATE SET
    owner_user_id = COALESCE(EXCLUDED.owner_user_id, reporting.calls.owner_user_id),
    lead_id       = COALESCE(EXCLUDED.lead_id,       reporting.calls.lead_id),
    direction     = EXCLUDED.direction,
    duration_sec  = EXCLUDED.duration_sec,
    occurred_at   = EXCLUDED.occurred_at,
    missed        = EXCLUDED.missed;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;
