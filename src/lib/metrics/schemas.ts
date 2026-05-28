/**
 * Zod schemas for every reporting primitive defined in `definitions.ts`.
 *
 * Two purposes:
 *   1. Runtime validation at every system boundary (sync jobs, API responses,
 *      filter URLs) — fail loudly if a string drifts off the canonical set.
 *   2. The `FilterContractSchema` is the contract surface between the metric
 *      resolver (backend) and the FilterBar (frontend). Both sides parse
 *      filter input through the same Zod schema so the shapes can never
 *      drift apart.
 */

import { z } from "zod";

import {
  AHCCCS_STAR_RATINGS,
  COMMERCIAL_STAR_RATINGS,
  INSURANCE_TYPE,
  LEVEL_OF_CARE_VALUES,
  MARKETING_CHANNEL_VALUES,
  PIPELINE_VALUES,
  REP_ROLE_VALUES,
  SOURCE_CATEGORY_VALUES,
  STAGE_CATEGORY,
  STAGE_CATEGORY_VALUES,
  TIME_RANGE_PRESET,
  TIME_RANGE_PRESET_VALUES,
} from "./definitions";

// ────────────────────────────────────────────────────────────────────────────
// Primitive enums — narrowed from the const tuples in definitions.ts.
// ────────────────────────────────────────────────────────────────────────────

export const PipelineEnum = z.enum(PIPELINE_VALUES as unknown as [string, ...string[]]);
export type PipelineZ = z.infer<typeof PipelineEnum>;

export const StageCategoryEnum = z.enum(
  STAGE_CATEGORY_VALUES as unknown as [string, ...string[]],
);
export type StageCategoryZ = z.infer<typeof StageCategoryEnum>;

export const SourceCategoryEnum = z.enum(
  SOURCE_CATEGORY_VALUES as unknown as [string, ...string[]],
);
export type SourceCategoryZ = z.infer<typeof SourceCategoryEnum>;

export const LevelOfCareEnum = z.enum(LEVEL_OF_CARE_VALUES as unknown as [string, ...string[]]);
export type LevelOfCareZ = z.infer<typeof LevelOfCareEnum>;

export const RepRoleEnum = z.enum(REP_ROLE_VALUES as unknown as [string, ...string[]]);
export type RepRoleZ = z.infer<typeof RepRoleEnum>;

export const MarketingChannelEnum = z.enum(
  MARKETING_CHANNEL_VALUES as unknown as [string, ...string[]],
);
export type MarketingChannelZ = z.infer<typeof MarketingChannelEnum>;

export const InsuranceTypeEnum = z.enum([
  INSURANCE_TYPE.Ahcccs,
  INSURANCE_TYPE.CommercialInsurance,
  INSURANCE_TYPE.Cash,
  INSURANCE_TYPE.Medicare,
  INSURANCE_TYPE.NoInsurance,
  INSURANCE_TYPE.OutOfStateMedicaid,
] as const);
export type InsuranceTypeZ = z.infer<typeof InsuranceTypeEnum>;

export const TimeRangePresetEnum = z.enum(
  TIME_RANGE_PRESET_VALUES as unknown as [string, ...string[]],
);
export type TimeRangePresetZ = z.infer<typeof TimeRangePresetEnum>;

// ────────────────────────────────────────────────────────────────────────────
// Lead / Deal row shapes (used by the normalization layer in Phase 1B).
// ────────────────────────────────────────────────────────────────────────────

