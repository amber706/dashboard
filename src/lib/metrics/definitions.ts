/**
 * Canonical reporting primitives.
 *
 * This is the ONLY module in the codebase permitted to contain string literals
 * for pipeline names, stage names, source categories, level-of-care values,
 * insurance types, or rep profile names. Phase 1B's mapping tables are the
 * other permitted location. Every consumer must import the constants from
 * here — see `scripts/check-metric-literals.sh` for the CI guard.
 *
 * If a value here is wrong, every chart and KPI in the system is wrong.
 * Read `docs/METRIC_DEFINITIONS.md` before editing, and check `CONFIRMED.md`
 * for the resolutions behind each design choice.
 */

// ────────────────────────────────────────────────────────────────────────────
// Pipelines — five, not four. Cornerstone Main Sales Pipeline layout.
// ────────────────────────────────────────────────────────────────────────────

export const PIPELINE = {
  CommercialCash: "commercial_cash",
  Ahcccs: "ahcccs",
  Zocdoc: "zocdoc",
  DuiCash: "dui_cash",
  DvCash: "dv_cash",
} as const;

export type Pipeline = (typeof PIPELINE)[keyof typeof PIPELINE];

export const PIPELINE_VALUES: readonly Pipeline[] = Object.freeze([
  PIPELINE.CommercialCash,
  PIPELINE.Ahcccs,
  PIPELINE.Zocdoc,
  PIPELINE.DuiCash,
  PIPELINE.DvCash,
]);

/**
 * Pipelines that count toward the top-line "Admits this month" / "MQLs this
 * month" / "VOBs this month" KPIs. DUI and DV are real pipelines but
 * structurally different (screenings/classes/court-mandated participation,
 * not treatment admits) and are reported as their own dimensions.
 *
 * See CONFIRMED.md #3.
 */
export const TOP_LINE_ADMIT_PIPELINES: readonly Pipeline[] = Object.freeze([
  PIPELINE.CommercialCash,
  PIPELINE.Ahcccs,
  PIPELINE.Zocdoc,
]);

/** Raw Zoho pipeline strings, exact spelling. Used by pipeline_mapping in 1B. */
export const RAW_PIPELINE_STRINGS = Object.freeze({
  [PIPELINE.CommercialCash]: "Commercial-Cash",
  [PIPELINE.Ahcccs]: "AHCCCS",
  [PIPELINE.Zocdoc]: "ZocDoc",
  [PIPELINE.DuiCash]: "DUI - Cash",
  [PIPELINE.DvCash]: "DV - Cash",
}) satisfies Record<Pipeline, string>;

// ────────────────────────────────────────────────────────────────────────────
// Stage categories — the normalized rollup of every raw Zoho stage string.
// See METRIC_DEFINITIONS.md §3 for the per-pipeline raw → normalized table.
// ────────────────────────────────────────────────────────────────────────────

export const STAGE_CATEGORY = {
  /** Default. Stuck Lead, early-funnel stages, DUI Qualifying Services / Scheduled Payment, DV Intake Scheduled, etc. */
  InProgress: "in_progress",
  /** Raw: `VOB - Qualifying`. */
  VobQualifying: "vob_qualifying",
  /** Raw: `VOB - Approved`. */
  VobApproved: "vob_approved",
  /** PA stages, Direct Admit Scheduled, Step Down Scheduled, Pre Screen *, Intake Assessment Scheduled, Orientation Scheduled, Open Payment Plan. */
  PreAdmit: "pre_admit",
  /** Raw: `Referred Out - Coming Back`. Active, soft-out. See CONFIRMED.md #2. */
  ReferredOutComingBack: "referred_out_coming_back",
  /** Raw: `Closed - Admitted` across Commercial-Cash, AHCCCS, ZocDoc, DV - Cash. The treatment admit. */
  ClosedWonAdmitted: "closed_won_admitted",
  /** Raw: `Closed - Referred Out Unattached`, Commercial-Cash only. The placement win. See CONFIRMED.md #1. */
  ClosedWonReferredOutUnattached: "closed_won_referred_out_unattached",
  /** Raw: `Closed - Screening Only` / `Closed - Both Screening & Classes` / `Closed - Classes Only`. DUI - Cash only. */
  ClosedWonDuiCompletion: "closed_won_dui_completion",
  /** Raw: any `Closed - Lost (X)`. Pipeline-specific suffixes. */
  ClosedLost: "closed_lost",
} as const;

