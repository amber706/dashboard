# Metric Definitions

**Status:** Phase 1A draft — pending Amber sign-off in `CONFIRMED.md`.
**Owner:** Reporting foundation working group.
**Phoenix is the operating timezone for every date boundary in this document.** Arizona does not observe DST; Phoenix midnight = 07:00 UTC year-round.

This document is the single source of truth for every reporting primitive used by the Admissions Copilot. Every chart, every KPI, and every cached operational metric table is built on top of the definitions below. If a definition is wrong here, it is wrong everywhere.

Open ambiguities are listed inline as `OPEN_QUESTION #N` and collected in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md). Nothing downstream of this document is permitted to "decide" an ambiguity — every open question must be resolved by Amber and copied into `CONFIRMED.md` before Phase 1B begins.

---

## 0. Source systems

| System | Role | How we read it |
|---|---|---|
| **Zoho Analytics** | Source of truth for **Leads** (pre-conversion state) | Pre-built report; pulled via Analytics API. Workspace ID + view ID + auth pattern in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) `#7`. |
| **Zoho CRM** | Source of truth for **Deals**, **Users**, **Meetings** | Live API, incremental by `Modified_Time`. |
| **Call Tracking Metrics (CTM)** | Source of truth for **Calls** | Live API, incremental. |

**Why Zoho Analytics for Leads:** Zoho CRM converts a Lead record into a Deal when it advances, and the original Lead's identity is destroyed in the process. A live CRM query of Leads will miss every historical lead that has since been converted. Zoho Analytics snapshots pre-conversion lead state and is therefore the only trustworthy source of historical lead counts.

---

## 1. Lead

A **Lead** is one row in the Zoho Leads module, captured at the point the Lead was created — even if that row has since been converted to a Deal.

- **Source:** Zoho Analytics → Leads view.
- **Identity:** `source_lead_id` = Zoho Lead ID.
- **Owner:** Zoho Lead Owner → resolved to `user_identity.id` via [Phase 1B mapping].
- **Created at:** Zoho Leads `Created Time`. See `OPEN_QUESTION #13`.
- **Rule:** every row in the Analytics Leads view is a Lead. No filter is applied at the definition layer; filtering by source/LOC/insurance/star happens via the filter contract.
- **Edge cases:**
  - A Lead that has been converted to a Deal still counts as a Lead on the date it was created. The Lead row is preserved by the Analytics snapshot.
  - The same individual contacting multiple times can produce multiple Lead rows. Deduplication is **not** part of the Lead definition — each row counts once. If dedupe is needed later it will be a separate primitive.
  - Test Leads / internal test rows must be excluded. See `OPEN_QUESTION #18`.

---

## 2. MQL (Marketing Qualified Lead)

An **MQL** is a Deal that has been created in the **Sales Pipeline**.

- **Source:** Zoho CRM Deals.
- **Rule:** `Deal.Pipeline = "Sales Pipeline"` AND the Deal exists. (Creation alone qualifies — no stage filter.)
- **Counted on:** the Deal's `Created_Time` (Phoenix-local date).
- **Edge cases:**
  - A Lead that becomes a Deal counts as 1 Lead AND 1 MQL on their respective creation dates. They are not double-counted in any single funnel column.
  - Deals created in pipelines other than the canonical "Sales Pipeline" do not count. See `OPEN_QUESTION #19` for confirmation of the exact pipeline name string.

---

## 3. VOB (Verification of Benefits)

A **VOB** is a Sales Pipeline Deal where the `VOB Submitted` flag is true.

- **Source:** Zoho CRM Deals.
- **Rule:** Deal exists in any of the four pipelines AND `VOB Submitted = true`.
- **Counted on:** the date the VOB Submitted flag flipped to true. If that timestamp is not separately tracked, fall back to `Modified_Time` on the most recent edit where the flag is true. See `OPEN_QUESTION #20`.
- **Edge cases:**
  - The field name may differ across the four pipelines (Commercial/Cash, AHCCCS, DUI, ZocDoc). See `OPEN_QUESTION #3`.
  - A Deal whose VOB flag is set then unset later: counts as a VOB on the date the flag was true, but is no longer a VOB once unset. The cached daily table reflects the flag's current state for the day it is rebuilt — see Phase 1B `op_metrics` build for late-edit handling.

