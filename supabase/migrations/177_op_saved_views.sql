-- ───────────────────────────────────────────────────────────────────────────
-- Migration 177 — Saved filter views (Phase 1C)
--
-- One small table + three RPCs powering the SavedViewsControl. Each user's
-- bookmarks are scoped by page_key (e.g. 'op-funnel', 'op-referrals') so
-- a "BD focus" view on one page doesn't pollute another. RLS pins each
-- user to their own rows; upsert + delete go through SECURITY DEFINER
-- functions that double-check auth.uid().
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporting.saved_filter_views (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key    TEXT         NOT NULL,
  name        TEXT         NOT NULL CHECK (length(trim(name)) > 0),
  filters     JSONB        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, page_key, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_filter_views_user_page
  ON reporting.saved_filter_views (user_id, page_key, created_at DESC);

ALTER TABLE reporting.saved_filter_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_rows_select ON reporting.saved_filter_views;
DROP POLICY IF EXISTS own_rows_insert ON reporting.saved_filter_views;
DROP POLICY IF EXISTS own_rows_delete ON reporting.saved_filter_views;

CREATE POLICY own_rows_select ON reporting.saved_filter_views
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY own_rows_insert ON reporting.saved_filter_views
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY own_rows_delete ON reporting.saved_filter_views
  FOR DELETE USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.reporting_op_saved_views_list(p_page_key TEXT)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  filters      JSONB,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = reporting, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  RETURN QUERY
    SELECT v.id, v.name, v.filters, v.created_at
    FROM reporting.saved_filter_views v
    WHERE v.user_id = auth.uid()
      AND v.page_key = p_page_key
    ORDER BY v.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_saved_views_upsert(
  p_page_key TEXT,
  p_name     TEXT,
  p_filters  JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = reporting, public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  INSERT INTO reporting.saved_filter_views (user_id, page_key, name, filters)
  VALUES (v_uid, p_page_key, p_name, p_filters)
  ON CONFLICT (user_id, page_key, name)
  DO UPDATE SET filters = EXCLUDED.filters, created_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reporting_op_saved_views_delete(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = reporting, public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_deleted INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  DELETE FROM reporting.saved_filter_views
   WHERE id = p_id AND user_id = v_uid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_op_saved_views_list(TEXT)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_saved_views_upsert(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reporting_op_saved_views_delete(UUID)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_op_saved_views_list(TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_op_saved_views_upsert(TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_op_saved_views_delete(UUID)             TO authenticated;
