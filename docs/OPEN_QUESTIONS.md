# Open Questions — Phase 1A

**Status:** Awaiting Amber's resolutions. Every question below must be answered in `CONFIRMED.md` before Phase 1B begins.

The numbering here is stable — `METRIC_DEFINITIONS.md` references these questions by number. If a question is resolved, its line should be moved to `CONFIRMED.md` with the answer; do not delete it in place.

Each question lists:
- the ambiguity,
- where it surfaced,
- a recommended default (only used if Amber explicitly chooses it — never assumed silently).

---

## #1 — Exact Zoho stage names for the three Referred Out variants

**Where:** `METRIC_DEFINITIONS.md` §5.
**Question:** The taxonomy describes three Referred Out stage variants:
1. `Closed Lost - Referred Out`
2. `Closed Lost - Referred out Unattached`
3. `Referred out coming back`

Are these the literal stage strings in Zoho CRM (including spacing, hyphens, capitalization)? Any difference will silently exclude rows from the Referred Out metric.

**How to resolve:** open Zoho CRM Deals → Setup → Pipelines & Stages, and copy the exact strings for each of the four pipelines (Commercial/Cash, AHCCCS, DUI, ZocDoc). Note any pipeline that uses different stage names.

---

## #2 — DUI pipeline current status

**Where:** `METRIC_DEFINITIONS.md` §9.
**Question:** Is the DUI pipeline currently in active use? If so:
- What LOCs does it produce?
- What source categories typically feed it?
- Should it appear in every default filter (= treated like a first-class pipeline) or hidden by default in reporting UI?

**How to resolve:** Amber confirms current operational status. If inactive, we still keep the enum value but flag it in the UI's pipeline filter.

---

## #3 — `VOB Submitted` field name per pipeline