---

## 4. Admit

An **Admit** is a Deal at Stage = `Closed Won`.

- **Source:** Zoho CRM Deals.
- **Rule:** `Deal.Stage = "Closed Won"`.
- **Counted on:** `Closing_Date` (the date the Deal reached Closed Won). See `OPEN_QUESTION #14` to confirm field name.
- **Edge cases:**
  - "Closed Won" must be the exact stage string. Any near-variant (e.g. "Closed - Won", "Closed Won - X") does **not** count as Admit unless explicitly mapped. See [Stage Mapping, Phase 1B].
  - A Deal that reaches Closed Won, gets reopened, and is re-closed: counted on the most recent Closed Won transition.

---

## 5. Closed Lost (and the three Referred Out variants)

A **Closed Lost** Deal is one whose Stage begins with `Closed Lost`.

- **Source:** Zoho CRM Deals.
- **Rule:** `Deal.Stage` ∈ the set of stage strings that begin with `Closed Lost`.
- **Counted on:** `Closing_Date`. (Same field as Admit for consistency.)
- **Three "Referred Out" sub-variants** — these must each be a literal stage string mapped to the `closed_lost_referred_out` category in the Phase 1B stage mapping:
  1. `Closed Lost - Referred Out` — Lead/Deal was referred to another provider, attached to a destination.
  2. `Closed Lost - Referred out Unattached` — referred out, destination not recorded.
  3. `Referred out coming back` — referred out with an expectation the lead returns.
  
  See `OPEN_QUESTION #1` — the exact stage strings must be confirmed against Zoho CRM. Any deviation breaks the Referred Out metric.

- **Closed Lost (Other):** every Closed Lost stage that is **not** one of the three Referred Out variants. Examples: "Closed Lost - Not a Fit", "Closed Lost - Unresponsive", etc. The full list is enumerated in Phase 1B's `stage_mapping` table.

---

## 6. Referral In

A **Referral In** is a Lead (Zoho Analytics) that arrived via a referral source.

- **Source:** Zoho Analytics → Leads view.
- **Rule:** the Lead's source category indicates a referral source. The exact rule depends on the Source Category mapping (see §10) and is currently undefined.
- **Counted on:** Lead `Created Time`.
- **Status:** `OPEN_QUESTION #15` — Referral In needs a source-side definition before Phase 1B sync can populate `op_referrals_daily`. Candidate rules: (a) Lead Source = "Referral"; (b) source category is a referring account name; (c) presence of a non-null "Referring Account" field. Amber to confirm.

---

## 7. Referral Out

A **Referral Out** is a Deal whose stage is one of the three Referred Out variants (§5).

- **Source:** Zoho CRM Deals.
- **Rule:** `stage_category = closed_lost_referred_out`.
- **Counted on:** `Closing_Date`.
- **Account name:** the destination account (where the patient was referred to) lives on the Deal. Field name TBD — see `OPEN_QUESTION #16`.

---

## 8. Level of Care (LOC)

LOC describes the clinical level of care being requested or admitted to. **The source field differs by funnel stage** — this is the most error-prone rule in the entire taxonomy, so it is spelled out explicitly:

| Funnel stage | LOC source field |
|---|---|
| Lead | Zoho Leads → **"Level of Care Requested"** |
| MQL | Zoho Deals → **"Level of Care Requested"** |
| VOB | Zoho Deals → **"Level of Care Requested"** |
| Admit | Zoho Deals → **"Level of Care Admitted"** |
| Closed Lost (incl. Referred Out) | Zoho Deals → **"Level of Care Requested"** |