export type StageCategory = (typeof STAGE_CATEGORY)[keyof typeof STAGE_CATEGORY];

export const STAGE_CATEGORY_VALUES: readonly StageCategory[] = Object.freeze([
  STAGE_CATEGORY.InProgress,
  STAGE_CATEGORY.VobQualifying,
  STAGE_CATEGORY.VobApproved,
  STAGE_CATEGORY.PreAdmit,
  STAGE_CATEGORY.ReferredOutComingBack,
  STAGE_CATEGORY.ClosedWonAdmitted,
  STAGE_CATEGORY.ClosedWonReferredOutUnattached,
  STAGE_CATEGORY.ClosedWonDuiCompletion,
  STAGE_CATEGORY.ClosedLost,
]);

/**
 * Stage categories that imply a VOB ran at some point — used as the
 * stage-based backup when the explicit `VOB_Submitted` boolean and
 * `VOB_Submitted_Date` field are both empty. See CONFIRMED.md #33.
 *
 * `closed_lost` is INTENTIONALLY EXCLUDED. Cornerstone deals can move
 * directly from Stuck Lead to Closed Lost without ever having a VOB
 * run (caller dropped off, lost to competition, etc.). Treating
 * closed_lost as "has VOB" would falsely inflate the VOB count.
 *
 * `closed_won_dui_completion` is also excluded — the DUI - Cash pipeline
 * has no VOB stages at all.
 */
export const STAGE_CATEGORIES_AT_OR_PAST_VOB: readonly StageCategory[] = Object.freeze([
  STAGE_CATEGORY.VobQualifying,
  STAGE_CATEGORY.VobApproved,
  STAGE_CATEGORY.PreAdmit,
  STAGE_CATEGORY.ReferredOutComingBack,
  STAGE_CATEGORY.ClosedWonAdmitted,
  STAGE_CATEGORY.ClosedWonReferredOutUnattached,
]);

/** Stage categories that represent a closed outcome (won or lost). */
export const STAGE_CATEGORIES_CLOSED: readonly StageCategory[] = Object.freeze([
  STAGE_CATEGORY.ClosedWonAdmitted,
  STAGE_CATEGORY.ClosedWonReferredOutUnattached,
  STAGE_CATEGORY.ClosedWonDuiCompletion,
  STAGE_CATEGORY.ClosedLost,
]);

/**
 * Raw Zoho stage strings that map to each stage category. The Phase 1B
 * `stage_mapping` table is seeded from this. Keep these EXACT (spacing,
 * hyphens, casing all matter).
 */
export const RAW_STAGE_TO_CATEGORY: Readonly<Record<string, StageCategory>> = Object.freeze({
  // In progress — early-funnel stuck states and pre-VOB processing
  "Stuck Lead - Commercial/Cash": STAGE_CATEGORY.InProgress,
  "Stuck Lead - Ahcccs": STAGE_CATEGORY.InProgress,
  "Stuck Lead - DUI (Cash)": STAGE_CATEGORY.InProgress,
  "Stuck Lead - DV (Cash)": STAGE_CATEGORY.InProgress,
  "Stuck Lead - ZocDoc": STAGE_CATEGORY.InProgress,
  "Qualifying Services": STAGE_CATEGORY.InProgress,
  "Scheduled Payment": STAGE_CATEGORY.InProgress,
  "Intake Scheduled": STAGE_CATEGORY.InProgress,

  // VOB stages
  "VOB - Qualifying": STAGE_CATEGORY.VobQualifying,
  "VOB - Approved": STAGE_CATEGORY.VobApproved,

  // Pre-admit (active and progressing)
  "PA - Scheduling/Scheduled": STAGE_CATEGORY.PreAdmit,
  "PA - Completed": STAGE_CATEGORY.PreAdmit,
  "Direct Admit - Scheduled": STAGE_CATEGORY.PreAdmit,
  "Step Down - Scheduled": STAGE_CATEGORY.PreAdmit,
  "Pre Screen - Scheduled": STAGE_CATEGORY.PreAdmit,
  "Pre Screen - Completed": STAGE_CATEGORY.PreAdmit,
  "Intake Assessment - Scheduled": STAGE_CATEGORY.PreAdmit,
  "Orientation Scheduled": STAGE_CATEGORY.PreAdmit,
  "Open Payment Plan": STAGE_CATEGORY.PreAdmit,

  // Referred out, coming back — active soft-out
  "Referred Out - Coming Back": STAGE_CATEGORY.ReferredOutComingBack,

  // Closed Won — Admit (treatment admit, four pipelines)
  "Closed - Admitted": STAGE_CATEGORY.ClosedWonAdmitted,

  // Closed Won — Placement (Commercial-Cash only)
  "Closed - Referred Out Unattached": STAGE_CATEGORY.ClosedWonReferredOutUnattached,

  // Closed Won — DUI Completion (DUI - Cash only)
  "Closed - Screening Only": STAGE_CATEGORY.ClosedWonDuiCompletion,
  "Closed - Both Screening & Classes": STAGE_CATEGORY.ClosedWonDuiCompletion,
  "Closed - Classes Only": STAGE_CATEGORY.ClosedWonDuiCompletion,

  // Closed Lost — pipeline-specific suffixes
  "Closed - Lost (Treatment)": STAGE_CATEGORY.ClosedLost,
  "Closed - Lost (DUI)": STAGE_CATEGORY.ClosedLost,
  "Closed - Lost (DV)": STAGE_CATEGORY.ClosedLost,
});

