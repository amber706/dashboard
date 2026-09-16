# Per-Lead Web Journey (GA4 ↔ Zoho) — Design (DRAFT, gated on BigQuery)

**Date:** 2026-08-08
**Status:** DRAFT — build-ready pending the external prerequisite (GA4→BigQuery export + BQ read access). Decisions marked **[confirm at build]** get finalized in a short brainstorm once BQ is connected.
**Part of:** GA↔Zoho program, **step ②**. Depends on step ① (`sync-ga-clientid-to-zoho`, shipped 2026-08-08) which stamps `GA_Client_ID` onto Zoho records. See `ga-clientid-zoho-sync` memory and `2026-08-08-ga-clientid-sync-design.md`.

## Goal
Show each lead's **web journey** — the pages/events they hit before (and around) becoming a lead/admit — by joining Zoho records to GA4 raw event data on the GA client ID.

## Why BigQuery (not the GA4 API / Supermetrics)
The GA4 Data API and Supermetrics return **aggregates** (sessions/users by dimension). Per-user event sequences keyed by a specific `user_pseudo_id` only exist in the **GA4 → BigQuery export** (`events_*` tables). Confirmed in-session: no BigQuery tooling is currently reachable and Supermetrics is aggregate-only — hence the hard prerequisite.

## Prerequisites (user-provisioned)
1. **GA4 → BigQuery link** enabled (GA4 Admin → Product links → BigQuery links). Daily (free) tier is sufficient; streaming optional. **Forward-only** — data accrues from enable date; no historical backfill.
2. **Read access to the export dataset** for the build: either a BigQuery MCP connector for the GCP project, or a read-only service account on `analytics_<propertyId>` shared with the dev team.

## Join key
- Zoho `GA_Client_ID` (populated by ①) ↔ BigQuery `user_pseudo_id`.
- **Normalization (required):** CTM's `ga.cid` is stored sometimes as the cookie form `GA1.1.<rand>.<ts>` and sometimes as the bare `<rand>.<ts>`. BQ `user_pseudo_id` is the **bare** `<rand>.<ts>`. Strip a leading `GA1.1.` (regex `^GA\d+\.\d+\.`) from `GA_Client_ID` before joining. (Add this normalization to ①'s writer too, as a follow-up, so stored values are consistent going forward.)

## Data flow / architecture
BigQuery export tables: `analytics_<propertyId>.events_YYYYMMDD` (+ `events_intraday_YYYYMMDD`), date-partitioned. Per event: `user_pseudo_id`, `event_name`, `event_timestamp`, `event_date`, `traffic_source`, `session_id` (from `ga_session_id` param), and `page_location`/`page_referrer` (from `event_params`).

Two consumers, **[confirm at build]** which to ship first:
- **(A) Journey-summary ETL (recommended default).** A scheduled job (nightly) that, for the set of client IDs on recent Zoho conversion records, queries BQ for each lead's events and materializes a **summary** into the Supabase warehouse: first-touch source/medium, first & last page, session count, event count, first-seen → lead/admit elapsed days, and a compact ordered `touchpoints` JSON (capped, e.g. last 50 events). Feeds dashboards and is cheap to read. Cost-controlled by filtering BQ on `user_pseudo_id IN (…)` + `_TABLE_SUFFIX` date-partition pruning.
- **(B) On-demand per-lead detail.** When a manager opens a lead, query BQ live for that one `user_pseudo_id`'s full event stream and render the timeline. Richer, but adds a live BQ dependency + per-view query cost.

Recommendation: build **(A)** first (reporting value, bounded cost), add **(B)** later if per-lead drill-down is wanted.

## Proposed data model (A)
Warehouse table `web_journey_summary` (Supabase): `zoho_module`, `zoho_record_id`, `ga_client_id`, `user_pseudo_id`, `first_touch_source_medium`, `first_page`, `last_page`, `session_count`, `event_count`, `first_seen_at`, `last_seen_at`, `days_first_seen_to_record`, `touchpoints jsonb`, `computed_at`. Free-text (no CHECK constraints — lesson from `gclid_backfill_log`).

## Cost & safety
- BQ query cost scales with bytes scanned → always constrain by `_TABLE_SUFFIX` (date range) and `user_pseudo_id` set; never `SELECT *` across all events.
- Batch the client-id set (e.g. 1–5k per query) rather than per-lead queries in the ETL.
- Pseudonymous IDs only — no new PII beyond what GA already holds.
- Idempotent upsert on `(zoho_module, zoho_record_id)`; forward-only export means early records may have no journey (pre-enable) — store `no_journey_data` rather than erroring.

## Testing
Unit-test the pure bits (client-id normalization; touchpoint summarization from a fixture event list). Integration: run the ETL for a handful of known recent admits with a GA client ID, confirm the summary matches the GA4 UI's user explorer for that pseudo-id.

## Open questions (resolve when BQ is connected)
1. GCP project + dataset name (`analytics_<propertyId>`), and access method (MCP connector vs service account).
2. Ship (A) summary-ETL first vs (B) on-demand detail. **[confirm at build]**
3. Where journeys surface in the dashboard (existing lead/deal view vs a new reporting page).
4. Journey window (e.g. 90 days pre-record) and touchpoint cap.
5. Whether to also normalize/repair `GA_Client_ID` values already written by ① (strip `GA1.1.`).
