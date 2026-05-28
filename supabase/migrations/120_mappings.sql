-- ───────────────────────────────────────────────────────────────────────────
-- Migration 120 — Normalization + mapping tables (Phase 1B chunk 1)
--
-- Three pieces:
--   1. reporting.user_identity — normalized rep table joining Zoho User IDs,
--      CTM agent IDs, and (where applicable) Supabase auth users.
--   2. Four mapping tables — raw upstream strings → normalized enum values
--      from Phase 1A. Seeded from the constants in src/lib/metrics/definitions.ts.
--   3. reporting.sync_failures — every unmappable raw value lands here for
--      triage so the operator can decide whether to extend the mapping or
--      clean up the upstream picklist.
--
-- Idempotent. Seeds use ON CONFLICT DO NOTHING so re-running won't disturb
-- operator-managed rows.
-- ───────────────────────────────────────────────────────────────────────────

-- ── reporting.user_identity ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.user_identity (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  zoho_user_id           TEXT         UNIQUE,
  ctm_agent_id           TEXT         UNIQUE,
  full_name              TEXT         NOT NULL,
  email                  TEXT,
  profile_name           TEXT,
  role_derived           rep_role     NOT NULL DEFAULT 'other',
  active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  supabase_auth_user_id  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_identity_email ON reporting.user_identity (lower(email));
CREATE INDEX IF NOT EXISTS idx_user_identity_role_active
  ON reporting.user_identity (role_derived, active);
CREATE INDEX IF NOT EXISTS idx_user_identity_supabase_auth
  ON reporting.user_identity (supabase_auth_user_id)
  WHERE supabase_auth_user_id IS NOT NULL;

COMMENT ON TABLE reporting.user_identity IS
  'Normalized rep table. One row per unique person, joining Zoho User ID, '
  'CTM agent ID, and Supabase auth user when present. role_derived is '
  'computed during user sync from Zoho Profile per CONFIRMED.md #15.';

-- ── reporting.source_category_mapping ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.source_category_mapping (
  raw_value         TEXT             PRIMARY KEY,
  normalized_value  source_category  NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reporting.source_category_mapping IS
  'Raw Zoho Source_Category picklist value -> normalized source_category enum. '
  'Source_Category is a Zoho Global Picklist (CONFIRMED.md #35), so the same '
  'mapping serves both Leads and Deals. Catch-all rule: anything not BD or '
  'ZocDoc rolls up to digital_marketing.';

-- ── reporting.loc_mapping ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.loc_mapping (
  raw_value         TEXT          PRIMARY KEY,
  normalized_value  level_of_care NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reporting.loc_mapping IS
  'Raw Zoho LOC string -> normalized level_of_care enum. Used for both '
  '`Level_of_Care_Requested` (Leads + Deals) and `Admitted_Level_of_Care` '
  '(Deals, Admit metric only) per CONFIRMED.md #11 + #21.';

-- ── reporting.pipeline_mapping ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.pipeline_mapping (
  raw_value         TEXT       PRIMARY KEY,
  normalized_value  pipeline   NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reporting.pipeline_mapping IS
  'Raw Zoho Pipeline string -> normalized pipeline enum. Both display and '
  'actual_value forms are stored; sync can match either.';

-- ── reporting.stage_mapping ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.stage_mapping (
  raw_value         TEXT             PRIMARY KEY,
  normalized_value  stage_category   NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reporting.stage_mapping IS
  'Raw Zoho Stage string -> normalized stage_category enum. Both display '
  'labels (what the rep sees) and stored actual_value (what the API returns) '
  'are seeded — sync can match either form. See CONFIRMED.md #23.';

-- ── reporting.sync_failures ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reporting.sync_failures (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id   UUID         REFERENCES reporting.sync_runs(id) ON DELETE SET NULL,
  source        TEXT         NOT NULL,
  source_id     TEXT,
  failure_type  TEXT         NOT NULL
                              CHECK (failure_type IN (
                                'unmapped_stage',
                                'unmapped_source_category',
                                'unmapped_loc',
                                'unmapped_pipeline',
                                'unmapped_insurance_type',
                                'orphan_deal',
                                'orphan_call',
                                'schema_mismatch',
                                'normalization_error'
                              )),
  raw_value     TEXT,
  raw_payload   JSONB,
  error_message TEXT,
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_failures_type_occurred
  ON reporting.sync_failures (failure_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_failures_unresolved
  ON reporting.sync_failures (occurred_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE reporting.sync_failures IS
  'Triage queue for unmappable raw values + orphan rows. Phase 1B data-quality '
  'views (chunk 4) query this. Operator extends a mapping table or cleans up '
  'Zoho, then sets resolved_at to clear.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS — all mapping + identity tables admin-readable; service_role writes.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE reporting.user_identity           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.source_category_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.loc_mapping             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.pipeline_mapping        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.stage_mapping           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.sync_failures           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'user_identity','source_category_mapping','loc_mapping',
    'pipeline_mapping','stage_mapping','sync_failures'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_read ON reporting.%I', t);
    EXECUTE format(
      'CREATE POLICY admin_read ON reporting.%I FOR SELECT USING (reporting.is_admin())',
      t
    );
  END LOOP;
END$$;

-- All authenticated users need to read user_identity to resolve owner names.
-- It's not sensitive (names + roles, no PHI), so widen the read.
DROP POLICY IF EXISTS authenticated_read ON reporting.user_identity;
CREATE POLICY authenticated_read ON reporting.user_identity
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ───────────────────────────────────────────────────────────────────────────
-- Seeds — pulled directly from src/lib/metrics/definitions.ts constants.
-- ON CONFLICT DO NOTHING so re-running won't overwrite operator changes.
-- ───────────────────────────────────────────────────────────────────────────

-- source_category_mapping: 13 Zoho Global Picklist values (CONFIRMED.md #35).
INSERT INTO reporting.source_category_mapping (raw_value, normalized_value, notes) VALUES
  ('Business Development', 'business_development', 'BD reps'' outreach'),
  ('ZocDoc',               'zocdoc',               'ZocDoc-sourced'),
  ('Alumni',               'digital_marketing',    'Catch-all: alumni referrals fold into digital'),
  ('Call Center',          'digital_marketing',    'Catch-all (CONFIRMED.md #35)'),
  ('Directory Listing',    'digital_marketing',    'Catch-all'),
  ('Internal',             'digital_marketing',    'Catch-all'),
  ('Option 1',             'digital_marketing',    'Placeholder picklist value; see OPEN_QUESTION #34'),
  ('Option 2',             'digital_marketing',    'Placeholder picklist value; see OPEN_QUESTION #34'),
  ('Organic Social',       'digital_marketing',    'Digital channel'),
  ('Paid Social',          'digital_marketing',    'Digital channel'),
  ('PPC',                  'digital_marketing',    'Digital channel'),
  ('SEO',                  'digital_marketing',    'Digital channel')
ON CONFLICT (raw_value) DO NOTHING;

-- loc_mapping: 13 Cornerstone-specific values (CONFIRMED.md #11).
-- Both display ("VIOP Adult") and actual ("VIOP") forms seeded.
INSERT INTO reporting.loc_mapping (raw_value, normalized_value, notes) VALUES
  ('BHRF',             'bhrf',             'Behavioral Health Residential Facility (Arizona term)'),
  ('Detox',            'detox',            NULL),
  ('PHP',              'php',              'Partial Hospitalization'),
  ('IOP5',             'iop5',             '5-day Intensive Outpatient'),
  ('IOP3',             'iop3',             '3-day Intensive Outpatient'),
  ('VIOP Adult',       'viop_adult',       'Virtual IOP (display label)'),
  ('VIOP',             'viop_adult',       'Virtual IOP (stored actual_value for VIOP Adult)'),
  ('VIOP Adolescent',  'viop_adolescent',  NULL),
  ('OP',               'op',               'Outpatient'),
  ('VOP',              'vop',              'Virtual Outpatient'),
  ('VOP Adult',        'vop_adult',        NULL),
  ('VOP Adolescent',   'vop_adolescent',   NULL),
  ('DUI',              'dui',              'Lead LOC; routes to DUI - Cash pipeline'),
  ('DV',               'dv',               'Lead LOC; routes to DV - Cash pipeline')
ON CONFLICT (raw_value) DO NOTHING;

-- pipeline_mapping: 5 pipelines + Zoho actual_value aliases (CONFIRMED.md #5).
INSERT INTO reporting.pipeline_mapping (raw_value, normalized_value, notes) VALUES
  ('Commercial-Cash',      'commercial_cash', 'Display label'),
  ('Standard (TREATMENT)', 'commercial_cash', 'Stored actual_value for Commercial-Cash'),
  ('AHCCCS',               'ahcccs',          NULL),
  ('ZocDoc',               'zocdoc',          NULL),
  ('DUI - Cash',           'dui_cash',        NULL),
  ('DUI',                  'dui_cash',        'Legacy 7th pipeline value; rolls into DUI - Cash'),
  ('DV - Cash',            'dv_cash',         NULL)
ON CONFLICT (raw_value) DO NOTHING;

-- stage_mapping: 53 Zoho stage values + actual_value aliases (CONFIRMED.md #23).
-- Sourced from src/lib/metrics/definitions.ts RAW_STAGE_TO_CATEGORY plus
-- the Deal Stage picklist display↔actual differences pulled via getFields.
INSERT INTO reporting.stage_mapping (raw_value, normalized_value, notes) VALUES
  -- In progress: Stuck Lead variants + DUI/DV pre-pipeline + Zoho-default debris
  ('Stuck Lead - Commercial/Cash',   'in_progress', 'Display'),
  ('Stuck Lead',                      'in_progress', 'Stored actual for Stuck Lead - Commercial/Cash'),
  ('Stuck Lead - Ahcccs',             'in_progress', 'Display'),
  ('Referring Out',                   'in_progress', 'Stored actual for Stuck Lead - Ahcccs (data quirk)'),
  ('Stuck Lead - DUI (Cash)',         'in_progress', NULL),
  ('Stuck Lead - DV (Cash)',          'in_progress', NULL),
  ('Stuck Lead - ZocDoc',             'in_progress', NULL),
  ('Qualifying Services',             'in_progress', 'DUI early stage'),
  ('Scheduled Payment',               'in_progress', NULL),
  ('Schedule Payment',                'in_progress', NULL),
  ('Stuck / Contacted',               'in_progress', NULL),
  ('Prequalified',                    'in_progress', 'Zoho default'),
  ('Qualification',                   'in_progress', 'Zoho default'),
  ('Qualified- Needs Follow Up',      'in_progress', 'Zoho default'),
  ('Value Proposition',               'in_progress', 'Zoho default'),
  ('Identify Decision Makers',        'in_progress', 'Zoho default'),
  ('Proposal/Price Quote',            'in_progress', 'Zoho default'),
  ('Quote',                           'in_progress', 'Zoho default'),
  ('Awaiting Payment',                'in_progress', 'Zoho default'),
  ('On Payment Plan',                 'in_progress', NULL),
  ('Closed - Sold',                   'in_progress', 'Legacy; not active'),
  ('Closed - Sold Screening',         'in_progress', 'Legacy; not active'),
  ('Closed - Sold Screening & Class', 'in_progress', 'Legacy; not active'),
  ('Closed - Sold Classes',           'in_progress', 'Legacy; not active'),
  ('Scheduled- Other',                'in_progress', NULL),
  ('Discharged',                      'in_progress', 'Post-admit; outside our funnel'),
  ('None',                            'in_progress', 'Default empty'),

  -- VOB
  ('VOB - Qualifying',                'vob_qualifying', NULL),
  ('Qualifying- VOB',                 'vob_qualifying', 'Display'),
  ('Needs Analysis',                  'vob_qualifying', 'Stored actual for Qualifying- VOB'),
  ('VOB - Approved',                  'vob_approved',   NULL),

  -- Pre-admit: PA, Pre Screen, Intake, Step Down, Direct Admit, Orientation, Open Payment Plan
  ('PA - Scheduling/Scheduled',       'pre_admit', 'Display'),
  ('PA - Qualifying',                 'pre_admit', 'Stored actual for PA - Scheduling/Scheduled'),
  ('PA - Completed',                  'pre_admit', 'Display'),
  ('PA - Approved',                   'pre_admit', 'Stored actual for PA - Completed'),
  ('PA - In-Progress',                'pre_admit', NULL),
  ('Pre Screen - Scheduled',          'pre_admit', 'Display'),
  ('Tour - Scheduled',                'pre_admit', 'Stored actual for Pre Screen - Scheduled'),
  ('Pre Screen - Completed',          'pre_admit', NULL),
  ('Intake Assessment - Scheduled',   'pre_admit', NULL),
  ('Intake Scheduled',                'pre_admit', 'DV'),
  ('Orientation Scheduled',           'pre_admit', 'DV'),
  ('Direct Admit - Scheduled',        'pre_admit', NULL),
  ('Step Down - Scheduled',           'pre_admit', NULL),
  ('Scheduled- Step Down',            'pre_admit', NULL),
  ('Scheduled- Detox',                'pre_admit', 'Display'),
  ('Scheduled',                       'pre_admit', 'Stored actual for Scheduled- Detox'),
  ('Transportation Scheduled',        'pre_admit', NULL),
  ('Open Payment Plan',               'pre_admit', 'DUI mid-pipeline with positive indicator'),
  ('Qualifying- PA',                  'pre_admit', 'Display'),
  ('Negotiation/Review',              'pre_admit', 'Stored actual for Qualifying- PA'),

  -- Referred out, coming back (active)
  ('Referred Out - Coming Back',      'referred_out_coming_back', NULL),

  -- Closed Won — Admit (treatment admit, 4 pipelines: Commercial-Cash, AHCCCS, DV, ZocDoc)
  ('Closed - Admitted',               'closed_won_admitted', 'Display'),
  ('Closed Won',                      'closed_won_admitted', 'Stored actual for Closed - Admitted'),

  -- Closed Won — Placement (Commercial-Cash only)
  ('Closed - Referred Out Unattached','closed_won_referred_out_unattached', NULL),

  -- Closed Won — DUI Completion (DUI - Cash only)
  ('Closed - Screening Only',         'closed_won_dui_completion', NULL),
  ('Closed - Both Screening & Classes','closed_won_dui_completion', NULL),
  ('Closed - Classes Only',           'closed_won_dui_completion', NULL),

  -- Closed Lost — pipeline-specific
  ('Closed - Lost (Treatment)',       'closed_lost', 'Display'),
  ('Closed Lost',                     'closed_lost', 'Stored actual for Closed - Lost (Treatment)'),
  ('Closed - Lost (DUI)',             'closed_lost', NULL),
  ('Closed - Lost (DV)',              'closed_lost', NULL),
  ('Closed - Lost to Competition',    'closed_lost', 'Display'),
  ('Closed Lost to Competition',      'closed_lost', 'Stored actual')
ON CONFLICT (raw_value) DO NOTHING;