// ────────────────────────────────────────────────────────────────────────────
// Source categories (normalized — 3 buckets)
// ────────────────────────────────────────────────────────────────────────────

export const SOURCE_CATEGORY = {
  DigitalMarketing: "digital_marketing",
  BusinessDevelopment: "business_development",
  Zocdoc: "zocdoc",
} as const;

export type SourceCategory = (typeof SOURCE_CATEGORY)[keyof typeof SOURCE_CATEGORY];

export const SOURCE_CATEGORY_VALUES: readonly SourceCategory[] = Object.freeze([
  SOURCE_CATEGORY.DigitalMarketing,
  SOURCE_CATEGORY.BusinessDevelopment,
  SOURCE_CATEGORY.Zocdoc,
]);

export const RAW_SOURCE_BUSINESS_DEVELOPMENT = "Business Development";
export const RAW_SOURCE_ZOCDOC = "ZocDoc";

// ────────────────────────────────────────────────────────────────────────────
// Insurance types (raw Zoho Lead picklist values; see CONFIRMED.md #8 + #14)
// ────────────────────────────────────────────────────────────────────────────
// Values are the ZOHO ACTUAL STORED VALUES (what the API returns), not the
// display labels. Two display→actual differences confirmed via the Leads
// metadata API:
//   - "Commercial Insurance" display → stored as "Private Insurance"
//   - "Cash" display              → stored as "Cash Pay"
// The Insurance_Type field also contains EPO/HMO/POS/PPO values, but those
// are network types overloaded into the same picklist. The properly-scoped
// network field is `Insurance_Policy_Type` (PPO/HMO/EPO/POS/Not Applicable);
// we intentionally ignore both for Phase 1A — see OPEN_QUESTION #29.

export const INSURANCE_TYPE = {
  Ahcccs: "AHCCCS",
  CommercialInsurance: "Private Insurance",
  Cash: "Cash Pay",
  Medicare: "Medicare",
  NoInsurance: "No Insurance",
  OutOfStateMedicaid: "Out of State Medicaid",
} as const;

export type InsuranceType = (typeof INSURANCE_TYPE)[keyof typeof INSURANCE_TYPE];

/** Insurance types that classify a Treatment Lead as Commercial. */
export const COMMERCIAL_INSURANCE_TYPES: readonly InsuranceType[] = Object.freeze([
  INSURANCE_TYPE.CommercialInsurance,
  INSURANCE_TYPE.Cash,
]);

/** Insurance types that classify a Treatment Lead as AHCCCS. */
export const AHCCCS_INSURANCE_TYPES: readonly InsuranceType[] = Object.freeze([
  INSURANCE_TYPE.Ahcccs,
]);

/**
 * Insurance types that classify a Treatment Lead as Other Payer (own bucket,
 * not AHCCCS, not Commercial). Per CONFIRMED.md #9, Medicare, No Insurance,
 * and Out of State Medicaid each surface as separate reporting buckets and
 * are not folded into AHCCCS or Commercial.
 */
export const OTHER_PAYER_INSURANCE_TYPES: readonly InsuranceType[] = Object.freeze([
  INSURANCE_TYPE.Medicare,
  INSURANCE_TYPE.NoInsurance,
  INSURANCE_TYPE.OutOfStateMedicaid,
]);

