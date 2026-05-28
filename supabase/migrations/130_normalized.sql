-- ───────────────────────────────────────────────────────────────────────────
-- Migration 130 — Normalized mirror tables (Phase 1B chunk 1)
--
-- Operational mirrors that Phase 1C consumes. One row per business entity
-- with normalized enum types — never raw Zoho strings (those live in the
-- raw_* mirrors and get translated via 120_mappings tables during sync).
--
-- RLS shape (CONFIRMED.md project preamble):
--   - admin / manager profiles see all rows.
--   - admissions_rep + bd_rep profiles see only rows where owner_user_id /
--     host_user_id matches their own user_identity row.
--   - Service_role (used by sync edge functions) bypasses RLS for writes.
--
-- Idempotent — uses CREATE TABLE IF NOT EXISTS and drops/recreates policies.
-- ───────────────────────────────────────────────────────────────────────────

-- ── RLS helper functions ──────────────────────────────────────────────────

-- Returns the role string from public.profiles for the current auth user.
CREATE OR REPLACE FUNCTION reporting.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Returns the user_identity.id for the current auth user (resolved via
-- supabase_auth_user_id FK). Returns NULL for users that don't have a
-- corresponding user_identity row (e.g., admin-only accounts).
CREATE OR REPLACE FUNCTION reporting.current_user_identity_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = reporting
AS $$
  SELECT id FROM reporting.user_identity
  WHERE supabase_auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Convenience: is the current request from a manager or admin profile?
CREATE OR REPLACE FUNCTION reporting.is_manager_or_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SET search_path = reporting, public
AS $$
  SELECT reporting.current_user_role() IN ('manager', 'admin');
$$;

