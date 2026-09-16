# gclid Recovery for Click-less Conversions — Design

**Date:** 2026-08-07
**Status:** Approved (design) — pending spec review before planning
**Related:** `push-google-conversions` (main project `fortdxbbazifklqwydnk`), CTM project (`ctm_call`), Zoho CRM Deals. See memory notes `gclid-attribution-data-model`, `ctm-45-commercial-conversions`.

## Problem

A gclid only lands in Zoho when a lead was cookied on a gclid-tagged web session **and** dialed the *dynamic* CTM tracking number rendered for that session (or submitted a gclid-tagged web form). When the caller instead dials the **hard-coded main line** (e.g. `Treatment - Main`, +18006432108), CTM records the call with `visitor:false`, no `ga.gclid`, and `paid.source/medium:null` — there is no click id on the call, so nothing syncs to Zoho.

Worked example (the trigger for this project): admit Deal `5162065000374605204` ("Brooke Pipersburgh", a minor, AHCCCS/Medicaid VIOP Adolescent) has `GCLID` null. The guardian **Rochelle Loyd (623-399-5781)** placed the real 42-minute inbound call `4405958234`, but on the hard-coded main line — so no gclid. That call **was** scored 3★ and pushed to Google Ads "AHCCCS Leads CA" at 2026-08-07 21:00 via **enhanced identifiers (hashed phone)**, so Google got a conversion; but the click id never comes back, so Zoho/dashboards cannot attribute the admit to a campaign.

## Goals

1. **Recover** a gclid + campaign for converted records that have none, by matching the lead to connected call/CRM data that *does* carry a gclid.
2. **Attach** the recovered gclid + campaign to the Zoho Deal so dashboards attribute the admit.
3. **Feed Google** the recovered gclid on the conversion — without double-counting and without violating click-before-conversion timing.

## Non-goals

- Not changing how gclids are captured at the source (web forms, CTM dynamic numbers).
- Not reading back Google's internal server-side enhanced-conversion match (not exposed).
- Not a general CRM dedup/identity-resolution product — matching is scoped to gclid recovery.

## Scope

- **Conversion unit:** Zoho **Deals** in a conversion stage, within Google's ~90-day click window, whose `GCLID`, `GCLIDs`, and `Recovered_GCLID` are all empty.
- **Match sources:** CTM calls (`ctm_call.raw_payload`), and Zoho Deals/Contacts/Leads that carry a gclid. Contacts/Leads are match sources only — never the conversion unit.

## Architecture

One shared **resolver** (the matching brain) with two consumers: a **pre-push step** inside `push-google-conversions`, and a scheduled **backfill cron**. A **`gclid_recovery_log`** table is the audit trail and the human review queue.

```
                 ┌─────────────────────────────┐
   Deal (no gclid)│         gclid-resolver       │→ {gclid, campaign, source,
                 │  1. gather identifiers       │   source_ref, click_time,
                 │  2. search candidate gclids  │   tier, confidence}
                 │  3. select best (timing-safe)│
                 └─────────────┬───────────────┘
                     ┌─────────┴──────────┐
        pre-push step│                    │backfill cron
   (push-google-conv)│                    │(scheduled)
                     ▼                    ▼
       single Google push        Zoho write + gclid_recovery_log
       carrying recovered gclid  (no re-push if already stamped)
```

### The resolver

Input: one Deal. Output: `{gclid, campaign, source, source_ref, click_time, tier, confidence}` or a no-match reason.

1. **Gather identifiers.** The Deal's own phone/email, plus identifiers reached through Zoho links: its `Contact_Name`, `Account_Name`, related contacts/deals, and any guardian/emergency/`Phone_2..4` numbers on those records. Normalize phones to last-10; lower-case emails.
2. **Search candidate gclid sources** for those identifiers:
   - CTM calls: match `caller_number` (E.164) and enhanced-lookup name/email; read `raw_payload->'ga'->>'gclid'`, `raw_payload->'ga'->>'campaign'`, and `received_at` (the click/call time).
   - Zoho records carrying a gclid (same identifiers).
3. **Select.** Among candidates, choose the **most recent click at or before the conversion event time** and within 90 days of it. This guarantees click ≤ conversion (timing rule) and Google-window eligibility.

### Match tiers

| Tier | Link basis | Action |
|---|---|---|
| **T1** | exact phone (last-10) or email shared with the source | auto-apply |
| **T2** | identifier reached via Zoho record links (Contact/Account/related/guardian numbers) | auto-apply |
| **T3** | household/family — same name+address / same Account, no shared phone/email | **suggestion only** (never auto-applied, never auto-pushed) |

