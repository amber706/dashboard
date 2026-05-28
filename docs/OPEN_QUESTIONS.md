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

## ~~#4 — Insurance type enum values~~ — RESOLVED

Moved to `CONFIRMED.md` #8 and #9. Six values: AHCCCS, Commercial Insurance, Cash, Medicare, No Insurance, Out of State Medicaid. "Cash" replaces brief's "Private Pay"; Medicare/No Insurance/Out of State Medicaid form the new Other Payer Lead bucket.

---

## ~~#5 — Star rating field name~~ — RESOLVED

Moved to `CONFIRMED.md` #10. Field is `Lead Score Rating` (a single picklist column). Star count is parsed from leading ⭐ characters in the label via `leadScoreRatingToStarCount`.

---

## ~~#6 — BD Rep and Admissions Rep profile names~~ — RESOLVED

Moved to `CONFIRMED.md` #15 + #16. Four profiles in production: `TREATMENT Standard`, `Administrator`, `Call Center AHCCCS` (all → Admissions Rep), `Business Development` (→ BD Rep).

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

## ~~#11 — Level of Care enum values~~ — RESOLVED

Moved to `CONFIRMED.md` #11. 13 Cornerstone-specific values: BHRF, Detox, PHP, IOP5, IOP3, VIOP Adult, VIOP Adolescent, OP, VOP, VOP Adult, VOP Adolescent, DUI, DV.

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

## ~~#17 — Source Category full picklist~~ — RESOLVED

Moved to `CONFIRMED.md` #17. 13 picklist values pulled via Zoho API. Catch-all rule (everything except BD/ZocDoc → Digital Marketing) confirmed as the intended classification.

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

## #27 — Lead Score Rating: full 4-star and 5-star label strings (NEW)

**Where:** `METRIC_DEFINITIONS.md` §16, CONFIRMED.md #10.
**Question:** the screenshot truncated the 4-star and 5-star Lead Score Rating labels:
- 4: `⭐⭐⭐⭐ Seeking Treatment: Commercial, N...`
- 5: `⭐⭐⭐⭐⭐ Seeking Treatment: Commercial,...`

Star-count parsing works on truncated strings since we count ⭐ characters. But for surfacing in dashboards (e.g., "Lead Score Distribution" chart), we want the full labels.

**How to resolve:** in Zoho CRM, hover or open the Lead Score Rating field's picklist and copy the full text. Also the 2-star label (`HR/Client Care/Family/Care Coordination...`) is truncated.

---

## #29 — Insurance_Policy_Type (network: PPO/HMO/EPO/POS) as a separate dimension (NEW)

**Where:** discovered via Zoho `getFields`.
**Question:** the Zoho Leads module has a `Insurance_Policy_Type` field (a 5-value picklist: PPO, HMO, EPO, POS, Not Applicable) that captures the *network type* of a Commercial insurance plan. Additionally, the `Insurance_Type` field is overloaded — those same four network values appear there too, alongside the coverage classes.

For Phase 1A we deferred this dimension per Amber's direction: ignore both the overloaded values in `Insurance_Type` and the entire `Insurance_Policy_Type` field. But the question remains:

- For Phase 2+, do we surface PPO/HMO/EPO/POS as a separate **Network** filter on the FilterBar?
- Do any current dashboards (e.g., the All VOBs page's network chips) depend on this dimension being modeled?
- Should we clean up the overloaded values in `Insurance_Type` (move PPO/HMO/EPO/POS out of that picklist) before Phase 1B sync to prevent the sync ingesting unclassifiable values?

**Recommended:** add `Insurance_Policy_Type` as a separate enum and Phase 1B sync field, but do not include it in any classification predicates yet. Surface in `v_unmapped_insurance_types` (Phase 1B) if any Lead has a network-type value in `Insurance_Type` so cleanup is visible.

---

## #30 — `Insurance_Type` value "PPO" → stored "Unknown" (NEW)

**Where:** discovered via Zoho `getFields`.
**Question:** the `Insurance_Type` picklist has a display value `PPO` whose **actual stored value is `Unknown`**. This is either a Zoho rename gone wrong or a deliberate workaround. Either way, leads with the value will hit our sync as the literal string `Unknown`, which is not in the canonical enum.

**How to resolve:** check Zoho CRM Setup → Customization → Leads → Insurance Type field; either fix the actual_value to `PPO` or confirm `Unknown` is intentional. If intentional, decide whether `Unknown` should be a separate insurance type (e.g., for unverified payer leads).

---

## #28 — `Treatment or Court Services` field semantics (NEW)

**Where:** observed in Zoho Lead detail.
**Question:** Cornerstone Leads have a `Treatment or Court Services` field (under Service Information). What does this distinguish? Is it:
- A simple "is this a treatment lead vs court-mandated lead" boolean?
- A picklist that's a more granular alternative to inferring program from LOC?
- A vestigial field no longer in active use?

If this field is authoritative for treatment-vs-court routing, it might be a better gate for `isTreatmentLead` than checking LOC ∉ {DUI, DV}.

**How to resolve:** check the field's picklist values and how reliably it's populated in production.

---

## #26 — Placement cycle metric (NEW)

**Where:** `METRIC_DEFINITIONS.md` §15.
**Question:** Sales Cycle is currently defined for top-line Admits. Should Placements (`closed_won_referred_out_unattached`) get their own cycle metric — `placement_cycle_days = closing_date − lead.created_at` for placement deals? Useful for measuring how fast specialists place callers they can't take.

**Recommended default:** yes, add `op_placement_cycle_daily` to the Phase 1B operational metric tables alongside `op_sales_cycle_daily`. Cheap to maintain alongside the existing aggregation.

---

## Document changelog

- **2026-05-27 (rev 1)** — Initial draft alongside METRIC_DEFINITIONS.md rev 1. 21 open questions raised.
- **2026-05-27 (rev 2)** — Revised alongside METRIC_DEFINITIONS.md rev 2. Resolved (moved to CONFIRMED.md): #1, #2, #3, #8, #19. Retired (no longer applicable): #16. Transformed: #20 (the underlying assumption changed). Partially resolved: #7 (IDs locked, OAuth still pending). Added: #22, #23, #24, #25, #26.
- **2026-05-27 (rev 3)** — Revised alongside METRIC_DEFINITIONS.md rev 3 + Lead detail screenshots. Resolved (moved to CONFIRMED.md): #4, #5, #11. Partially resolved: #17 (field name confirmed; full picklist still pending). Added: #27 (full 4/5-star labels), #28 (Treatment or Court Services field).
- **2026-05-27 (rev 4)** — Live Zoho API queries (getFields + getUsers). Resolved: #6, #17 (full picklist). Added: #29 (Insurance_Policy_Type dimension), #30 (PPO/Unknown anomaly).