export const LeadRowSchema = z.object({
  source_lead_id: z.string().min(1),
  owner_user_id: z.string().uuid().nullable(),
  source_category: SourceCategoryEnum,
  level_of_care_requested: LevelOfCareEnum.nullable(),
  insurance_type: InsuranceTypeEnum.nullable(),
  /** Raw Zoho `Lead Score Rating` picklist value (e.g. "⭐⭐⭐ Seeking Treatment: Medicaid"). */
  lead_score_rating: z.string().nullable(),
  /** Derived star count (0-5), parsed from `lead_score_rating` via `leadScoreRatingToStarCount`. */
  star_rating: z.number().int().min(0).max(5).nullable(),
  /** Zoho `BD_Rep` Lead picklist value; used by `isReferralIn`. */
  bd_rep_inbound: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type LeadRow = z.infer<typeof LeadRowSchema>;

/**
 * Deal row as it lands in the normalized `deals` table.
 *
 * Per CONFIRMED.md #19, VOB has two signals captured here:
 *   - `vob_submitted` (Zoho custom boolean `VOB_Submitted`)
 *   - `vob_submitted_date` (Zoho custom date `VOB_Submitted_Date`)
 * Plus current stage_category in {vob_qualifying, vob_approved} reflects
 * the current VOB status. The boolean answers "ever submitted?"; the
 * stage answers "current status?".
 *
 * Per CONFIRMED.md #20, the Admit metric counts on `admit_date` strictly.
 * `closing_date` is informational for non-admit closings.
 *
 * Per CONFIRMED.md #21, both `level_of_care_requested` and
 * `admitted_level_of_care` exist as Deal fields. The Admit metric uses
 * the latter; pre-admit metrics use the former.
 */
export const DealRowSchema = z.object({
  source_deal_id: z.string().min(1),
  source_lead_id: z.string().min(1).nullable(),
  owner_user_id: z.string().uuid().nullable(),
  pipeline: PipelineEnum,
  stage_raw: z.string().min(1),
  stage_category: StageCategoryEnum,
  vob_submitted: z.boolean(),
  vob_submitted_date: z.string().date().nullable(),
  level_of_care_requested: LevelOfCareEnum.nullable(),
  admitted_level_of_care: LevelOfCareEnum.nullable(),
  source_category: SourceCategoryEnum,
  created_at: z.string().datetime({ offset: true }),
  closing_date: z.string().date().nullable(),
  admit_date: z.string().date().nullable(),
  /**
   * Closed Lost reason — populated only when `stage_category = closed_lost`.
   * Sourced per-pipeline from the relevant custom field (CONFIRMED.md #35):
   *   - Treatment closed-lost → `Lost_Reasoning` (45-value picklist)
   *   - DUI closed-lost       → `Close_Reasoning_DUI` (Lost to Competition,
   *                             Non-Responsive, Referred Out, Sold - Screening,
   *                             Unmet Financial Responsibility, Unqualified)
   *   - DV closed-lost        → (currently no dedicated field — TODO)
   *   - Generic fallback      → `Reason_For_Loss__s` (10-value Zoho system field)
   * Phase 1B's sync writes the per-pipeline value here so the dashboard can
   * break down closed lost by reason.
   */
  closed_lost_reason: z.string().nullable(),
  /**
   * Refer Out Type — sourced from Zoho `Refer_Out_Type` custom picklist.
   * 6 values: {Detox, Residential, Psych} × {Attached, Unattached}.
   * Populated only when the deal closed via the Closed - Referred Out
   * Unattached stage. See CONFIRMED.md #36 (pending refer-outs rename).
   */
  refer_out_type: z.string().nullable(),
});
export type DealRow = z.infer<typeof DealRowSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Per-primitive "definition" schemas.
// Describe the boolean rule for each primitive declaratively, so the
// Phase 1B build job can serialize them and the verifier can replay them.
// ────────────────────────────────────────────────────────────────────────────

export const LeadDefinitionSchema = z.object({
  primitive: z.literal("lead"),
  source: z.literal("zoho_analytics.leads"),
  date_field: z.literal("created_at"),
});

export const MqlDefinitionSchema = z.object({
  primitive: z.literal("mql"),
  source: z.literal("zoho_crm.deals"),
  date_field: z.literal("created_at"),
});

export const VobDefinitionSchema = z.object({
  primitive: z.literal("vob"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    // Per CONFIRMED.md #33, the canonical VOB classifier uses a priority chain:
    //   1. vob_submitted boolean is true
    //   2. vob_submitted_date is non-null
    //   3. stage_category in STAGE_CATEGORIES_AT_OR_PAST_VOB (closed_lost excluded)
    // Encoded as `any_of` so the resolver knows it's an OR-of-signals rule.
    any_of: z.tuple([
      z.literal("vob_submitted_eq_true"),
      z.literal("vob_submitted_date_not_null"),
      z.literal("stage_category_at_or_past_vob"),
    ]),
  }),
  date_field: z.literal("vob_submitted_date"),
});

export const AdmitDefinitionSchema = z.object({
  primitive: z.literal("admit"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    // CONFIRMED.md #34 — Admit uses priority chain (same shape as VOB):
    //   1. admit_date is not null, OR
    //   2. stage_category = closed_won_admitted
    any_of: z.tuple([
      z.literal("admit_date_not_null"),
      z.literal("stage_category_eq_closed_won_admitted"),
    ]),
  }),
  date_field: z.literal("admit_date_or_closing_date"),
});