## Data & writes

- **`gclid_recovery_log`** (Supabase; project TBD — CTM project vs beside `conversion_push_log` in main): one row per Deal evaluated. Columns (draft): `deal_id`, `evaluated_at`, `outcome` (`matched_auto` | `suggested` | `no_match` | `ambiguous` | `no_identifiers`), `tier`, `confidence`, `gclid`, `campaign`, `source` (`ctm_call` | `zoho`), `source_ref`, `click_time`, `conversion_time`, `action_taken`, `reviewed_by`, `reviewed_at`. Serves as audit trail + review queue.
- **Auto tiers (T1/T2):** write `Recovered_GCLID` (+ `Campaign_ID` / `PPC_Campaign_Name`) on the Zoho Deal; note provenance (tier + source_ref).
- **T3 suggestions:** remain in `gclid_recovery_log` with `outcome=suggested`; surfaced in the dashboard for one-click confirm. **Nothing written to Zoho and nothing pushed** until confirmed; confirming promotes to an auto-style apply.

## Integration (no double-push)

- **Pre-push step:** before `push-google-conversions` uploads a gclid-less conversion, it calls the resolver. A T1/T2 hit means the conversion is uploaded **once**, already carrying gclid + click-time (dated at the source call's `received_at`, per the v36 timing fix). Enhanced identifiers remain attached exactly as today.
- **Backfill cron:** runs the resolver over recent gclid-less converted Deals to populate Zoho for records the push already handled (so dashboards get campaign attribution even when Google was fed via enhanced-conversions only). Writes Zoho + log; **does not re-push** if the Deal/call is already stamped (`ctm_45_*_pushed_at`, `ahcccs_3star_pushed_at`, `conversion_push_log`). This closes the loop for cases like Brooke's.

## Error handling & edge cases

- **No identifiers:** log `no_identifiers`, skip.
- **Ambiguous:** top two candidate gclids in the same short window but different campaigns → drop to `suggested` (don't guess a campaign).
- **Click postdates conversion:** discard (never push a future click).
- **>90 days:** discard for Google (may still note internally as low-confidence, not pushed).
- **Google `NO_CONVERSION_ACTION_FOUND` / propagation delay:** rely on existing cron retry.
- **Household false positives:** contained by review queue + confidence threshold (T3 never auto-applies).

## Testing

- **Resolver unit tests (fixtures):** exact-phone hit; Zoho-link/guardian hit (Brooke↔Rochelle); household → suggestion; no-match; ambiguous → drop; click-after-conversion → discard; >90d → discard.
- **Integration:** pre-push carries recovered gclid dated at source call `received_at`; backfill writes Zoho without re-pushing an already-stamped conversion.

## Expected yield (measured, trailing 90 days as of 2026-08-07)

Sizing was measured against live CTM + Zoho data before build:

- CTM gclid pool: **1,665 gclid-bearing calls / 1,135 distinct numbers**.
- Conversion-eligible **leads** (distinct, CTM): 2,591 — already gclid-attributed 474; **gclid-less 2,117**.
- **Recoverable via exact phone/email (T1): ~65 leads (~3% of gclid-less).** ~97% (2,052) have no click id anywhere in call data (dialed the hard-coded main line / untracked — the Brooke/Rochelle pattern) and are genuinely unrecoverable.
- Call/Google-signal lens: **~458 gclid-less conversion-eligible *calls*** could gain a click id (repeat ad-clickers inflate this above distinct leads) — upgrades them from enhanced-identifier-only to click-attributed for Smart Bidding.
- Zoho `Closed - Admitted` deals that are gclid-less in the trailing 90d: **400+** (admits only; all conversion types higher).

**Implication:** deal-level recovery is modest (a few dozen / 90d); the dominant lever is **capture** (routing callers onto dynamic tracking numbers / capturing gclid at intake), not recovery. This system is the cleanup pass, and it materially improves the Google-Ads bidding signal on the ~458 calls it can click-attribute. T2/T3 add an unquantified (likely small) increment on top of T1.

## Open questions (resolve during planning)

1. `gclid_recovery_log` location: CTM project vs main project (beside `conversion_push_log`).
2. Whether T3 review status/confidence needs a Zoho custom field or stays Supabase-side + dashboard (leaning Supabase-side to avoid polluting Zoho with unconfirmed guesses).
3. Exact set of Zoho conversion stages that count as "converted" for scope (reuse existing push definitions).
4. Dashboard surface for the T3 review queue (new page vs existing admin surface).
