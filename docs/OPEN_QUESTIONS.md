# Open Questions — Phase 1A

**Status:** awaiting Amber's resolutions. Every question below must be answered in `CONFIRMED.md` before Phase 1B begins.

Numbering is stable — `METRIC_DEFINITIONS.md` references questions by number. Resolved questions are moved (not deleted) to `CONFIRMED.md` with the answer attached.

Each question lists: the ambiguity, where it surfaced, and (where useful) a recommended default if you want the safe path.

---

## ~~#1 — Exact Zoho stage names for Referred Out variants~~ — RESOLVED

Moved to `CONFIRMED.md` #1 and #2. The original brief's three "Referred Out variants" mapped to one closed-won (`Closed - Referred Out Unattached`, Commercial-Cash only) plus one active stage (`Referred Out - Coming Back`, three pipelines). The third name in the brief does not exist.

---

## ~~#2 — DUI pipeline current status~~ — RESOLVED

Moved to `CONFIRMED.md` #6. Active. Reported separately from top-line.

---

## ~~#3 — `VOB Submitted` field name per pipeline~~ — RESOLVED

Moved to `CONFIRMED.md` #4. There is no `VOB Submitted` field — VOB is stage-driven. Question retired.

---

## #4 — Insurance type enum values

**Where:** `METRIC_DEFINITIONS.md` §17.
**Question:** Confirm the exact literal strings used for `Insurance_Type` on Zoho Leads:
- "Commercial Insurance" — literal?
- "Private Pay" — literal?
- "AHCCCS" — literal?

Are there other values (Medicare? Medicaid non-AHCCCS? Unknown?) we need to handle?

**How to resolve:** in Zoho CRM Setup → Customization → Leads → Insurance Type field, copy the picklist values verbatim. Or in the Analytics Leads view, distinct() the Insurance Type column.

---

## #5 — Star rating field name

**Where:** `METRIC_DEFINITIONS.md` §16, §17.
**Question:** What is the actual Zoho field name for the star rating on Leads? Candidates:
- `Rating`
- `Stars`
- `Lead_Score`
- `Star_Rating`

**How to resolve:** confirm the field's API name in Zoho CRM Setup → Customization → Leads. (The Analytics Leads view we saw didn't show this column in the visible columns — it's there, just need to scroll or check column list.)

---

## #6 — BD Rep and Admissions Rep profile names

**Where:** `METRIC_DEFINITIONS.md` §19, §20.
**Question:** Confirm the exact literal Zoho Profile names:
- Admissions Rep (current draft: `Treatment Standard`, `Admin`)
- BD Rep (current draft: `Business Development`)

If "Admin" includes non-admissions admins (IT/system admins), we need a tighter filter — possibly Role-based instead of Profile-based.

**How to resolve:** Zoho CRM Setup → Security Control → Profiles.

---

## #7 — Zoho Analytics OAuth credentials (residual)

**Where:** `METRIC_DEFINITIONS.md` §0.
**Status:** Partially resolved. Workspace ID and view ID are locked in `CONFIRMED.md` #7. Still need to build the sync.

**Question:** for the `sync_zoho_analytics_leads` edge function in Phase 1B:
- Zoho Analytics OAuth client ID + client secret + refresh token (or service account credentials)
- Scope required (likely `ZohoAnalytics.data.READ`)
- Whether the `Leads (Zoho CRM)` report supports incremental pull by Modified Time, or only full-refresh

