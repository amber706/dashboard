-- ───────────────────────────────────────────────────────────────────────────
-- Migration 192 — Backfill reporting.deals.lead_created_time from
-- raw_zoho_crm_deals.raw_payload->>'Original_Created_Time'
--
-- Resolves OPEN_QUESTIONS #37 properly. Migration 142 originally added the
-- lead_created_time column intending to source it from Zoho's standard
-- Lead_Created_Time field — but Cornerstone has never populated that field
-- (0 of 29,587 deals). The actual conversion-time Lead Created Time lives on
-- the Deal's Original_Created_Time field, copied over by Cornerstone's
-- Lead Conversion Mapping (Setup → Customization → Modules and Fields →
-- Leads → Convert Mapping).
--
-- Verified 2026-05-30 against 18 production deals: every
-- Deal.Original_Created_Time exactly matches the converting Lead's
-- Created_Time, with gaps from 45 seconds (fresh same-day) up to ~14 months
-- (long-tail conversion of a 2025 lead). The fix is read-side only — column
-- name and downstream consumers stay as-is.
--
-- reporting-sync-deals/index.ts is updated in this PR to read
-- Original_Created_Time on subsequent syncs; this migration covers the
-- historical 16,239 deals already in the raw mirror.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE reporting.deals d
SET lead_created_time = (r.raw_payload->>'Original_Created_Time')::DATE,
    updated_at        = NOW()
FROM reporting.raw_zoho_crm_deals r
WHERE d.source_deal_id = r.source_id
  AND r.raw_payload->>'Original_Created_Time' IS NOT NULL
  AND r.raw_payload->>'Original_Created_Time' <> ''
  AND d.lead_created_time IS DISTINCT FROM (r.raw_payload->>'Original_Created_Time')::DATE;

-- Sanity check — leave the result counts in NOTICE so an operator can verify.
DO $$
DECLARE
  v_populated INT;
  v_null      INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE lead_created_time IS NOT NULL),
    COUNT(*) FILTER (WHERE lead_created_time IS NULL)
  INTO v_populated, v_null
  FROM reporting.deals;
  RAISE NOTICE 'reporting.deals.lead_created_time after migration 192: % populated, % null', v_populated, v_null;
END$$;
