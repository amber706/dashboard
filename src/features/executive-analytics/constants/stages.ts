// DISPLAY_STAGES — the canonical 8-stage funnel surfaced on the
// analytics dashboard, mapped to Cornerstone's Zoho Deal Stage picklist
// values + per-stage SLA thresholds.
//
// Two columns matter for the kanban + stage-movement views:
//   - source: where to look the records up. "Leads" means Zoho Leads
//     module (pre-conversion inquiries with a Lead_Score). Everything
//     else is Deals (post-conversion treatment opportunities).
//   - zohoStages: the actual Stage picklist values that map here. Some
//     display columns collapse multiple Zoho stages (e.g. Insurance /
//     Verification covers both "VOB Qualifying" and "VOB Approved").
//   - slaDays: target time-in-stage. Once a deal sits longer it gets a
//     warm/risk badge in the UI and counts against the velocity factor
//     of the health score.
//
// Keep this in sync with supabase/functions/_shared/analytics-stages.ts
// (the server-side mirror used by every edge function).

export const DISPLAY_STAGES = [
  {
    key: "newInquiry",
    label: "New Inquiry",
    source: "Leads",
    leadsFilter: "Lead_Score BETWEEN 3 AND 5 AND Converted = false",
    zohoStages: [] as string[],
    slaDays: 1 as number | null,
  },
  // Production Zoho values verified via COQL probe 2026-05-13. Keep
  // in sync with supabase/functions/_shared/analytics-stages.ts.
  {
    key: "contacted",
    label: "Pre-Screen",
    source: "Deals",
    zohoStages: ["Pre Screen - Scheduled", "Pre Screen - Completed"],
    slaDays: 2,
  },
  {
    key: "assessmentScheduled",
    label: "PA Scheduling",
    source: "Deals",
    zohoStages: ["PA - Scheduling/Scheduled"],
    slaDays: 3,
  },
  {
    key: "assessmentCompleted",
    label: "PA Completed",
    source: "Deals",
    zohoStages: ["PA - Completed"],
    slaDays: 2,
  },
  {
    key: "insuranceVerification",
    label: "VOB",
    source: "Deals",
    zohoStages: ["VOB - Qualifying", "VOB - Approved"],
    slaDays: 3,
  },
  {
    key: "admissionScheduled",
    label: "Intake / Direct Admit",
    source: "Deals",
    zohoStages: [
      "Intake Scheduled",
      "Intake Assessment - Scheduled",
      "Direct Admit - Scheduled",
      "Step Down Scheduled",
    ],
    slaDays: 2,
  },
  {
    key: "closedAdmitted",
    label: "Closed-Admitted",
    source: "Deals",
    // Cornerstone's actual stage uses spaces around the hyphen ("Closed
    // - Admitted") in production — verified against real Deal data via
    // COQL probe on 2026-05-13. Both forms accepted defensively so the
    // dashboard still bucket-counts correctly if a future picklist
    // edit changes the spacing.
    zohoStages: ["Closed-Admitted", "Closed - Admitted"],
    slaDays: null as number | null,
  },
  {
    key: "closedLost",
    label: "Closed-Lost",
    source: "Deals",
    // Cornerstone has several Closed - Lost (*) sub-stages. The
    // dashboard buckets all of them under this single Closed-Lost
    // column; loss-reason breakdowns happen via Lost_Reason_Category,
    // not stage parsing.
    zohoStages: [
      "Closed-Lost",
      "Closed - Lost (Treatment)",
      "Closed - Lost (DUI)",
      "Closed - Lost (DV)",
    ],
    slaDays: null,
  },
] as const;

export type StageKey = (typeof DISPLAY_STAGES)[number]["key"];

// Reverse lookup — given a Zoho Stage value, return the StageKey that
// owns it. Used by the kanban builder to drop a deal into the right
// column when COQL returns it. Returns null when a deal's Stage hasn't
// been mapped (e.g. a new picklist value was added in Zoho but not yet
// here) — callers should treat those as "uncategorised" and not crash.
export function stageKeyForZohoStage(zohoStage: string | null | undefined): StageKey | null {
  if (!zohoStage) return null;
  const trimmed = zohoStage.trim();
  for (const s of DISPLAY_STAGES) {
    if (s.zohoStages.includes(trimmed as never)) return s.key;
  }
  return null;
}

// Convenience: list of every Zoho Stage value the analytics surface
// recognises. Useful for COQL `Stage IN (...)` filters that want to
// scope to "anything the analytics dashboard tracks" without hardcoding
// the union in 6 different edge functions.
export const ALL_KNOWN_ZOHO_STAGES: string[] = DISPLAY_STAGES.flatMap(
  (s) => [...s.zohoStages],
);

// Display ordering for the kanban — left-to-right top-of-funnel to
// bottom-of-funnel. Closed-Admitted + Closed-Lost sit at the end as
// terminal columns.
export const KANBAN_ORDER: StageKey[] = DISPLAY_STAGES.map((s) => s.key);

// Stages that are still "active" (i.e. not terminal). Drives the
// "Active pipeline" KPI count and the staleness factor of the health
// score.
export const ACTIVE_STAGES: StageKey[] = DISPLAY_STAGES
  .filter((s) => s.slaDays !== null)
  .map((s) => s.key);

// Preventable loss reasons — Lost_Reason_Category values that count
// toward the "preventable" bucket on the Closed-Lost tab. Exported so
// both the loss heatmap component and the edge function read the same
// list (don't duplicate it).
export const PREVENTABLE_LOSS_CATEGORIES = [
  "Lost contact",
  "No follow-up",
  "Slow response",
  "Internal delay",
  "Insurance verification delay",
] as const;

export type PreventableLossCategory = (typeof PREVENTABLE_LOSS_CATEGORIES)[number];