**Rule of thumb:** any pre-Admit metric uses *Requested*. The Admit metric — and only the Admit metric — uses *Admitted*. Requested ≠ Admitted is common (a Lead might request Detox and admit to PHP).

LOC enum values are normalized via the Phase 1B `loc_mapping` table. The canonical normalized set is in `OPEN_QUESTION #11` — Amber to confirm the full list before 1B begins. Likely candidates based on industry-standard ASAM levels of care: Detox, Residential, PHP, IOP, OP, Sober Living. Spelling variants in raw Zoho data (e.g., "Detox"/"Detoxification", "IOP"/"Intensive Outpatient") map to a single normalized value.

---

## 9. Pipeline

A Deal in Zoho CRM belongs to exactly one of four pipelines:

| Normalized name | Raw Zoho string (TBD — `OPEN_QUESTION #19`) | Purpose |
|---|---|---|
| `commercial_cash` | "Commercial/Cash" (assumed) | Commercial insurance + private pay |
| `ahcccs` | "AHCCCS" (assumed) | AHCCCS Medicaid |
| `dui` | "DUI" (assumed) | DUI program — see `OPEN_QUESTION #2` for current usage |
| `zocdoc` | "ZocDoc" (assumed) | ZocDoc-sourced |

Mapped via `pipeline_mapping` in Phase 1B. The four normalized values above are the canonical Pipeline enum and are the only legal values downstream.

---

## 10. Source Category

Where the Lead came from. Three normalized buckets:

| Normalized name | Rule | Notes |
|---|---|---|
| `business_development` | Raw source category = "Business Development" | BD reps' outreach |
| `zocdoc` | Raw source category = "ZocDoc" | ZocDoc-sourced |
| `digital_marketing` | Raw source category ∉ {Business Development, ZocDoc} | **Catch-all.** Every Lead that is not BD or ZocDoc rolls up to Digital Marketing. |

This means Source Category is computed via the *negative* rule for Digital Marketing — any new raw source string Zoho introduces will automatically fall into Digital Marketing unless explicitly mapped otherwise. This is intentional: we'd rather over-count Digital Marketing than miss a new source bucket. Unmapped raw strings still appear in `v_unmapped_sources` (Phase 1B) for triage.

Raw Zoho field name and exact strings: `OPEN_QUESTION #17`.

---

## 11. Sales Cycle (days)

For a Deal where `Stage = "Closed Won"`:

```
sales_cycle_days = closing_date − lead.created_at
```

Where `lead.created_at` is the **Zoho Lead's** original `Created Time` (from Zoho Analytics), not the Deal's `Created_Time`. This matters because a Lead may sit for weeks before becoming a Deal.

- **Source for `closing_date`:** Zoho Deals → `Closing_Date`.
- **Source for `lead.created_at`:** Zoho Analytics Leads → `Created Time`, joined via the Deal's `Lead_Id` foreign key.
- **Edge cases:**
  - **Orphan deals** (Deal with no matching Lead row in Analytics): excluded from Sales Cycle. Tracked in `v_orphan_deals` (Phase 1B). See `OPEN_QUESTION #21` for whether orphan deals should fall back to Deal `Created_Time` instead.
  - Negative values (closing_date before lead.created_at) are impossible and indicate a data error — flagged in `v_sync_failures_recent`.

---

## 12. AHCCCS Lead

A Lead is an **AHCCCS Lead** if it satisfies **either**:
- `Lead.Star_Rating = 3`, OR
- `Lead.Insurance_Type = "AHCCCS"`.

Star rating field name and insurance type enum values: `OPEN_QUESTION #5`, `OPEN_QUESTION #4`.

---

## 13. Commercial Lead

A Lead is a **Commercial Lead** if it satisfies **either**:
- `Lead.Star_Rating ∈ {4, 5}`, OR
- `Lead.Insurance_Type ∈ {"Commercial Insurance", "Private Pay"}`.

