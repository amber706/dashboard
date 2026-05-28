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
 * Stage categories that imply the deal has reached VOB at some point.
 * Used by `isVobReached` — see METRIC_DEFINITIONS.md §5 and OPEN_QUESTION #23
 * for the stage-history-vs-current-stage caveat.
 */
export const STAGE_CATEGORIES_AT_OR_PAST_VOB: readonly StageCategory[] = Object.freeze([
  STAGE_CATEGORY.VobQualifying,
  STAGE_CATEGORY.VobApproved,
  STAGE_CATEGORY.PreAdmit,
  STAGE_CATEGORY.ReferredOutComingBack,
  STAGE_CATEGORY.ClosedWonAdmitted,
  STAGE_CATEGORY.ClosedWonReferredOutUnattached,
  STAGE_CATEGORY.ClosedLost,
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
// Insurance types (raw Zoho strings — OPEN_QUESTION #4)
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
// Level of Care — pending OPEN_QUESTION #11
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

export const ADMISSIONS_REP_PROFILES: readonly string[] = Object.freeze([
  "Treatment Standard",
  "Admin",
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
  star_rating: number | null;
  insurance_type: InsuranceType | null;
}

export interface DealShape {
  pipeline: Pipeline;
  stage_category: StageCategory;
  source_category: SourceCategory;
}

// ── Lead-level predicates ──────────────────────────────────────────────────

/** §16 — AHCCCS Lead: star=3 OR insurance=AHCCCS */
export function isAhcccsLead(lead: LeadShape): boolean {
  const starMatch = lead.star_rating !== null && AHCCCS_STAR_RATINGS.includes(lead.star_rating);
  const insuranceMatch =
    lead.insurance_type !== null &&
    (AHCCCS_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  return starMatch || insuranceMatch;
}

/** §17 — Commercial Lead: star∈{4,5} OR insurance∈{Commercial Insurance, Private Pay} */
export function isCommercialLead(lead: LeadShape): boolean {
  const starMatch = lead.star_rating !== null && COMMERCIAL_STAR_RATINGS.includes(lead.star_rating);
  const insuranceMatch =
    lead.insurance_type !== null &&
    (COMMERCIAL_INSURANCE_TYPES as readonly InsuranceType[]).includes(lead.insurance_type);
  return starMatch || insuranceMatch;
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

/** §6 — Admit: stage_category = closed_won_admitted. Top-line filter is the caller's job. */
export function isAdmit(deal: DealShape): boolean {
  return deal.stage_category === STAGE_CATEGORY.ClosedWonAdmitted;
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

/** Composite: top-line VOB. */
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