-- ── reporting.leads ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.leads (
  id                       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lead_id           TEXT            NOT NULL UNIQUE,
  owner_user_id            UUID            REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  source_category          source_category NOT NULL,
  level_of_care_requested  level_of_care,
  insurance_type           insurance_type,
  lead_score_rating        TEXT,
  star_rating              SMALLINT        CHECK (star_rating IS NULL OR star_rating BETWEEN 0 AND 5),
  bd_rep_inbound           TEXT,
  created_at               TIMESTAMPTZ     NOT NULL,
  ingested_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON reporting.leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON reporting.leads (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_source_category ON reporting.leads (source_category);
CREATE INDEX IF NOT EXISTS idx_leads_insurance_type ON reporting.leads (insurance_type);
CREATE INDEX IF NOT EXISTS idx_leads_loc ON reporting.leads (level_of_care_requested);

COMMENT ON TABLE reporting.leads IS
  'Normalized Lead mirror. Sourced from Zoho Analytics (see METRIC_DEFINITIONS.md §1). '
  'One row per Zoho Lead ID, including converted leads that no longer exist in the live CRM.';

-- ── reporting.deals ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.deals (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  source_deal_id              TEXT            NOT NULL UNIQUE,
  source_lead_id              TEXT,
  owner_user_id               UUID            REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  pipeline                    pipeline        NOT NULL,
  stage_raw                   TEXT            NOT NULL,
  stage_category              stage_category  NOT NULL,
  vob_submitted               BOOLEAN         NOT NULL DEFAULT FALSE,
  vob_submitted_date          DATE,
  level_of_care_requested     level_of_care,
  admitted_level_of_care      level_of_care,
  source_category             source_category NOT NULL,
  created_at                  TIMESTAMPTZ     NOT NULL,
  closing_date                DATE,
  admit_date                  DATE,
  closed_lost_reason          TEXT,
  refer_out_type              TEXT,
  ingested_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON reporting.deals (pipeline);
CREATE INDEX IF NOT EXISTS idx_deals_stage_category ON reporting.deals (stage_category);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON reporting.deals (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_source_lead ON reporting.deals (source_lead_id) WHERE source_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_admit_date ON reporting.deals (admit_date) WHERE admit_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_closing_date ON reporting.deals (closing_date) WHERE closing_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_vob_submitted_date ON reporting.deals (vob_submitted_date) WHERE vob_submitted_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_source_category ON reporting.deals (source_category);

COMMENT ON TABLE reporting.deals IS
  'Normalized Deal mirror. Sourced from Zoho CRM Deals. stage_category is the '
  'normalized rollup; stage_raw preserves the original Zoho string for triage. '
  'VOB priority chain (CONFIRMED.md #33): vob_submitted boolean OR '
  'vob_submitted_date OR stage_category (excluding closed_lost). Admit priority '
  'chain (CONFIRMED.md #34): admit_date OR stage_category = closed_won_admitted.';

-- ── reporting.calls ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.calls (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_call_id  TEXT         NOT NULL UNIQUE,
  owner_user_id   UUID         REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  lead_id         UUID         REFERENCES reporting.leads(id) ON DELETE SET NULL,
  direction       TEXT         NOT NULL CHECK (direction IN ('inbound','outbound')),
  duration_sec    INTEGER,
  occurred_at     TIMESTAMPTZ  NOT NULL,
  missed          BOOLEAN      NOT NULL DEFAULT FALSE,
  ingested_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_occurred ON reporting.calls (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_owner ON reporting.calls (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON reporting.calls (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_direction_missed ON reporting.calls (direction, missed);

COMMENT ON TABLE reporting.calls IS
  'Normalized Call mirror from CTM. Lighter than public.call_sessions; '
  'just owner / direction / duration / missed / lead linkage.';

-- ── reporting.meetings ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.meetings (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_meeting_id   TEXT         NOT NULL UNIQUE,
  host_user_id        UUID         REFERENCES reporting.user_identity(id) ON DELETE SET NULL,
  meeting_type        TEXT         NOT NULL CHECK (meeting_type IN ('Event','In-Service','Drop','Tour','Other')),
  lead_id             UUID         REFERENCES reporting.leads(id) ON DELETE SET NULL,
  account_name        TEXT,
  occurred_at         TIMESTAMPTZ  NOT NULL,
  ingested_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_occurred ON reporting.meetings (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_host ON reporting.meetings (host_user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_type ON reporting.meetings (meeting_type);
CREATE INDEX IF NOT EXISTS idx_meetings_account ON reporting.meetings (account_name) WHERE account_name IS NOT NULL;

COMMENT ON TABLE reporting.meetings IS
  'Normalized Meeting mirror from Zoho CRM Events. meeting_type covers BD '
  'meetings, In-Services, Drops, Tours, and Other.';

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE reporting.leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.deals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.calls    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.meetings ENABLE ROW LEVEL SECURITY;

-- Leads
DROP POLICY IF EXISTS role_scoped_read ON reporting.leads;
CREATE POLICY role_scoped_read ON reporting.leads
  FOR SELECT USING (
    reporting.is_manager_or_admin()
    OR owner_user_id = reporting.current_user_identity_id()
  );

-- Deals
DROP POLICY IF EXISTS role_scoped_read ON reporting.deals;
CREATE POLICY role_scoped_read ON reporting.deals
  FOR SELECT USING (
    reporting.is_manager_or_admin()
    OR owner_user_id = reporting.current_user_identity_id()
  );

-- Calls
DROP POLICY IF EXISTS role_scoped_read ON reporting.calls;
CREATE POLICY role_scoped_read ON reporting.calls
  FOR SELECT USING (
    reporting.is_manager_or_admin()
    OR owner_user_id = reporting.current_user_identity_id()
  );

-- Meetings — host scopes for BD reps; manager/admin see all
DROP POLICY IF EXISTS role_scoped_read ON reporting.meetings;
CREATE POLICY role_scoped_read ON reporting.meetings
  FOR SELECT USING (
    reporting.is_manager_or_admin()
    OR host_user_id = reporting.current_user_identity_id()
  );

-- ───────────────────────────────────────────────────────────────────────────
-- Sanity:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='reporting' ORDER BY table_name;
-- ───────────────────────────────────────────────────────────────────────────
