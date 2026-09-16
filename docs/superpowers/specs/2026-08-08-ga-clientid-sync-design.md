# Sync GA Client ID → Zoho — Design

**Date:** 2026-08-08
**Status:** Approved
**Part of:** the GA ↔ Zoho program (this is step ① — the foundation). Follow-ons ②–④ (per-lead journey via BigQuery, aggregate GA↔outcomes, push CRM outcomes to GA4) depend on this and on external prerequisites (GA4→BigQuery export, connector auth, GA4 Measurement Protocol secret).
**Related:** `gclid-attribution-data-model` memory; the gclid recovery work (`backfill-gclid-to-zoho`) whose patterns this mirrors.

## Problem
CTM captures a GA client ID on ~78% of inbound calls (`raw_payload.ga.cid`) and a GA4 cookie on ~99.7% — far more than gclid (12%). Zoho has the fields (`GA_Client_ID`, `GA4_Session_ID`, `Source_Medium`, `Referring_URL`) but they're essentially unpopulated (4 stale contacts). The GA client ID is GA4's `user_pseudo_id` — the key that joins a lead to their web activity. It's captured on the call side but never synced to the CRM.

## Goal
Stamp each web-tracked lead's GA identity onto their Zoho record so leads become joinable to Google Analytics.

## Non-goals
- Not fetching/joining GA activity itself (that's ②/③, needs GA4→BigQuery or connector auth).
- Not pushing events to GA4 (that's ④).
- Not overwriting existing values; not sourcing a landing URL (CTM has none).

## Scope
Zoho **Contacts, Leads, Deals** where `GA_Client_ID is null`, matchable to a CTM call within a 90-day window by **phone (last-10) or email**. Fills empties only.

## Field mapping (write a field only if it is currently null on the record)
| Zoho field | Source (CTM `raw_payload`) | Notes |
|---|---|---|
| `GA_Client_ID` | `ga.cid` | verbatim, e.g. `GA1.1.21332870.1786897388` |
| `GA4_Session_ID` | `ga.ga4[0][1]` | parse session id: `/GS\d+\.\d+\.s?(\d+)/` → first captured number (handles `GS1.1.<ts>.` and `GS2.1.s<ts>$` formats) |
| `Source_Medium` | `paid.source` + `paid.medium` | GA-style `"<source> / <medium>"`; if either missing, fall back to raw `source` string; else null |
| `Referring_URL` | `referrer` | verbatim |

`Landing_URL` intentionally excluded — no landing-URL key exists in the CTM payload (`has_landing_url_key: false`), and Contacts lacks the field.

## Architecture
New edge function `sync-ga-clientid-to-zoho` (main project `fortdxbbazifklqwydnk`), own **hourly cron** offset from the gclid cron (`35 * * * *`), reusing the existing `CTM_BOT_*` + `ZOHO_*` env. Flow:
1. Build a CTM index over calls with a non-empty `ga.cid` in the window, keeping the **freshest** call per phone-last10 and per email; each entry carries `{cid, session_id, source_medium, referrer, call_id, received_at}`.
2. For each module, `paginateModule` records where `GA_Client_ID is null`, build phone/email lookup maps.
3. Match each CTM entry to a record (phone wins over email); write the null-only field subset.

**Matching module:** a self-contained `matching.ts` in the function dir — reuses the pure primitives (`last10`, `normEmail`, plus a GA-specific `buildCtmCidIndexes`). Kept self-contained (not importing the gclid function's copy) to avoid re-touching that just-shipped production function. Follow-up (optional): consolidate shared primitives into `supabase/functions/_shared/`.

## Safety (learned from the gclid work)
- `dry_run` mode from day one (writes nothing; returns counts).
- CTM fetch **paginated via `.range()`** (PostgREST caps at max-rows=1000) and fetch errors **thrown, not swallowed**.
- `log_insert_error` surfaced in the response.
- Audit log `ga_clientid_sync_log` uses **free-text columns, no CHECK constraints** (the exact thing that silently killed `gclid_backfill_log`).
- Only writes fields that are null on the record — never clobbers existing CRM values.

## Data model
Table `ga_clientid_sync_log` (main project), free-text: `id uuid pk default gen_random_uuid()`, `attempted_at timestamptz default now()`, `zoho_module text`, `zoho_record_id text`, `matched_call_id text`, `ga_client_id text`, `fields_written jsonb`, `zoho_write_status text`, `error_msg text`.

## Idempotency
Per-module gate `GA_Client_ID is null`; re-runs skip already-synced records.

## Testing
Deno unit tests for the pure helpers: GA4 session-id parse (both cookie formats + malformed → null), source/medium derivation (paid present / partial / absent), `buildCtmCidIndexes` freshest-wins + skip-no-cid, phone/email match. Integration verified via `dry_run` against live data on a preview slug before the production deploy (same pattern used for gclid).

## Rollout
Deploy to a preview slug → `dry_run` 90-day → verify projected counts → deploy to production slug + create the cron → live 90-day run → verify writes + that `ga_clientid_sync_log` populates. Source committed in the `admissions-copilot` repo.
