-- ───────────────────────────────────────────────────────────────────────────
-- Migration 194 — Zoho-id-keyed user directory
--
-- The BD "company owner" filter on /bd/top-accounts has to turn the Zoho
-- Account Owner id that bd-top-accounts returns (`owner_id`) into a human
-- name. `reporting_user_identity_list` (migration 174) only exposes the
-- internal reporting.user_identity UUID, which never matches a raw Zoho
-- owner id — hence this sibling keyed on zoho_user_id.
--
-- Unlike 174 this returns every synced user, not just admissions/bd reps:
-- Accounts in Zoho are owned by admins and court-services staff too, and a
-- filter that silently dropped those owners would hide their accounts.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reporting_zoho_user_directory()
RETURNS TABLE (
  zoho_user_id  TEXT,
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
    SELECT ui.zoho_user_id, ui.full_name, ui.role_derived::TEXT, ui.active
    FROM reporting.user_identity ui
    WHERE ui.zoho_user_id IS NOT NULL
    ORDER BY ui.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_zoho_user_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_zoho_user_directory() TO authenticated, service_role;
