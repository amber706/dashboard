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
 * Read `docs/METRIC_DEFINITIONS.md` before editing.
 */

// ────────────────────────────────────────────────────────────────────────────
// Pipelines
// ────────────────────────────────────────────────────────────────────────────

export const PIPELINE = {
  CommercialCash: "commercial_cash",
  Ahcccs: "ahcccs",
  Dui: "dui",
  Zocdoc: "zocdoc",
} as const;

export type Pipeline = (typeof PIPELINE)[keyof typeof PIPELINE];

export const PIPELINE_VALUES: readonly Pipeline[] = Object.freeze([
  PIPELINE.CommercialCash,
  PIPELINE.Ahcccs,
  PIPELINE.Dui,
  PIPELINE.Zocdoc,
]);

// ────────────────────────────────────────────────────────────────────────────
// Stage categories (the normalized rollup of every raw Zoho stage string)
// ────────────────────────────────────────────────────────────────────────────

export const STAGE_CATEGORY = {
  InProgress: "in_progress",
  Mql: "mql",
  VobSubmitted: "vob_submitted",
  ClosedWon: "closed_won",
  ClosedLostReferredOut: "closed_lost_referred_out",
  ClosedLostOther: "closed_lost_other",
} as const;

export type StageCategory = (typeof STAGE_CATEGORY)[keyof typeof STAGE_CATEGORY];

export const STAGE_CATEGORY_VALUES: readonly StageCategory[] = Object.freeze([
  STAGE_CATEGORY.InProgress,
  STAGE_CATEGORY.Mql,
  STAGE_CATEGORY.VobSubmitted,
  STAGE_CATEGORY.ClosedWon,
  STAGE_CATEGORY.ClosedLostReferredOut,
  STAGE_CATEGORY.ClosedLostOther,
]);

/**
 * Raw Zoho stage strings that are each Referred Out variants.
 * See OPEN_QUESTION #1 — these strings must be confirmed verbatim against Zoho.
 */
export const REFERRED_OUT_STAGE_STRINGS: readonly string[] = Object.freeze([
  "Closed Lost - Referred Out",
  "Closed Lost - Referred out Unattached",
  "Referred out coming back",
]);

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

/**
 * Raw Zoho source-category strings that resolve to BD or ZocDoc explicitly.
 * Every other raw source value rolls up to digital_marketing per §10 of the
 * metric definitions doc. The catch-all-into-digital rule is intentional.
 */
export const RAW_SOURCE_BUSINESS_DEVELOPMENT = "Business Development";
export const RAW_SOURCE_ZOCDOC = "ZocDoc";

// ────────────────────────────────────────────────────────────────────────────
// Insurance types (raw Zoho strings — confirm in OPEN_QUESTION #4)
// ────────────────────────────────────────────────────────────────────────────

export const INSURANCE_TYPE = {
  CommercialInsurance: "Commercial Insurance",
  PrivatePay: "Private Pay",
  Ahcccs: "AHCCCS",
} as const;

export type InsuranceType = (typeof INSURANCE_TYPE)[keyof typeof INSURANCE_TYPE];

export const COMMERCIAL_INSURANCE_TYPES: readonly InsuranceType[] = Object.freeze([
  INSURANCE_TYPE.CommercialInsurance,
  INSURANCE_TYPE.PrivatePay,
]);

export const AHCCCS_INSURANCE_TYPES: readonly InsuranceType[] = Object.freeze([
  INSURANCE_TYPE.Ahcccs,
]);

// ────────────────────────────────────────────────────────────────────────────
// Star rating thresholds (OPEN_QUESTION #5 — field name still TBD)
// ────────────────────────────────────────────────────────────────────────────

export const AHCCCS_STAR_RATINGS: readonly number[] = Object.freeze([3]);
export const COMMERCIAL_STAR_RATINGS: readonly number[] = Object.freeze([4, 5]);

// ────────────────────────────────────────────────────────────────────────────
// Level of Care
// ────────────────────────────────────────────────────────────────────────────
// Draft set — to be locked via OPEN_QUESTION #11 before 1B.
// Values are ASAM-aligned and Cornerstone-typical. Every raw Zoho LOC string
// will be mapped to one of these via Phase 1B's loc_mapping table.
// ────────────────────────────────────────────────────────────────────────────

export const LEVEL_OF_CARE = {
  Detox: "detox",
  Residential: "residential",
  Php: "php",
  Iop: "iop",
  Op: "op",
  SoberLiving: "sober_living",
} as const;

export type LevelOfCare = (typeof LEVEL_OF_CARE)[keyof typeof LEVEL_OF_CARE];

export const LEVEL_OF_CARE_VALUES: readonly LevelOfCare[] = Object.freeze([
  LEVEL_OF_CARE.Detox,
  LEVEL_OF_CARE.Residential,
  LEVEL_OF_CARE.Php,
  LEVEL_OF_CARE.Iop,
  LEVEL_OF_CARE.Op,
  LEVEL_OF_CARE.SoberLiving,
]);

