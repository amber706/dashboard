// Zoho Leads-module picklist values pulled directly from Cornerstone's
// Zoho org via getFields. Keep these in sync if Zoho admin changes the
// picklist — values must match exactly or Zoho silently drops the field.

// Zoho field: Lead_Status (label "Interaction Status").
export const LEAD_STATUS_PICKLIST: string[] = [
  ">5 Outreach Attempts Made, No Contact",
  "Client Care Call/HR/Admin",
  "Contacted",
  "DUI - Service Not Offered",
  "Hang Up",
  "Junk Lead",
  "Lost Lead",
  "Not Contacted",
  "Potential: Still Assessing/Info Missing",
  "Pre Qualified",
  "Qualified Lead: Moving to Pipeline",
  "Contact in Future",
  "Requested No Further Contact",
  "Attempted to Contact",
  "Not Qualified",
];

// Zoho field: Lead_Score_Rating.
export const LEAD_SCORE_RATING_PICKLIST: string[] = [
  "⭐ Has no substance issue at all",
  "⭐⭐ Has substance abuse but little intention of entering treatment",
  "⭐⭐⭐ Mentions substance abuse but unable to pay or isn't within proximity",
  "⭐⭐⭐⭐ Has substance and intention to seek help but there are clear objections",
  "⭐⭐⭐⭐⭐ Ideal Candidate - Has substance abuse and is seeking help",
  "Unable To Score/Never Made Contact",
];

// Zoho field: CTM_Score (1-5 rating used for per-call manual rating).
export const CTM_SCORE_PICKLIST: string[] = ["1", "2", "3", "4", "5"];

// Zoho field: Level_of_Care_Requested. The Cornerstone "program interest"
// concept maps directly to this Zoho picklist. Values must match exactly.
export const LEVEL_OF_CARE_PICKLIST: string[] = [
  "BHRF",
  "PHP",
  "IOP5",
  "IOP3",
  "VIOP",
  "VIOP Adolescent",
  "VOP",
  "VOP Adult",
  "VOP Adolescent",
  "OP",
  "Detox",
  "DUI",
  "DV",
];
