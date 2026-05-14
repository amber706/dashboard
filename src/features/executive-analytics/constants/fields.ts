// fields.ts — single source of truth for the Zoho field API names the
// analytics dashboard relies on. Every edge function + every frontend
// SELECT references these constants instead of repeating string
// literals, so a Zoho rename / API-name change has exactly one place
// to update.
//
// Two flavours:
//   DEAL_FIELDS — Deals module (the primary pipeline)
//   LEAD_FIELDS — Leads module (only used for the New Inquiry column)
//
// If any of these custom fields haven't been created yet in Cornerstone's
// Zoho instance, the affected edge function returns a soft-fail with
// `{ ok: true, missing_fields: ["Field_Api_Name"] }` and the matching
// panel renders a yellow "Field missing" card instead of crashing.

export const DEAL_FIELDS = {
  // System / built-in.
  id: "id",
  dealName: "Deal_Name",
  stage: "Stage",
  ownerId: "Owner.id",
  ownerName: "Owner.full_name",
  createdTime: "Created_Time",
  modifiedTime: "Modified_Time",
  closingDate: "Closing_Date",

  // Source attribution.
  originalSource: "Original_Source",
  referralSourceDetail: "Referral_Source_Detail",

  // Stage history (custom).
  currentStageEntryDate: "Current_Stage_Entry_Date",
  previousStage: "Previous_Stage",
  lastStageChangeDate: "Last_Stage_Change_Date",
  stageChangeCount: "Stage_Change_Count",
  daysInCurrentStage: "Days_in_Current_Stage",

  // Close fields.
  closeReason: "Close_Reason",
  lostReasonCategory: "Lost_Reason_Category",
  lostReasonNotes: "Lost_Reason_Notes",

  // Admission timing.
  admissionDate: "Admission_Date",
  projectedAdmissionDate: "Projected_Admission_Date",

  // Role / ownership.
  pipelineOwner: "Pipeline_Owner",
  roleOwnerType: "Role_Owner_Type",

  // Activity / follow-up.
  nextFollowUpDate: "Next_Follow_Up_Date",
  lastMeaningfulContactDate: "Last_Meaningful_Contact_Date",

  // Service / clinical.
  insuranceStatus: "Insurance_Status",
  levelOfCare: "Level_of_Care",
  program: "Program",

  // Lead scoring (used in dashboards but set via the wrap-up flow).
  leadScoreRating: "Lead_Score_Rating",
  leadScoreExplanation: "Lead_Score_Explanation",
} as const;

export const LEAD_FIELDS = {
  id: "id",
  firstName: "First_Name",
  lastName: "Last_Name",
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  leadStatus: "Lead_Status",
  leadSource: "Lead_Source",
  leadScore: "Lead_Score",
  converted: "Converted",
  ownerId: "Owner.id",
  createdTime: "Created_Time",
  modifiedTime: "Modified_Time",
} as const;

// Convenience: the standard SELECT field list for analytics-grade Deal
// reads. Edge functions usually copy this verbatim and only override
// when a query needs additional fields. Order matters for COQL
// readability (system fields first, then attribution, then stage
// history, then activity).
export const DEAL_ANALYTICS_SELECT = [
  DEAL_FIELDS.id, DEAL_FIELDS.dealName, DEAL_FIELDS.stage,
  DEAL_FIELDS.ownerId,
  DEAL_FIELDS.createdTime, DEAL_FIELDS.modifiedTime, DEAL_FIELDS.closingDate,
  DEAL_FIELDS.originalSource, DEAL_FIELDS.referralSourceDetail,
  DEAL_FIELDS.currentStageEntryDate, DEAL_FIELDS.previousStage,
  DEAL_FIELDS.lastStageChangeDate, DEAL_FIELDS.stageChangeCount,
  DEAL_FIELDS.daysInCurrentStage,
  DEAL_FIELDS.closeReason, DEAL_FIELDS.lostReasonCategory,
  DEAL_FIELDS.admissionDate, DEAL_FIELDS.projectedAdmissionDate,
  DEAL_FIELDS.roleOwnerType,
  DEAL_FIELDS.nextFollowUpDate, DEAL_FIELDS.lastMeaningfulContactDate,
  DEAL_FIELDS.insuranceStatus, DEAL_FIELDS.levelOfCare,
].join(", ");

// Marketing-source picklist values that count as "Digital Marketing"
// ownership for role filtering. Used in both Deals (Original_Source)
// and Leads (Lead_Source) queries — keep this list authoritative.
export const DIGITAL_MARKETING_SOURCES = [
  "Paid Search",
  "Organic Search",
  "Social",
  "Display",
  "Email Campaign",
] as const;