**Where:** `METRIC_DEFINITIONS.md` §3.
**Question:** The "VOB Submitted" boolean field may have a different API name in each of the four pipelines (Zoho's custom-field-per-layout model permits this). The VOB metric is broken if any of the four field names diverges from the assumed `VOB_Submitted`.

**How to resolve:** for each pipeline layout in Zoho CRM, copy the exact API field name of the VOB-submitted boolean. Provide all four if they differ.

---

## #4 — Insurance type enum values

**Where:** `METRIC_DEFINITIONS.md` §13.
**Question:** Confirm the exact literal strings used for `Insurance_Type` on Zoho Leads:
- "Commercial Insurance" — literal?
- "Private Pay" — literal?
- "AHCCCS" — literal?

Are there other values (Medicare? Medicaid non-AHCCCS? Unknown?) we need to handle?

**How to resolve:** in Zoho CRM Setup → Customization → Leads → Insurance Type field, copy the picklist values verbatim.

---

## #5 — Star rating field name

**Where:** `METRIC_DEFINITIONS.md` §12, §13.
**Question:** What is the actual Zoho field name for the star rating on Leads? Candidates seen in other Cornerstone systems:
- `Rating`
- `Stars`
- `Lead_Score`
- `Star_Rating`

**How to resolve:** confirm the field's API name in Zoho CRM Setup → Customization → Leads.

---

## #6 — BD Rep profile name and Admissions Rep profile name(s)

**Where:** `METRIC_DEFINITIONS.md` §16, §17.
**Question:** Confirm the exact literal Zoho Profile names used to classify:
- Admissions Rep (current draft: `Treatment Standard`, `Admin`)
- BD Rep (current draft: `Business Development`)

If "Admin" includes non-admissions admins (e.g. IT/system admins), we need a tighter filter — possibly Role-based instead of Profile-based.

**How to resolve:** Zoho CRM Setup → Security Control → Profiles. Confirm names and confirm Profile is the right dimension (vs Role).

---

## #7 — Zoho Analytics workspace, view, and auth pattern for Leads pull

**Where:** `METRIC_DEFINITIONS.md` §0, §1.
**Question:** To build the `sync_zoho_analytics_leads` edge function in Phase 1B, we need:
- Zoho Analytics **workspace ID**
- Zoho Analytics **view ID** (or report ID) for the Leads dataset
- **Auth pattern:** client ID + client secret + refresh token? OAuth scope required? Service account?
- Whether the report supports **incremental pull** by `Modified Time`, or only full-refresh.

**How to resolve:** Amber pulls from the Zoho Analytics URL of the leads report (workspace/view IDs are in the URL), and grants OAuth credentials with the `ZohoAnalytics.data.READ` scope (or equivalent).

---

## #8 — DUI dimension for reporting

**Where:** `METRIC_DEFINITIONS.md` §15.
**Question:** For executive-level rollups, does DUI:
- (a) roll up under Commercial,
- (b) roll up under AHCCCS,
- (c) stay as its own dimension (current draft), or
- (d) get suppressed entirely from "Commercial vs AHCCCS" splits?

This affects KPI cards like "Commercial Admits this month" and "AHCCCS Admits this month".

---

## #9 — Lead overlap rule: AHCCCS Lead vs Commercial Lead

**Where:** `METRIC_DEFINITIONS.md` §13.
**Question:** A Lead with `star_rating = 3` AND `insurance_type = "Commercial Insurance"` matches both definitions. Choose one:
- **A** — star rating wins → AHCCCS Lead only.
- **B** — insurance type wins → Commercial Lead only.
- **C** — both apply, the Lead counts in both buckets (current default — safer for not-dropping rows, but double-counts when summed).
- **D** — flag the row for manual triage; do not classify until resolved.

---

## #10 — Pipeline × Source Category orthogonality

**Where:** `METRIC_DEFINITIONS.md` §18.
**Question:** Confirm that Pipeline and Source Category are intentionally independent. A Deal with `pipeline = commercial_cash` and `source_category = business_development` should count as BOTH a Commercial Admit AND a BD Admit when filtered by each dimension separately.

This is the current default and matches the orthogonality matrix. Confirming explicitly because the executive narrative sometimes treats "BD" and "Commercial" as alternatives rather than co-occurring.

---

## #11 — Level of Care enum values

**Where:** `METRIC_DEFINITIONS.md` §8.
**Question:** What is the complete normalized LOC enum? Likely candidates (ASAM-aligned):
- Detox
- Residential (RTC)
- PHP (Partial Hospitalization)
- IOP (Intensive Outpatient)
- OP (Outpatient)
- Sober Living

Plus any Cornerstone-specific values (e.g., "Aftercare", "MAT-only", "Evaluation").

**How to resolve:** Amber lists every LOC that should exist as a normalized value, and we map raw Zoho strings to them in Phase 1B's `loc_mapping`.

---

## #12 — Sales Cycle: `Closing_Date` exact field name

**Where:** `METRIC_DEFINITIONS.md` §4, §11.
**Question:** Confirm the Zoho Deals field is named `Closing_Date` (API name). Some Zoho orgs use a custom `Actual_Close_Date` instead.

---

## #13 — Lead `Created Time` semantics

**Where:** `METRIC_DEFINITIONS.md` §1.
**Question:** Is `Created Time` on the Zoho Lead record the moment the Lead was first captured (e.g., form submission or call), or could it be the moment of CRM record creation (which could be later)? Pinning this matters for both Lead-creation counts and Sales Cycle math.

---

## #14 — Field for the "Closing Date" of an Admit

**Where:** `METRIC_DEFINITIONS.md` §4.
**Question:** When a Deal moves to `Closed Won`, which timestamp do we use as the Admit date?
- Zoho `Closing_Date` (manually set by the rep)?
- Zoho `Modified_Time` at the moment of the stage transition?
- A custom "Admit Date" field?

These can differ by days. Pick one canonically.

---

## #15 — Referral In source-side definition

**Where:** `METRIC_DEFINITIONS.md` §6.
**Question:** What field(s) on a Zoho Lead indicate it is a Referral In? Candidates:
- (a) `Lead_Source = "Referral"` (or similar)
- (b) `Source_Category` contains a referring account name
- (c) presence of a non-null `Referring_Account` field
- (d) Lead Source's parent category in `source_category_mapping` resolves to "Referral"

Without this answer the `op_referrals_daily` direction='in' column cannot be populated.

---

## #16 — Referral Out destination field

**Where:** `METRIC_DEFINITIONS.md` §7.
**Question:** When a Deal is Referred Out, where is the destination account name recorded on the Deal? Likely a custom field (`Referred_To`, `Destination_Account`, etc.). Confirm the API field name.

---

## #17 — Source Category raw field name and full picklist

**Where:** `METRIC_DEFINITIONS.md` §10.
**Question:** What is the Zoho field name for Source Category on Leads? `Lead_Source`? A custom `Source_Category` field? Both?

Also: provide the full list of raw picklist values currently in production so we can build `source_category_mapping` in Phase 1B.

---

## #18 — Test record exclusion rule

**Where:** `METRIC_DEFINITIONS.md` §19.
**Question:** How are test Leads / test Deals identified for exclusion? Common patterns:
- (a) Owner email contains "test" or matches a deny-list of internal addresses
- (b) Naming convention (Lead first/last name contains "Test")
- (c) A boolean custom field `Is_Test`
- (d) Specific Source value (e.g. `Lead_Source = "Test"`)

If multiple rules apply, list all.

---

## #19 — Exact Zoho pipeline string names

**Where:** `METRIC_DEFINITIONS.md` §2, §9.
**Question:** The "Sales Pipeline" MQL definition assumes a pipeline literally named "Sales Pipeline". Confirm:
- The pipeline a new Deal lives in by default (drives MQL count)
- The exact strings for `Commercial/Cash`, `AHCCCS`, `DUI`, `ZocDoc` as they appear in Zoho's Pipeline picklist.

---

## #20 — VOB Submitted: timestamp of flag flip

**Where:** `METRIC_DEFINITIONS.md` §3.
**Question:** Does Zoho separately track when `VOB Submitted` flipped to true (via a paired timestamp field or a stage history), or do we have to fall back to `Modified_Time`? Modified_Time changes on every edit, so it would over-attribute the VOB to whatever date the Deal was last touched.

If there is no flag-flip timestamp, the candidate fallback is the earliest `Modified_Time` after the flag became true — but that requires snapshotting which we don't yet have.

---

## #21 — Orphan deals in Sales Cycle math

**Where:** `METRIC_DEFINITIONS.md` §11.
**Question:** For Sales Cycle, when a `Closed Won` Deal has no matching Lead row in Zoho Analytics:
- (a) Exclude from Sales Cycle (current default).
- (b) Fall back to Deal `Created_Time` as the start point.
- (c) Surface in a separate "orphan" metric.

Option (a) is the safest because it doesn't fabricate a start time, but it under-reports volume.

---

## Document changelog

- **2026-05-27** — Initial draft alongside `METRIC_DEFINITIONS.md`. 21 open questions raised.
