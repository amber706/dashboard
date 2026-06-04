-- ───────────────────────────────────────────────────────────────────────────
-- Migration 166 — Payer mix RPC (Phase 1C)
--
-- Classifies leads created in the window into:
--   - DUI:            level_of_care_requested = 'dui'
--   - DV:             level_of_care_requested = 'dv'
--   - AHCCCS Lead:    treatment LOC AND (insurance = 'AHCCCS' OR
--                                        (insurance NULL AND star = 3))
--   - Commercial Lead:treatment LOC AND (insurance ∈ {Private Insurance, Cash Pay}
--                                        OR (insurance NULL AND star ∈ {4,5}))
--   - Other Payer:    treatment LOC AND insurance ∈ {Medicare, No Insurance,
--                                                    Out of State Medicaid}
--   - Unclassified:   everything else — in practice: treatment LOC + insurance
--                     NULL + star_rating ∈ {0,1,2}. NOTE: star_rating is never
--                     NULL (ETL defaults an absent Lead Score Rating to 0), so a
--                     LOW/unscored star — not a missing one — is the trigger.
--                     These are overwhelmingly early-funnel leads whose payer is
--                     confirmed later at VOB (investigated 2026-06-02; not an ETL
--                     gap). Surfaced on the executive dashboard as "Payer Pending".
--
-- NOTE: this is the original (pre-filter) RPC. The LIVE definition the dashboard
-- calls is reporting_op_payer_mix_filtered — see migration 175 (adds rep filter).
--
-- The COALESCE(..., TRUE) on the gate lets service-role contexts call this
-- (matches the pattern in the verifier RPCs); user-facing calls go through
-- supabase-js with an auth context where is_manager_or_admin() returns
-- a real boolean.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_op_payer_mix(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  bucket          TEXT,
  count           INTEGER,
  share           NUMERIC(6,4)
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    WITH classified AS (
      SELECT
        CASE
          WHEN l.level_of_care_requested = 'dui' THEN 'DUI'
          WHEN l.level_of_care_requested = 'dv'  THEN 'DV'
          WHEN l.level_of_care_requested IS NULL
            OR l.level_of_care_requested NOT IN ('dui','dv') THEN
            CASE
              WHEN l.insurance_type = 'AHCCCS' THEN 'AHCCCS Lead'
              WHEN l.insurance_type IN ('Private Insurance','Cash Pay') THEN 'Commercial Lead'
              WHEN l.insurance_type IN ('Medicare','No Insurance','Out of State Medicaid') THEN 'Other Payer Lead'
              WHEN l.insurance_type IS NULL AND l.star_rating = 3 THEN 'AHCCCS Lead'
              WHEN l.insurance_type IS NULL AND l.star_rating IN (4,5) THEN 'Commercial Lead'
              ELSE 'Unclassified'
            END
          ELSE 'Unclassified'
        END AS bucket
      FROM reporting.leads l
      WHERE (l.created_at AT TIME ZONE 'America/Phoenix')::DATE BETWEEN p_start AND p_end
    ),
    totals AS (SELECT COUNT(*)::NUMERIC AS n FROM classified)
    SELECT
      c.bucket,
      COUNT(*)::INT,
      CASE WHEN (SELECT n FROM totals) > 0
           THEN ROUND(COUNT(*)::NUMERIC / (SELECT n FROM totals), 4)
           ELSE NULL END
    FROM classified c
    GROUP BY c.bucket
    ORDER BY COUNT(*) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_payer_mix(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_payer_mix(DATE, DATE) TO authenticated, service_role;
