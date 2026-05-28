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
  INSURANCE_TYPE.CommercialInsurance,
  INSURANCE_TYPE.PrivatePay,
  INSURANCE_TYPE.Ahcccs,
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
  star_rating: z.number().int().min(1).max(5).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type LeadRow = z.infer<typeof LeadRowSchema>;

/**
 * Deal row as it lands in the normalized `deals` table. Note that
 * `vob_submitted` is NOT a separate boolean — VOB is derived from
 * `stage_category` (or, ideally, stage history). See METRIC_DEFINITIONS.md §5.
 * `vob_reached_at` is populated by Phase 1B from stage transition history;
 * when null, the deal never reached VOB.
 */
export const DealRowSchema = z.object({
  source_deal_id: z.string().min(1),
  source_lead_id: z.string().min(1).nullable(),
  owner_user_id: z.string().uuid().nullable(),
  pipeline: PipelineEnum,
  stage_raw: z.string().min(1),
  stage_category: StageCategoryEnum,
  vob_reached_at: z.string().datetime({ offset: true }).nullable(),
  level_of_care_requested: LevelOfCareEnum.nullable(),
  level_of_care_admitted: LevelOfCareEnum.nullable(),
  source_category: SourceCategoryEnum,
  created_at: z.string().datetime({ offset: true }),
  closing_date: z.string().date().nullable(),
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
    stage_category_at_or_past: z.literal(STAGE_CATEGORY.VobQualifying),
  }),
  date_field: z.literal("vob_reached_at"),
});

export const AdmitDefinitionSchema = z.object({
  primitive: z.literal("admit"),
  source: z.literal("zoho_crm.deals"),
  rule: z.object({
    stage_category: z.literal(STAGE_CATEGORY.ClosedWonAdmitted),
  }),
  date_field: z.literal("closing_date"),
});

export const PlacementDefinitionSchema = z.object({
  primitive: z.literal("placement"),
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
  // Rule unresolved — see OPEN_QUESTION #15.
  rule: z.object({ pending_open_question: z.literal(15) }),
  date_field: z.literal("created_at"),
});

export const PrimitiveDefinitionSchema = z.discriminatedUnion("primitive", [
  LeadDefinitionSchema,
  MqlDefinitionSchema,
  VobDefinitionSchema,
  AdmitDefinitionSchema,
  PlacementDefinitionSchema,
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
