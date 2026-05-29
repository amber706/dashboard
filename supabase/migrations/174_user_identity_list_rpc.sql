-- ───────────────────────────────────────────────────────────────────────────
-- Migration 174 — UI-facing rep list (Phase 1C)
--
-- Powers the Sales Rep multi-select in the FilterBar. Filters to active
-- specialists in admissions_rep or bd_rep roles; "other" profiles are
-- excluded from the picker since they're not part of any per-rep funnel
-- attribution.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_user_identity_list()
RETURNS TABLE (
  id            UUID,
  full_name     TEXT,
  role_derived  TEXT,
  active        BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF NOT COALESCE(reporting.is_manager_or_admin(), TRUE) THEN
    RAISE EXCEPTION 'role_scoped_read: manager/admin only';
  END IF;

  RETURN QUERY
    SELECT ui.id, ui.full_name, ui.role_derived::TEXT, ui.active
    FROM reporting.user_identity ui
    WHERE ui.active = TRUE
      AND ui.role_derived IN ('admissions_rep', 'bd_rep')
    ORDER BY ui.role_derived, ui.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_user_identity_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_user_identity_list() TO authenticated, service_role;