// ────────────────────────────────────────────────────────────────────────────
// Rep roles (derived from Zoho Profile — see OPEN_QUESTION #6)
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
 * OPEN_QUESTION #6 — verify these strings against Zoho CRM Profiles.
 */
export const ADMISSIONS_REP_PROFILES: readonly string[] = Object.freeze([
  "Treatment Standard",
  "Admin",
]);

/**
 * Zoho Profile name that classifies a User as a BD Rep.
 * OPEN_QUESTION #6 — verify against Zoho.
 */
export const BD_REP_PROFILE = "Business Development";

// ────────────────────────────────────────────────────────────────────────────
// Marketing channels (= surface label for Source Category in filter UI)
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

/** SourceCategory → MarketingChannel — used by the FilterBar marketing-channel filter. */
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
// Time range presets — drives the Time filter component in Phase 1C
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
// These functions encode the *boolean rules* in METRIC_DEFINITIONS.md. They
// are the unit of test in definitions.test.ts and the building blocks of the
// Phase 1B normalization pipeline. Each predicate takes the minimum shape of
// fields required to make the call — see schemas.ts for the Zod equivalents.
// ────────────────────────────────────────────────────────────────────────────

export interface LeadShape {
  star_rating: number | null;
  insurance_type: InsuranceType | null;
}

export interface DealShape {
  pipeline: Pipeline;
  stage_category: StageCategory;
  vob_submitted: boolean;
  source_category: SourceCategory;
}

/** §12 — AHCCCS Lead: star=3 OR insurance=AHCCCS */
export function isAhcccsLead(lead: LeadShape): boolean {
  const starMatch = lead.star_rating !== null && AHCCCS_STAR_RATINGS.includes(lead.star_rating);
  const insuranceMatch =
    lead.insurance_type !== null &&
    (AHCCCS_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  return starMatch || insuranceMatch;
}

/** §13 — Commercial Lead: star∈{4,5} OR insurance∈{Commercial Insurance, Private Pay} */
export function isCommercialLead(lead: LeadShape): boolean {
  const starMatch = lead.star_rating !== null && COMMERCIAL_STAR_RATINGS.includes(lead.star_rating);
  const insuranceMatch =
    lead.insurance_type !== null &&
    (COMMERCIAL_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  return starMatch || insuranceMatch;
}

/** §2 — every Deal is an MQL by virtue of existing in the sales pipeline. */
export function isMql(_deal: DealShape): boolean {
  return true;
}

/** §3 — VOB: vob_submitted flag is true. */
export function isVob(deal: DealShape): boolean {
  return deal.vob_submitted === true;
}

/** §4 — Admit: stage_category = closed_won. */
export function isAdmit(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedWon;
}

/** §5 — Closed Lost: stage_category ∈ {closed_lost_referred_out, closed_lost_other}. */
export function isClosedLost(deal: DealShape): boolean {
  return (
    deal.stage_category === STAGE_CATEGORY.ClosedLostReferredOut ||
    deal.stage_category === STAGE_CATEGORY.ClosedLostOther
  );
}

/** §7 — Referred Out: stage_category = closed_lost_referred_out. */
export function isReferredOut(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedLostReferredOut;
}

/** §14 — AHCCCS Admit. */
export function isAhcccsAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.Ahcccs;
}

/** §15 — Commercial Admit. (DUI and ZocDoc admits are NOT commercial — see OPEN_QUESTION #8.) */
export function isCommercialAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.pipeline === PIPELINE.CommercialCash;
}

/** §10 — BD-sourced Admit (orthogonal to pipeline). */
export function isBdAdmit(deal: DealShape): boolean {
  return isAdmit(deal) && deal.source_category === SOURCE_CATEGORY.BusinessDevelopment;
}

/** Raw-stage helper used by stage_mapping during normalization. */
export function isRawStageReferredOut(rawStage: string): boolean {
  return REFERRED_OUT_STAGE_STRINGS.includes(rawStage);
}

/** Raw source-string helper used by source_category_mapping during normalization. */
export function rawSourceToSourceCategory(rawSource: string | null | undefined): SourceCategory {
  if (rawSource === RAW_SOURCE_BUSINESS_DEVELOPMENT) return SOURCE_CATEGORY.BusinessDevelopment;
  if (rawSource === RAW_SOURCE_ZOCDOC) return SOURCE_CATEGORY.Zocdoc;
  return SOURCE_CATEGORY.DigitalMarketing;
}

/** Zoho Profile → RepRole — used during user normalization. */
export function profileToRepRole(profileName: string | null | undefined): RepRole {
  if (!profileName) return REP_ROLE.Other;
  if (ADMISSIONS_REP_PROFILES.includes(profileName)) return REP_ROLE.AdmissionsRep;
  if (profileName === BD_REP_PROFILE) return REP_ROLE.BdRep;
  return REP_ROLE.Other;
}