- **Overlap with AHCCCS Lead** is possible — a Lead with `star_rating = 3` AND `insurance_type = "Commercial Insurance"` satisfies both definitions. This overlap is intentional at the definition layer and is surfaced as `OPEN_QUESTION #9` for Amber to decide:
  - **Option A:** Star rating wins → that Lead is AHCCCS only.
  - **Option B:** Insurance type wins → that Lead is Commercial only.
  - **Option C:** Both classifications apply → the Lead appears in both counts (current default).

The default `Option C` is the *safer* choice because it never silently drops a Lead from a count, but it can double-count when the two dimensions are summed. Amber to confirm.

---

## 14. AHCCCS VOB / AHCCCS Admit

A VOB or Admit is **AHCCCS** if the Deal's `pipeline = ahcccs`.

This is pipeline-driven, not insurance-type-driven — the pipeline is the authoritative classifier on the Deal side. (Insurance type on the Lead side may not match the pipeline on the Deal side once converted.)

---

## 15. Commercial VOB / Commercial Admit

A VOB or Admit is **Commercial** if the Deal's `pipeline = commercial_cash`.

DUI and ZocDoc Admits/VOBs are **not** counted as Commercial. They are their own dimensions. See `OPEN_QUESTION #8` for whether DUI should roll up into Commercial for executive reporting.

---

## 16. Admissions Rep

An **Admissions Rep** is a Zoho User who is currently active AND whose Profile is one of:

- `Treatment Standard`
- `Admin`

(`OPEN_QUESTION #6` — confirm exact Profile names against Zoho CRM Users.)

---

## 17. BD Rep

A **BD Rep** is a Zoho User who is currently active AND whose Profile = `Business Development`.

(`OPEN_QUESTION #6` — confirm exact Profile name.)

---

## 18. Orthogonality matrix

A single Deal can be classified along multiple orthogonal dimensions simultaneously. These dimensions do **not** conflict with each other:

| Dimension | Values |
|---|---|
| Pipeline | commercial_cash, ahcccs, dui, zocdoc |
| Source Category | digital_marketing, business_development, zocdoc |
| Stage Category | mql, vob_submitted, closed_won, closed_lost_referred_out, closed_lost_other, in_progress |
| LOC | (LOC enum) |
| Rep Role (of owner) | admissions_rep, bd_rep, other |

A Deal with pipeline=`commercial_cash` AND source_category=`business_development` AND stage=`Closed Won` is **all of**: Commercial Admit, BD Admit, and Admit. This is the intended behavior — these dimensions are filterable independently in the FilterBar (Phase 1C).

The only exception is the AHCCCS Lead / Commercial Lead overlap at the *Lead* level (§13), because there the two categories share underlying fields. At the Deal level there is no overlap because Pipeline is single-valued.

---

## 19. Test data exclusion

Test Leads, test Deals, and internal test users must be excluded from every metric. `OPEN_QUESTION #18` — Amber to specify the rule (e.g. owner email domain, naming convention, an "Is Test" custom field, or an explicit deny-list).

---

## 20. Filter contract preview

Every dashboard page in Phase 1C and beyond accepts the same filter set:

- **Time:** Today, Current Week, Previous Week, This Month, This Quarter, Last Month, Last 3 Months, Last 6 Months, Last Year, Custom range. Default for trend charts: this month + the prior two months.
- **Level of Care:** multi-select from the LOC enum.
- **Pipeline:** multi-select.
- **Marketing Channel:** multi-select (Digital, BD, ZocDoc) — derived from Source Category.
- **Sales Rep:** multi-select user_identity, role-aware (admissions reps see only themselves via RLS).

The Zod `FilterContractSchema` in `src/lib/metrics/schemas.ts` is the runtime contract.

---

## Document changelog

- **2026-05-27** — Initial draft. Drafted by Claude for Amber's review. Eleven `OPEN_QUESTION` markers raised; expanded set in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
