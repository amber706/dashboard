-- ───────────────────────────────────────────────────────────────────────────
-- Migration 110 — Raw mirror tables (Phase 1B chunk 1)
--
-- One raw mirror per upstream source. Each table stores the source's
-- primary key, its modified timestamp, the full raw payload as JSONB,
-- and our ingestion timestamp. The normalization layer (130_normalized)
-- reads from these via the mapping tables (120_mappings).
--
-- All tables live under the `reporting` schema so the new Phase 1B
-- data layer is cleanly separated from the existing fact/dim warehouse
-- that powers current dashboards (parallel-build approach per
-- CONFIRMED.md design discussion).
--
-- RLS: locked to service_role for write; admin profile only for read.
-- End users never touch these — they read from normalized mirrors or
-- (in Phase 1C) the cached op_* tables.
--
-- This migration is idempotent.
-- ───────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS reporting;
COMMENT ON SCHEMA reporting IS
  'Phase 1B+ reporting data layer. Raw mirrors → mappings → normalized → '
  'cached op_metrics. Parallel to the existing fact/dim warehouse; the two '
  'coexist until Phase 2 migrates UI consumers off the legacy schema.';

-- ── reporting.raw_zoho_analytics_leads ────────────────────────────────────
-- Source: Zoho Analytics report "Leads (Zoho CRM)" — workspace 2573883000000036001,
-- view 2573883000000035215. The Analytics-side report is the only place
-- historical lead state survives (Zoho CRM destroys Lead records on conversion).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.raw_zoho_analytics_leads (
  source_id          TEXT        PRIMARY KEY,
  source_modified_at TIMESTAMPTZ,
  raw_payload        JSONB       NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_analytics_leads_ingested
  ON reporting.raw_zoho_analytics_leads (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_analytics_leads_modified
  ON reporting.raw_zoho_analytics_leads (source_modified_at DESC NULLS LAST);

COMMENT ON TABLE reporting.raw_zoho_analytics_leads IS
  'Full snapshot of Zoho Analytics Leads view. source_id = Zoho Lead ID. '
  'Includes converted leads (which are absent from the live CRM Leads module). '
  'Phase 1B sync function: sync_zoho_analytics_leads.';

-- ── reporting.raw_zoho_crm_deals ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.raw_zoho_crm_deals (
  source_id          TEXT        PRIMARY KEY,
  source_modified_at TIMESTAMPTZ,
  raw_payload        JSONB       NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_crm_deals_ingested
  ON reporting.raw_zoho_crm_deals (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_crm_deals_modified
  ON reporting.raw_zoho_crm_deals (source_modified_at DESC NULLS LAST);

COMMENT ON TABLE reporting.raw_zoho_crm_deals IS
  'Zoho CRM Deals raw snapshot, pulled incrementally via COQL with '
  'Modified_Time watermark. source_id = Zoho Deal ID.';

-- ── reporting.raw_zoho_crm_users ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.raw_zoho_crm_users (
  source_id          TEXT        PRIMARY KEY,
  source_modified_at TIMESTAMPTZ,
  raw_payload        JSONB       NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_crm_users_ingested
  ON reporting.raw_zoho_crm_users (ingested_at DESC);

COMMENT ON TABLE reporting.raw_zoho_crm_users IS
  'Zoho CRM Users (active + deactivated). source_id = Zoho User ID. '
  'Feeds reporting.user_identity normalization.';

-- ── reporting.raw_zoho_crm_meetings ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.raw_zoho_crm_meetings (
  source_id          TEXT        PRIMARY KEY,
  source_modified_at TIMESTAMPTZ,
  raw_payload        JSONB       NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_crm_meetings_ingested
  ON reporting.raw_zoho_crm_meetings (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_zoho_crm_meetings_modified
  ON reporting.raw_zoho_crm_meetings (source_modified_at DESC NULLS LAST);

COMMENT ON TABLE reporting.raw_zoho_crm_meetings IS
  'Zoho CRM Meetings (Events) module raw snapshot. Tracks Event records '
  '(BD meetings, In-Service, Drops, Tours). source_id = Zoho Event ID.';

-- ── reporting.raw_ctm_calls ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.raw_ctm_calls (
  source_id          TEXT        PRIMARY KEY,
  source_modified_at TIMESTAMPTZ,
  raw_payload        JSONB       NOT NULL,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_ctm_calls_ingested
  ON reporting.raw_ctm_calls (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_ctm_calls_modified
  ON reporting.raw_ctm_calls (source_modified_at DESC NULLS LAST);

COMMENT ON TABLE reporting.raw_ctm_calls IS
  'Call Tracking Metrics raw snapshot. source_id = CTM call_id. '
  'Distinct from public.call_sessions (which is the rich app-side mirror); '
  'this is the literal source payload for verification/replay.';

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Raw mirrors are write-only via service_role (used by sync edge functions)
-- and read-only for the `admin` profile. Specialists and managers never see
-- raw payloads; they consume the normalized mirrors and (in Phase 1C) the
-- op_metric tables.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE reporting.raw_zoho_analytics_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.raw_zoho_crm_deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.raw_zoho_crm_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.raw_zoho_crm_meetings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.raw_ctm_calls            ENABLE ROW LEVEL SECURITY;

-- Helper: is the current request from an admin profile?
CREATE OR REPLACE FUNCTION reporting.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  );
$$;

-- One policy block per raw table. service_role bypasses RLS by default;
-- we only need the admin-read policy explicitly.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'raw_zoho_analytics_leads',
    'raw_zoho_crm_deals',
    'raw_zoho_crm_users',
    'raw_zoho_crm_meetings',
    'raw_ctm_calls'
  ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS admin_read ON reporting.%I',
      t
    );
    EXECUTE format(
      'CREATE POLICY admin_read ON reporting.%I FOR SELECT USING (reporting.is_admin())',
      t
    );
  END LOOP;
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Sync runs log — every sync execution records here for observability.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporting.sync_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  TEXT        NOT NULL,
  source         TEXT        NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  rows_processed INTEGER     NOT NULL DEFAULT 0,
  rows_failed    INTEGER     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','success','failure','partial')),
  error_message  TEXT,
  watermark_used TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_function_started
  ON reporting.sync_runs (function_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started
  ON reporting.sync_runs (status, started_at DESC);

COMMENT ON TABLE reporting.sync_runs IS
  'One row per sync edge function execution. Drives v_sync_health (Phase 1B '
  'chunk 4) and is the audit trail for incremental watermarks.';

ALTER TABLE reporting.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_read ON reporting.sync_runs;
CREATE POLICY admin_read ON reporting.sync_runs
  FOR SELECT USING (reporting.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- Sanity:
--   SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='reporting';
--   -- expected at least 6 after this migration
-- ───────────────────────────────────────────────────────────────────────────