// ────────────────────────────────────────────────────────────────────────────
// Lead Score Rating — raw Zoho picklist; star count is encoded in the label.
// See CONFIRMED.md #10.
// ────────────────────────────────────────────────────────────────────────────
// The field is `Lead Score Rating` (a single picklist column, not a separate
// numeric column). Star count = number of leading ⭐ characters in the label.
// Cornerstone-specific values seen in production:
//   0 stars: "Unable To Score/Never Made Contact"
//   1 star : "⭐ Junk/Spam"
//   2 stars: "⭐⭐ HR/Client Care/Family/Care Coordination..."
//   3 stars: "⭐⭐⭐ Seeking Treatment: Medicaid"             → AHCCCS-eligible
//   4 stars: "⭐⭐⭐⭐ Seeking Treatment: Commercial, ..."     → Commercial-eligible
//   5 stars: "⭐⭐⭐⭐⭐ Seeking Treatment: Commercial, ..."   → Commercial-eligible
// Full 4-star and 5-star strings still pending — see OPEN_QUESTION #27.

export const AHCCCS_STAR_RATINGS: readonly number[] = Object.freeze([3]);
export const COMMERCIAL_STAR_RATINGS: readonly number[] = Object.freeze([4, 5]);

/** Count of leading ⭐ characters in a Lead Score Rating picklist value. */
export function leadScoreRatingToStarCount(rating: string | null | undefined): number {
  if (!rating) return 0;
  const matches = rating.match(/⭐/g);
  return matches ? matches.length : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Level of Care — Cornerstone-specific picklist confirmed from Zoho Lead
// detail. See CONFIRMED.md #11. DUI and DV appear as LOC values at the
// Lead level — leads with those LOCs convert into the DUI - Cash / DV - Cash
// pipelines and are excluded from AHCCCS Lead and Commercial Lead
// classifications (see `isTreatmentLead`).
// ────────────────────────────────────────────────────────────────────────────

export const LEVEL_OF_CARE = {
  Bhrf: "bhrf",
  Detox: "detox",
  Php: "php",
  Iop5: "iop5",
  Iop3: "iop3",
  ViopAdult: "viop_adult",
  ViopAdolescent: "viop_adolescent",
  Op: "op",
  Vop: "vop",
  VopAdult: "vop_adult",
  VopAdolescent: "vop_adolescent",
  Dui: "dui",
  Dv: "dv",
} as const;

export type LevelOfCare = (typeof LEVEL_OF_CARE)[keyof typeof LEVEL_OF_CARE];

export const LEVEL_OF_CARE_VALUES: readonly LevelOfCare[] = Object.freeze([
  LEVEL_OF_CARE.Bhrf,
  LEVEL_OF_CARE.Detox,
  LEVEL_OF_CARE.Php,
  LEVEL_OF_CARE.Iop5,
  LEVEL_OF_CARE.Iop3,
  LEVEL_OF_CARE.ViopAdult,
  LEVEL_OF_CARE.ViopAdolescent,
  LEVEL_OF_CARE.Op,
  LEVEL_OF_CARE.Vop,
  LEVEL_OF_CARE.VopAdult,
  LEVEL_OF_CARE.VopAdolescent,
  LEVEL_OF_CARE.Dui,
  LEVEL_OF_CARE.Dv,
]);

/** LOC values that indicate a Treatment lead (not DUI program, not DV program). */
export const TREATMENT_LOC_VALUES: readonly LevelOfCare[] = Object.freeze([
  LEVEL_OF_CARE.Bhrf,
  LEVEL_OF_CARE.Detox,
  LEVEL_OF_CARE.Php,
  LEVEL_OF_CARE.Iop5,
  LEVEL_OF_CARE.Iop3,
  LEVEL_OF_CARE.ViopAdult,
  LEVEL_OF_CARE.ViopAdolescent,
  LEVEL_OF_CARE.Op,
  LEVEL_OF_CARE.Vop,
  LEVEL_OF_CARE.VopAdult,
  LEVEL_OF_CARE.VopAdolescent,
]);

/** Raw Zoho LOC strings (as they appear in the Lead picklist). */
export const RAW_LOC_STRINGS = Object.freeze({
  [LEVEL_OF_CARE.Bhrf]: "BHRF",
  [LEVEL_OF_CARE.Detox]: "Detox",
  [LEVEL_OF_CARE.Php]: "PHP",
  [LEVEL_OF_CARE.Iop5]: "IOP5",
  [LEVEL_OF_CARE.Iop3]: "IOP3",
  [LEVEL_OF_CARE.ViopAdult]: "VIOP", // Note: stored as "VIOP" in Zoho even though display label is "VIOP Adult"
  [LEVEL_OF_CARE.ViopAdolescent]: "VIOP Adolescent",
  [LEVEL_OF_CARE.Op]: "OP",
  [LEVEL_OF_CARE.Vop]: "VOP",
  [LEVEL_OF_CARE.VopAdult]: "VOP Adult",
  [LEVEL_OF_CARE.VopAdolescent]: "VOP Adolescent",
  [LEVEL_OF_CARE.Dui]: "DUI",
  [LEVEL_OF_CARE.Dv]: "DV",
}) satisfies Record<LevelOfCare, string>;

// ────────────────────────────────────────────────────────────────────────────
// Rep roles (derived from Zoho Profile — OPEN_QUESTION #6)
// ────────────────────────────────────────────────────────────────────────────

export const REP_ROLE = {
  AdmissionsRep: "admissions_rep",
  BdRep: "bd_rep",
  Other: "other",
} as const;

export type RepRole = (typeof REP_ROLE)[keyof typeof REP_ROLE];

export const REP_ROLE_VALUES: readonly RepRole[] = Object.freeze([
  REP_ROLE.AdmissionsRep,
  REP_ROLE.BdRep,
  REP_ROLE.Other,
]);

/**
 * Zoho Profile names that classify a User as an Admissions Rep.
 * Confirmed from live Users API (CONFIRMED.md #15):
 * - "TREATMENT Standard" — note ALL CAPS on TREATMENT
 * - "Administrator" (not "Admin" as the brief said)
 * - "Call Center AHCCCS" — bilingual AHCCCS-line intake reps; included
 *   per CONFIRMED.md #16
 */
export const ADMISSIONS_REP_PROFILES: readonly string[] = Object.freeze([
  "TREATMENT Standard",
  "Administrator",
  "Call Center AHCCCS",
]);

export const BD_REP_PROFILE = "Business Development";

// ────────────────────────────────────────────────────────────────────────────
// Marketing channels (surface label for Source Category in filter UI)
// ────────────────────────────────────────────────────────────────────────────

export const MARKETING_CHANNEL = {
  Digital: "digital",
  BusinessDevelopment: "business_development",
  Zocdoc: "zocdoc",
} as const;

export type MarketingChannel = (typeof MARKETING_CHANNEL)[keyof typeof MARKETING_CHANNEL];

export const MARKETING_CHANNEL_VALUES: readonly MarketingChannel[] = Object.freeze([
  MARKETING_CHANNEL.Digital,
  MARKETING_CHANNEL.BusinessDevelopment,
  MARKETING_CHANNEL.Zocdoc,
]);

export function sourceCategoryToMarketingChannel(sc: SourceCategory): MarketingChannel {
  switch (sc) {
    case SOURCE_CATEGORY.DigitalMarketing:
      return MARKETING_CHANNEL.Digital;
    case SOURCE_CATEGORY.BusinessDevelopment:
      return MARKETING_CHANNEL.BusinessDevelopment;
    case SOURCE_CATEGORY.Zocdoc:
      return MARKETING_CHANNEL.Zocdoc;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Time range presets
// ────────────────────────────────────────────────────────────────────────────

export const TIME_RANGE_PRESET = {
  Today: "today",
  CurrentWeek: "current_week",
  PreviousWeek: "previous_week",
  ThisMonth: "this_month",
  ThisQuarter: "this_quarter",
  LastMonth: "last_month",
  Last3Months: "last_3_months",
  Last6Months: "last_6_months",
  LastYear: "last_year",
  Custom: "custom",
} as const;

export type TimeRangePreset = (typeof TIME_RANGE_PRESET)[keyof typeof TIME_RANGE_PRESET];

export const TIME_RANGE_PRESET_VALUES: readonly TimeRangePreset[] = Object.freeze([
  TIME_RANGE_PRESET.Today,
  TIME_RANGE_PRESET.CurrentWeek,
  TIME_RANGE_PRESET.PreviousWeek,
  TIME_RANGE_PRESET.ThisMonth,
  TIME_RANGE_PRESET.ThisQuarter,
  TIME_RANGE_PRESET.LastMonth,
  TIME_RANGE_PRESET.Last3Months,
  TIME_RANGE_PRESET.Last6Months,
  TIME_RANGE_PRESET.LastYear,
  TIME_RANGE_PRESET.Custom,
]);

export const DEFAULT_TIME_RANGE_PRESET: TimeRangePreset = TIME_RANGE_PRESET.ThisMonth;

// ────────────────────────────────────────────────────────────────────────────
// Classifier predicates
//
// Each predicate takes the minimum shape of fields needed to make the call.
// Predicates are orthogonal — top-line vs. all-pipeline filtering is the
// responsibility of the resolver, not the predicate. See METRIC_DEFINITIONS.md
// §21 (orthogonality matrix) and CONFIRMED.md #3.
// ────────────────────────────────────────────────────────────────────────────

export interface LeadShape {
  /** Derived star count (0-5) parsed from the Lead Score Rating picklist via `leadScoreRatingToStarCount`. */
  star_rating: number | null;
  insurance_type: InsuranceType | null;
  level_of_care_requested: LevelOfCare | null;
  source_category: SourceCategory;
  /**
   * Raw value of the Zoho `BD_Rep` Lead picklist — names of BD reps when a
   * lead is attributable to a specific BD rep contact. Used by `isReferralIn`
   * per CONFIRMED.md #27. Values are bare names ("Amber", "Casey", etc.),
   * or null / "-None-" / "None" when unattributed.
   */
  bd_rep_inbound: string | null;
}

export interface DealShape {
  pipeline: Pipeline;
  stage_category: StageCategory;
  source_category: SourceCategory;
  /**
   * `VOB_Submitted` custom boolean on Zoho Deals. **Primary signal** for
   * the VOB metric per CONFIRMED.md #33 — if true, the deal is a VOB
   * regardless of stage.
   */
  vob_submitted: boolean;
  /**
   * `VOB_Submitted_Date` custom date on Zoho Deals. **Primary signal** for
   * the VOB metric per CONFIRMED.md #33 — if non-null, the deal is a VOB
   * regardless of the boolean field's state (specialists sometimes set
   * the date without flipping the boolean).
   */
  vob_submitted_date: string | null;
  /**
   * Custom `Admit_Date` field on Zoho Deals (CONFIRMED.md #20). The Admit
   * metric counts STRICTLY on Admit_Date. Deals with
   * stage_category = closed_won_admitted but null admit_date are NOT
   * counted as admits in headline KPIs (and surface in a data-quality
   * view in Phase 1B).
   */
  admit_date: string | null;
}

// ── Lead-level predicates ──────────────────────────────────────────────────

/**
 * Treatment lead — LOC indicates treatment (not DUI program, not DV program).
 * Per CONFIRMED.md #12, leads with LOC = DUI or DV convert into the
 * DUI - Cash / DV - Cash pipelines and are excluded from the AHCCCS Lead /
 * Commercial Lead classifications. Treatment leads are the only ones that
 * feed the headline funnel.
 */
export function isTreatmentLead(lead: LeadShape): boolean {
  if (lead.level_of_care_requested === null) return true; // missing LOC → assume treatment (default)
  return (TREATMENT_LOC_VALUES as readonly LevelOfCare[]).includes(lead.level_of_care_requested);
}

/** DUI Lead — LOC = DUI. */
export function isDuiLead(lead: LeadShape): boolean {
  return lead.level_of_care_requested === LEVEL_OF_CARE.Dui;
}

/** DV Lead — LOC = DV. */
export function isDvLead(lead: LeadShape): boolean {
  return lead.level_of_care_requested === LEVEL_OF_CARE.Dv;
}

/**
 * AHCCCS Lead: treatment lead with insurance/star pointing to AHCCCS.
 *
 * Precedence rule (CONFIRMED.md #24): insurance type takes precedence over
 * star rating. Star rating is the fallback used only when insurance_type
 * is null. This means a star=3 lead with insurance=Commercial Insurance is
 * a Commercial Lead, NOT an AHCCCS Lead — Cornerstone's payer signal wins.
 *
 * The treatment-lead gate excludes DUI/DV leads even with AHCCCS insurance.
 */
export function isAhcccsLead(lead: LeadShape): boolean {
  if (!isTreatmentLead(lead)) return false;
  if (lead.insurance_type !== null) {
    return (AHCCCS_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  }
  // Fallback: only when insurance is null, star rating drives the bucket.
  return lead.star_rating !== null && AHCCCS_STAR_RATINGS.includes(lead.star_rating);
}

/**
 * Commercial Lead: treatment lead with insurance/star pointing to Commercial.
 *
 * Same precedence rule (CONFIRMED.md #24): insurance type wins. Star is
 * fallback when insurance is null. "Cash" (stored as "Cash Pay") replaces
 * the brief's "Private Pay".
 */
export function isCommercialLead(lead: LeadShape): boolean {
  if (!isTreatmentLead(lead)) return false;
  if (lead.insurance_type !== null) {
    return (COMMERCIAL_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  }
  // Fallback: only when insurance is null, star rating drives the bucket.
  return lead.star_rating !== null && COMMERCIAL_STAR_RATINGS.includes(lead.star_rating);
}

/**
 * Other Payer Lead: treatment lead whose insurance is Medicare / No Insurance /
 * Out of State Medicaid. Per CONFIRMED.md #9, these are reported as their own
 * bucket — neither AHCCCS nor Commercial. Star-based classification is ignored
 * here because the payer signal is the primary driver.
 */
export function isOtherPayerLead(lead: LeadShape): boolean {
  if (!isTreatmentLead(lead)) return false;
  if (lead.insurance_type === null) return false;
  return (OTHER_PAYER_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
}

/**
 * Referral In: a Lead that came in via a known referral source.
 *
 * Rule (CONFIRMED.md #27): `Source_Category = Business Development` OR
 * the `BD_Rep` field on the Lead is set to a specific BD rep name (not
 * null, not the "-None-" / "None" sentinels Zoho uses for empty picklists).
 */
export function isReferralIn(lead: LeadShape): boolean {
  if (lead.source_category === SOURCE_CATEGORY.BusinessDevelopment) return true;
  const bd = lead.bd_rep_inbound;
  if (bd === null) return false;
  const trimmed = bd.trim();
  if (trimmed === "" || trimmed === "-None-" || trimmed === "None") return false;
  return true;
}

// ── Deal-level predicates ──────────────────────────────────────────────────

/** §4 — every Deal is an MQL by virtue of existing. */
export function isMql(_deal: DealShape): boolean {
  return true;
}

/**
 * §5 — Deal has reached VOB at some point.
 * Stage-history-aware version requires Phase 1B to track stage transitions
 * (see OPEN_QUESTION #23). The current-stage proxy below is conservative:
 * any deal whose CURRENT stage is at or past VOB. It misses the (rare) case
 * of a deal that VOBed and was then reset to Stuck Lead.
 */
export function isVobReached(deal: DealShape): boolean {
  return (STAGE_CATEGORIES_AT_OR_PAST_VOB as readonly StageCategory[]).includes(
    deal.stage_category,
  );
}

/**
 * §6 — Admit classifier: stage_category = closed_won_admitted.
 *
 * Note: per CONFIRMED.md #20, the Admit metric counts on Admit_Date strictly.
 * Deals where stage_category = closed_won_admitted but admit_date IS NULL are
 * classified as Admits by `isAdmit` (the classifier is stage-driven), but are
 * EXCLUDED from headline Admit KPIs by `isCountableAdmit` — the metric needs
 * a real Admit_Date to attribute. Phase 1B's data quality view will surface
 * Closed-Admitted-without-Admit_Date deals for triage.
 */
export function isAdmit(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedWonAdmitted;
}

/** Admit that's ready to count — has an Admit_Date set. See CONFIRMED.md #20. */
export function isCountableAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.admit_date !== null;
}

/**
 * VOB submitted — canonical classifier. Per CONFIRMED.md #33, applies in
 * priority order:
 *
 *   1. **Primary:** `vob_submitted` boolean is true.
 *   2. **Primary:** `vob_submitted_date` is non-null. (Specialists sometimes
 *      set the date without flipping the boolean; we honor either.)
 *   3. **Backup:** current `stage_category` is in `STAGE_CATEGORIES_AT_OR_PAST_VOB`
 *      — a deal currently sitting past the VOB step must have had one run.
 *      `closed_lost` is EXCLUDED from this backup because deals can be
 *      lost without ever VOBing (Stuck Lead → Closed Lost without VOB).
 *
 * If none of the three signals fire, the deal is NOT a VOB.
 */
export function isVobSubmitted(deal: DealShape): boolean {
  if (deal.vob_submitted === true) return true;
  if (deal.vob_submitted_date !== null) return true;
  return (STAGE_CATEGORIES_AT_OR_PAST_VOB as readonly StageCategory[]).includes(
    deal.stage_category,
  );
}

/** VOB approved — current stage_category = vob_approved. */
export function isVobApproved(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.VobApproved;
}

/** §7 — Placement: Closed - Referred Out Unattached. Commercial-Cash only. */
export function isPlacement(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedWonReferredOutUnattached;
}

/** §8 — Win: Admit OR Placement. */
export function isWin(deal: DealShape): boolean {
  return isAdmit(deal) || isPlacement(deal);
}

/** §9 — DUI Completion. */
export function isDuiCompletion(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedWonDuiCompletion;
}

/** §10 — Closed Lost. */
export function isClosedLost(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedLost;
}

/** Helper: deal is in a pipeline that counts toward the top-line headline KPIs. */
export function isTopLinePipeline(deal: DealShape): boolean {
  return (TOP_LINE_ADMIT_PIPELINES as readonly Pipeline[]).includes(deal.pipeline);
}

/** Composite: top-line Admit (used by the headline "Admits this month" KPI). */
export function isTopLineAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && isTopLinePipeline(deal);
}

/** Composite: top-line MQL — see OPEN_QUESTION #22 about whether this is the right default. */
export function isTopLineMql(deal: DealShape): boolean {
  return isMql(deal) && isTopLinePipeline(deal);
}

/**
 * Composite: top-line VOB submitted — the headline "VOBs this month" KPI input.
 * Uses the canonical `isVobSubmitted` (field signals first, stage backup
 * second) gated on top-line pipeline.
 */
export function isTopLineVobSubmitted(deal: DealShape): boolean {
  return isVobSubmitted(deal) && isTopLinePipeline(deal);
}

/**
 * Composite: top-line VOB "currently sitting past VOB" — used for live
 * funnel-state views, not headline counts. Stage-only signal.
 */
export function isTopLineVobReached(deal: DealShape): boolean {
  return isVobReached(deal) && isTopLinePipeline(deal);
}

// ── Pipeline-scoped admit aliases (§18) ────────────────────────────────────

export function isCommercialAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.CommercialCash;
}

export function isAhcccsAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.Ahcccs;
}

export function isZocdocAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.Zocdoc;
}

export function isDvAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.DvCash;
}