**How to resolve:** generate OAuth credentials in the Zoho API Console (https://api-console.zoho.com), grant the read scope, and store the refresh token in Supabase Edge Function secrets. The incremental vs full-refresh question can be answered by checking whether the report has a `Modified Time` column we can filter on.

---

## ~~#8 — DUI dimension for reporting~~ — RESOLVED

Moved to `CONFIRMED.md` #3. DUI and DV both reported separately from top-line; not folded into Commercial or AHCCCS.

---

## #9 — Lead overlap rule: AHCCCS Lead vs Commercial Lead

**Where:** `METRIC_DEFINITIONS.md` §17.
**Question:** A Lead with `star_rating = 3` AND `insurance_type = "Commercial Insurance"` matches both definitions. Choose:
- **A** — star rating wins → AHCCCS Lead only.
- **B** — insurance type wins → Commercial Lead only.
- **C** — both apply, the Lead counts in both buckets (current default — safer for not dropping rows, but double-counts when summed).
- **D** — flag the row for manual triage; do not classify until resolved.

---

## #10 — Pipeline × Source Category orthogonality

**Where:** `METRIC_DEFINITIONS.md` §21.
**Question:** Confirm that Pipeline and Source Category are intentionally independent. A Deal with `pipeline = commercial_cash` and `source_category = business_development` should count as BOTH a Commercial Admit AND a BD Admit when filtered by each dimension separately.

This is the current default and matches the orthogonality matrix. Confirming explicitly because the executive narrative sometimes treats "BD" and "Commercial" as alternatives rather than co-occurring.

---

## #11 — Level of Care enum values

**Where:** `METRIC_DEFINITIONS.md` §13.
**Question:** What is the complete normalized LOC enum? Likely candidates (ASAM-aligned):
- Detox
- Residential (RTC)
- PHP (Partial Hospitalization)
- IOP (Intensive Outpatient)
- OP (Outpatient)
- Sober Living

Plus any Cornerstone-specific values (e.g., "Aftercare", "MAT-only", "Evaluation").

**How to resolve:** list every LOC that should exist as a normalized value, then raw Zoho strings map to them in Phase 1B's `loc_mapping`.

---

## #12 — Sales Cycle: `Closing_Date` exact field name

**Where:** `METRIC_DEFINITIONS.md` §6, §15.
**Question:** Confirm the Zoho Deals field is named `Closing_Date` (API name). Some Zoho orgs use a custom `Actual_Close_Date` instead.

---

## #13 — Lead `Created Time` semantics

**Where:** `METRIC_DEFINITIONS.md` §1.
**Question:** Is `Created Time` on the Zoho Lead record the moment the Lead was first captured (e.g., form submission or call), or could it be the moment of CRM record creation (which could be later)? Pinning this matters for both Lead-creation counts and Sales Cycle math.

---

## #14 — Field for the "Closing Date" of an Admit

**Where:** `METRIC_DEFINITIONS.md` §6.
**Question:** When a Deal moves to `Closed - Admitted`, which timestamp do we use as the Admit date?
- Zoho `Closing_Date` (manually set by the rep)?
- Zoho `Modified_Time` at the moment of the stage transition?
- A custom "Admit Date" field?

These can differ by days. Pick one canonically.

---

## #15 — Referral In source-side definition

**Where:** `METRIC_DEFINITIONS.md` §11.
**Question:** What field(s) on a Zoho Lead indicate it is a Referral In?
- (a) `Lead_Source = "Referral"` (or similar)
- (b) `Source_Category` contains a referring account name
- (c) presence of a non-null `Referring_Account` field
- (d) Lead Source's parent category in `source_category_mapping` resolves to "Referral"

Without this answer the Referral In count cannot be populated.

---

## ~~#16 — Referral Out destination field~~ — RETIRED

The original "Referral Out" primitive is replaced by **Placement** (`closed_won_referred_out_unattached`). If a destination account name needs to be tracked on a Placement deal, that becomes a separate question — but the metric itself no longer depends on it. Re-open if Placement reporting needs the destination account.

---

## #17 — Source Category raw field name and full picklist

**Where:** `METRIC_DEFINITIONS.md` §14.
**Question:** What is the Zoho field for Source Category on Leads? The Analytics Leads view we screenshot-ed showed an `Interaction Source` column — is that the field, or is there a separate `Lead_Source` / `Source_Category` field?

Provide the full list of raw values currently in production so we can build `source_category_mapping` in Phase 1B.

---

## #18 — Test record exclusion rule

**Where:** `METRIC_DEFINITIONS.md` §22.
**Question:** How are test Leads / test Deals identified for exclusion?
- (a) Owner email contains "test" or matches a deny-list of internal addresses
- (b) Naming convention (Lead first/last name contains "Test")
- (c) A boolean custom field `Is_Test`
- (d) Specific Source value (e.g. `Lead_Source = "Test"`)

If multiple rules apply, list all.

---

## ~~#19 — Exact Zoho pipeline string names~~ — RESOLVED

Moved to `CONFIRMED.md` #5. Five pipelines locked.

---

## #20 — VOB Submitted: timestamp of flag flip

**Where:** `METRIC_DEFINITIONS.md` §5.
**Status:** transformed by #4's resolution.

**Question:** now that VOB is stage-driven (`CONFIRMED.md` #4), the question becomes: when a deal advances into `VOB - Qualifying`, is that transition timestamped in Zoho's stage history? Phase 1B's `sync_zoho_crm_deals` needs to capture that transition time to date-attribute VOBs correctly.

If stage transitions are timestamped, we read them. If not, the fallback is `Modified_Time` on the next edit after the deal entered `VOB - Qualifying`, which is noisy.

**How to resolve:** Zoho CRM API → check whether the Stage_History or Deal_History endpoint includes transition timestamps.

---

## #21 — Orphan deals in Sales Cycle math

**Where:** `METRIC_DEFINITIONS.md` §15.
**Question:** For Sales Cycle, when a `closed_won_admitted` Deal has no matching Lead row in Zoho Analytics:
- (a) Exclude from Sales Cycle (current default).
- (b) Fall back to Deal `Created_Time` as the start point.
- (c) Surface in a separate "orphan" metric.

---

## #22 — Top-line MQL inclusion (NEW)

**Where:** `METRIC_DEFINITIONS.md` §4.
**Question:** Should the headline "MQLs this month" KPI include DUI - Cash and DV - Cash deals, or follow the same top-line restriction as Admits (Commercial-Cash + AHCCCS + ZocDoc only)?

Current draft: top-line MQL = MQL AND `pipeline ∈ TOP_LINE_ADMIT_PIPELINES`, matching the Admit treatment. Confirming because consistency is a question of taste here — some orgs count all deals as MQLs and only filter at the win line.

---

## #23 — Stage history snapshotting in Phase 1B (NEW)

**Where:** `METRIC_DEFINITIONS.md` §5.
**Question:** VOB is now defined as "deal has ever reached `VOB - Qualifying` or a later stage." This requires Phase 1B's deal sync to capture stage transition history, not just current stage.

Concretely:
- Does Zoho CRM's API expose deal stage history (`Stage_History` related list)?
- If yes, we sync it into a `deal_stage_transitions` table and `vob_reached_at` is derived from it.
- If no, the only proxy is current stage: a deal currently at `vob_qualifying` or later is a VOB. This misses deals that VOBed and were reset to Stuck Lead, but is otherwise close — Zoho's pipeline progression is typically monotonic.

**Recommended default:** sync stage history if the API exposes it; fall back to current-stage proxy with a documented blind spot otherwise.

---

## #24 — DUI Completion type as a separate dimension (NEW)

**Where:** `METRIC_DEFINITIONS.md` §9.
**Question:** DUI's three win stages (`Closed - Screening Only`, `Closed - Both Screening & Classes`, `Closed - Classes Only`) all roll up to `closed_won_dui_completion`. Should DUI reporting break the win count down by these three sub-types, or treat them as one bucket?

If granularity is needed, we add a `dui_completion_type` derived field on the deals row.

---

## #25 — Does DUI carry Level of Care? (NEW)

**Where:** `METRIC_DEFINITIONS.md` §13.
**Question:** The DUI - Cash pipeline doesn't have an Admit stage. Do DUI deals carry an LOC field, or is "level of care" simply not a dimension for DUI?

If LOC doesn't apply to DUI: the LOC filter on a top-line dashboard implicitly excludes DUI deals, which is fine because DUI is non-top-line anyway. The LOC enum (`OPEN_QUESTION #11`) stays scoped to treatment-pipeline LOCs.

---

## #26 — Placement cycle metric (NEW)

**Where:** `METRIC_DEFINITIONS.md` §15.
**Question:** Sales Cycle is currently defined for top-line Admits. Should Placements (`closed_won_referred_out_unattached`) get their own cycle metric — `placement_cycle_days = closing_date − lead.created_at` for placement deals? Useful for measuring how fast specialists place callers they can't take.

**Recommended default:** yes, add `op_placement_cycle_daily` to the Phase 1B operational metric tables alongside `op_sales_cycle_daily`. Cheap to maintain alongside the existing aggregation.

---

## Document changelog

- **2026-05-27 (rev 1)** — Initial draft alongside METRIC_DEFINITIONS.md rev 1. 21 open questions raised.
- **2026-05-27 (rev 2)** — Revised alongside METRIC_DEFINITIONS.md rev 2. Resolved (moved to CONFIRMED.md): #1, #2, #3, #8, #19. Retired (no longer applicable): #16. Transformed: #20 (the underlying assumption changed). Partially resolved: #7 (IDs locked, OAuth still pending). Added: #22, #23, #24, #25, #26.