export const ReferredOutClosedDefinitionSchema = z.object({
  primitive: z.literal("referred_out_closed"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    stage_category: z.literal(STAGE_CATEGORY.ClosedWonReferredOutUnattached),
  }),
  date_field: z.literal("closing_date"),
});

export const WinDefinitionSchema = z.object({
  primitive: z.literal("win"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    stage_category_any_of: z.tuple([
      z.literal(STAGE_CATEGORY.ClosedWonAdmitted),
      z.literal(STAGE_CATEGORY.ClosedWonReferredOutUnattached),
    ]),
  }),
  date_field: z.literal("closing_date"),
});

export const DuiCompletionDefinitionSchema = z.object({
  primitive: z.literal("dui_completion"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    stage_category: z.literal(STAGE_CATEGORY.ClosedWonDuiCompletion),
  }),
  date_field: z.literal("closing_date"),
});

export const ClosedLostDefinitionSchema = z.object({
  primitive: z.literal("closed_lost"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    stage_category: z.literal(STAGE_CATEGORY.ClosedLost),
  }),
  date_field: z.literal("closing_date"),
});

export const ReferralInDefinitionSchema = z.object({
  primitive: z.literal("referral_in"),
  source: z.literal("zoho_analytics.leads"),
  rule: z.object({
    // CONFIRMED.md #27: source_category=business_development OR bd_rep_inbound is set.
    source_category_or_bd_rep_set: z.literal(true),
  }),
  date_field: z.literal("created_at"),
});

export const PrimitiveDefinitionSchema = z.discriminatedUnion("primitive", [
  LeadDefinitionSchema,
  MqlDefinitionSchema,
  VobDefinitionSchema,
  AdmitDefinitionSchema,
  ReferredOutClosedDefinitionSchema,
  WinDefinitionSchema,
  DuiCompletionDefinitionSchema,
  ClosedLostDefinitionSchema,
  ReferralInDefinitionSchema,
]);
export type PrimitiveDefinition = z.infer<typeof PrimitiveDefinitionSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Filter contract — used by both the resolver and the FilterBar.
// ────────────────────────────────────────────────────────────────────────────

const IsoDate = z.string().date();

const CustomTimeRange = z
  .object({
    preset: z.literal(TIME_RANGE_PRESET.Custom),
    start: IsoDate,
    end: IsoDate,
  })
  .refine((v) => v.start <= v.end, {
    message: "Custom range: start must be on or before end",
  });

const PresetTimeRange = z.object({
  preset: z.enum(
    TIME_RANGE_PRESET_VALUES.filter((v) => v !== TIME_RANGE_PRESET.Custom) as unknown as [
      string,
      ...string[],
    ],
  ),
});

export const TimeRangeSchema = z.union([CustomTimeRange, PresetTimeRange]);
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const FilterContractSchema = z.object({
  time: TimeRangeSchema,
  level_of_care: z.array(LevelOfCareEnum).default([]),
  pipeline: z.array(PipelineEnum).default([]),
  marketing_channel: z.array(MarketingChannelEnum).default([]),
  sales_rep: z.array(z.string().uuid()).default([]),
});

export type FilterContract = z.infer<typeof FilterContractSchema>;

/** Default filter applied by every chart on first load. */
export const DEFAULT_FILTER: FilterContract = {
  time: { preset: TIME_RANGE_PRESET.ThisMonth },
  level_of_care: [],
  pipeline: [],
  marketing_channel: [],
  sales_rep: [],
};

// ────────────────────────────────────────────────────────────────────────────
// Compile-time guard: numerical thresholds must remain pinned to the doc.
// ────────────────────────────────────────────────────────────────────────────

const _pinnedStarRatings = {
  ahcccs: AHCCCS_STAR_RATINGS,
  commercial: COMMERCIAL_STAR_RATINGS,
} satisfies { ahcccs: readonly number[]; commercial: readonly number[] };
void _pinnedStarRatings;