/** Orthogonal: an Admit attributed to BD sourcing. Used by BD-attribution reporting. */
export function isBdAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.source_category === SOURCE_CATEGORY.BusinessDevelopment;
}

// ── Raw → normalized helpers (used by Phase 1B normalization) ──────────────

/** Map a raw Zoho stage string to its normalized stage category. Returns null if unmapped. */
export function rawStageToCategory(rawStage: string | null | undefined): StageCategory | null {
  if (rawStage == null) return null;
  return RAW_STAGE_TO_CATEGORY[rawStage] ?? null;
}

/** Map a raw Zoho pipeline string to its normalized pipeline. Returns null if unmapped. */
export function rawPipelineToPipeline(rawPipeline: string | null | undefined): Pipeline | null {
  if (rawPipeline == null) return null;
  for (const p of PIPELINE_VALUES) {
    if (RAW_PIPELINE_STRINGS[p] === rawPipeline) return p;
  }
  return null;
}

/** Source category catch-all: anything not BD/ZocDoc → Digital Marketing. */
export function rawSourceToSourceCategory(rawSource: string | null | undefined): SourceCategory {
  if (rawSource === RAW_SOURCE_BUSINESS_DEVELOPMENT) return SOURCE_CATEGORY.BusinessDevelopment;
  if (rawSource === RAW_SOURCE_ZOCDOC) return SOURCE_CATEGORY.Zocdoc;
  return SOURCE_CATEGORY.DigitalMarketing;
}

/** Zoho Profile → RepRole. */
export function profileToRepRole(profileName: string | null | undefined): RepRole {
  if (!profileName) return REP_ROLE.Other;
  if (ADMISSIONS_REP_PROFILES.includes(profileName)) return REP_ROLE.AdmissionsRep;
  if (profileName === BD_REP_PROFILE) return REP_ROLE.BdRep;
  return REP_ROLE.Other;
}
