-- ───────────────────────────────────────────────────────────────────────────
-- Migration 190 — Split `Alumni` out of `digital_marketing` into its own
-- top-level source category.
--
-- Background: in the Phase 1B seed of `reporting.source_category_mapping`
-- (migration 120), the Zoho raw picklist value `Alumni` was folded into
-- `digital_marketing` under the catch-all rule. That decision was carried
-- over from CONFIRMED.md #17. While diagnosing a BD undercount on 2026-05-29,
-- Amber locked the correct classification: **Alumni stands on its own** — it
-- is neither Digital nor BD. The catch-all rule for everything else is
-- unchanged.
--
-- Also retires OPEN_QUESTION #34. Amber's decision on the two placeholder
-- picklist values:
--   - `Option 1` / `Option 2` → junk. Their rows are removed from the
--     mapping table here, and the values will be removed from the Zoho
--     `Source_Category` Global Picklist in a separate manual step.
--   - `Call Center`, `Internal`, `Directory Listing` → stay as Digital (no
--     remap needed; current rows already mapped correctly).
--
-- Re-running the op-metric builder after this migration rebuilds the cache
-- with Alumni reporting as its own bucket.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Extend the source_category enum with 'alumni'.
ALTER TYPE source_category ADD VALUE IF NOT EXISTS 'alumni';

-- 2) Extend the marketing_channel enum to match (the channel is a 1-to-1
--    surface of source_category in the filter UI).
ALTER TYPE marketing_channel ADD VALUE IF NOT EXISTS 'alumni';

-- Postgres requires a COMMIT before a freshly-added enum value is usable in
-- the same transaction. Migrations run statement-by-statement (auto-commit
-- between statements), so the subsequent UPDATE/DELETE statements below are
-- safe even though they reference 'alumni'.

-- 3) Re-point the existing Alumni mapping row from digital_marketing → alumni.
UPDATE reporting.source_category_mapping
SET normalized_value = 'alumni'::source_category,
    notes            = 'Alumni-sourced; own bucket per CONFIRMED.md #38'
WHERE raw_value = 'Alumni';

-- 4) Drop the Option 1 / Option 2 placeholder rows. These will also be
--    removed from the Zoho global picklist in a follow-up manual step
--    (Amber to action via Zoho Setup → Customization → Global Picklists).
DELETE FROM reporting.source_category_mapping
WHERE raw_value IN ('Option 1', 'Option 2');

-- 5) Sanity check — leave a NOTICE in the migration log so an operator can
--    eyeball the current mapping after apply.
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE 'source_category_mapping after migration 190:';
  FOR r IN
    SELECT raw_value, normalized_value
    FROM reporting.source_category_mapping
    ORDER BY raw_value
  LOOP
    RAISE NOTICE '  % -> %', r.raw_value, r.normalized_value;
  END LOOP;
END$$;
