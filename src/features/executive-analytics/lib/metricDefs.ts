// Metric definitions catalog. Every metric surfaced on the Analytics
// Dashboard has an entry here: a short "what is this" plain-English
// description used in the hover tooltip, plus a longer "how it's
// calculated" string shown when a user clicks the info icon to expand.
//
// Keep `what` to ~1 short sentence. Keep `how` to a tight paragraph
// that names the Zoho field(s), the COQL filter, and the math/edge
// cases. These are read by managers, not engineers — favor "we count
// X where Y" phrasing over implementation jargon.

export interface MetricDef {
  /** Short plain-English label, used as the tooltip title. */
  label: string;
  /** One-sentence description shown on hover. */
  what: string;
  /** Multi-line calculation explanation shown when expanded. */
  how: string;
}

export const METRIC_DEFS = {
  // ── Health Score + factors ───────────────────────────────────────
  healthScore: {
    label: "Pipeline Health Score",
    what: "Single 0–100 score that summarizes overall pipeline health.",
    how:
      "Weighted blend of six factors: freshness (20%), velocity (20%), conversion (20%), staleness (15%), followup (15%), loss-pressure (10%). " +
      "Each factor is normalized to 0–100 and multiplied by its weight. " +
      "Bands: 80+ green, 60–79 yellow, <60 red. Recomputed on every dashboard load — there is no daily snapshot yet.",
  },
  freshness: {
    label: "Freshness",
    what: "How recently the pipeline has seen new inbound activity.",
    how:
      "Count of new Leads + new Deals created in the selected window divided by the count from the equivalent prior window. " +
      "Scaled so 1× prior = 50, 2× prior = 100, half = 25. Higher means the funnel is being fed faster than it used to be.",
  },
  velocity: {
    label: "Velocity",
    what: "How quickly deals are moving through stages.",
    how:
      "Average days-in-stage across all currently-active deals, mapped against each stage's SLA. " +
      "100 = every stage at or under SLA; drops linearly as average days exceed SLA. " +
      "Currently degraded because Zoho's Stage_Modified_Time isn't COQL-queryable — we use Modified_Time as a proxy.",
  },
  conversion: {
    label: "Conversion",
    what: "Share of recently-closed deals that admitted (vs lost).",
    how:
      "Admits in window ÷ (admits + lost) in window × 100. " +
      "Admits use Admit_Date (Stage-agnostic so post-admit transitions still count). " +
      "Lost uses Closing_Date + a Closed-Lost stage. Currently under-reports because Closing_Date is ~60% populated.",
  },
  staleness: {
    label: "Staleness",
    what: "Share of pipeline beyond its stage SLA.",
    how:
      "100 minus the % of active deals where days-in-stage exceeds the stage's SLA. " +
      "Higher is better. " +
      "Today's value (~56) reflects ~44% of pipeline sitting past SLA — that's the headline operational signal.",
  },
  followup: {
    label: "Follow-up",
    what: "Share of active deals that have a future follow-up date set.",
    how:
      "% of active deals with Next_Follow_Up_Date set to a future date. " +
      "Pinned at 100 (neutral) until that Zoho field is created — see the missing-fields banner.",
  },
  lossPressure: {
    label: "Loss pressure",
    what: "Whether recent losses are accelerating vs the prior period.",
    how:
      "Compares Closed-Lost count in the current window vs an equal-length prior window using Laplace-smoothed ratio: (lost+1) ÷ (priorLost+1). " +
      "100 = no pressure, drops to 0 when current is 2× prior or higher. " +
      "Pinned at 100 today because Closing_Date is under-populated.",
  },

  // ── Top-line KPIs ────────────────────────────────────────────────
  activePipeline: {
    label: "Active pipeline",
    what: "Count of open Deals currently in any non-closed stage.",
    how:
      "COQL: Deals WHERE Stage in (active stage set) — every stage except Closed - Admitted and Closed - Lost variants. " +
      "Includes role filter (Admissions / BD / Digital Marketing) when not on 'All'.",
  },
  newLeadsInRange: {
    label: "New leads",
    what: "Leads with Created_Time inside the selected window.",
    how:
      "COQL: Leads WHERE Created_Time between [start] and [end]. " +
      "Window is whatever the date-range selector is set to.",
  },
  newDealsInRange: {
    label: "New deals",
    what: "Deals with Created_Time inside the selected window.",
    how:
      "COQL: Deals WHERE Created_Time between [start] and [end]. Filtered by role lens when applicable.",
  },
  admittedInRange: {
    label: "Admitted",
    what: "Deals whose Admit_Date falls inside the selected window.",
    how:
      "COQL: Deals WHERE Admit_Date between [start] and [end]. " +
      "Stage-agnostic — Cornerstone moves admitted deals to post-admit stages so we don't filter on Stage. " +
      "This is the source-of-truth admit count.",
  },
  lostInRange: {
    label: "Lost",
    what: "Deals that closed lost with Closing_Date inside the window.",
    how:
      "COQL: Deals WHERE Stage in (Closed - Lost variants) AND Closing_Date between [start] and [end]. " +
      "Under-reports today — Closing_Date is set on ~60% of lost deals. " +
      "Recommended Zoho workflow: auto-set Closing_Date when Stage transitions to any Closed-Lost.",
  },

  // ── Live Pipeline ────────────────────────────────────────────────
  kanban: {
    label: "Kanban",
    what: "Open deals bucketed by display stage.",
    how:
      "Every active deal is placed in the column matching its current Stage. " +
      "Risk flag is computed from days-in-stage vs the stage's SLA: under SLA = none, equal = warm, over = risk.",
  },
  byOwner: {
    label: "By owner",
    what: "Active deals grouped by Zoho deal owner.",
    how:
      "Rolls up the active-pipeline rows by Owner.id, then resolves names via the Zoho users API. " +
      "Unassigned deals appear as '(unassigned)'.",
  },
  bySource: {
    label: "By source",
    what: "Active deals grouped by Source_Category.",
    how:
      "Cornerstone has multiple source fields; this view uses Source_Category (the canonical executive-rollup field). " +
      "Other source fields like Digital_Source and Source_Medium are available for deeper marketing analysis.",
  },
  staleCount: {
    label: "Stale",
    what: "Deals whose days-in-stage exceeds the stage SLA.",
    how:
      "Per active deal: days-in-stage = days since Modified_Time (proxy for stage entry). " +
      "Stale = days-in-stage > stage's SLA. Today ~81 of 184 active deals (44%) are stale.",
  },

  // ── Stage Movement ───────────────────────────────────────────────
  stageSlaTable: {
    label: "Stage SLA",
    what: "Per-stage average days-in-stage with breach status.",
    how:
      "For each stage, averages days-in-stage across that stage's active deals. " +
      "Breach badge shows when the average exceeds the stage's SLA. " +
      "Days uses Modified_Time as a proxy; will swap to Stage_Modified_Time when Zoho exposes it to COQL.",
  },
  sla: {
    label: "SLA (Service Level Agreement)",
    what: "The target number of days a deal should spend in a given stage before action is overdue.",
    how:
      "Each pipeline stage has an internal SLA target measured in days, set in code (analytics-stages.ts). " +
      "Examples today: Pre-Screen 2d, PA Scheduling 3d, PA Completed 2d, VOB 3d, Intake/Direct Admit 2d. " +
      "A stage is in 'breach' when its average days-in-stage exceeds the SLA. " +
      "Used to drive the risk flag on kanban cards (under SLA = green, at SLA = warm, over SLA = risk) and the staleness factor in the health score.",
  },
  avgDaysToAdmit: {
    label: "Avg days to admit",
    what: "Per-rep average time from deal creation to admission.",
    how:
      "For each rep, takes every deal admitted in the window and averages (Admit_Date − Created_Time). " +
      "Smaller is better — it's how fast that rep moves a brand-new deal all the way through the funnel to admission. " +
      "Only counts deals where both timestamps are present.",
  },
  agingBuckets: {
    label: "Aging buckets",
    what: "Active deals grouped by days-in-stage band: 0–1, 2–3, 4–7, 8–14, 15+.",
    how:
      "Single in-memory bucketing pass over every active deal using days-in-stage (Modified_Time proxy). " +
      "Useful for spotting where pipeline mass is sitting before stage-level SLA checks fire.",
  },

  // ── Closed-Admitted ──────────────────────────────────────────────
  daysToAdmit: {
    label: "Days to admit",
    what: "Time from deal creation to admission.",
    how:
      "Per admit: Admit_Date − Created_Time, rounded to days. " +
      "We report avg, median, and n (sample size). " +
      "Excludes admits where either timestamp is missing.",
  },
  forecastNext7: {
    label: "Forecast next 7 days",
    what: "Deals with a Scheduled_Intake_Date inside the next 7 days.",
    how: "COQL: Deals WHERE Scheduled_Intake_Date between today and today+7. Role-filtered.",
  },
  admitsBySource: {
    label: "Admits by source",
    what: "Admits in the window grouped by Source_Category.",
    how: "Rollup of admitted rows by Source_Category. Helps see which marketing channel drove admits.",
  },
  admitsByRep: {
    label: "Admits by rep",
    what: "Admits in the window grouped by deal owner.",
    how: "Rollup of admitted rows by Owner.id, resolved to names via the Zoho users API.",
  },
  admitsByProgram: {
    label: "Admits by program",
    what: "Admits in the window grouped by Admitted_Level_of_Care.",
    how: "Rollup of admitted rows by the Admitted_Level_of_Care picklist (PHP, IOP, Inpatient, etc.).",
  },

  // ── Closed-Lost ──────────────────────────────────────────────────
  lossRate: {
    label: "Loss rate",
    what: "Lost ÷ (admits + lost) in the selected window.",
    how:
      "Pure ratio across the window. Both numerator and denominator under-report due to Closing_Date coverage. " +
      "Use directionally, not as an audit number, until the Closing_Date workflow rule is in place.",
  },
  preventable: {
    label: "Preventable losses",
    what: "Losses tagged with a reason flagged 'preventable'.",
    how:
      "Currently 0 — depends on mapping Lost_Reasoning picklist values to a preventable/not bucket. " +
      "Tell me the mapping and I'll wire it in.",
  },
  lossByStage: {
    label: "Loss by stage",
    what: "Lost deals grouped by the Stage they were in when closed lost.",
    how: "Rollup of lost rows by Stage. Surfaces where in the funnel deals tend to die.",
  },
  lossBySource: {
    label: "Loss by source",
    what: "Lost deals grouped by Source_Category.",
    how: "Rollup of lost rows by Source_Category. Pair with admits-by-source to find channels with poor conversion.",
  },
  lossTrend: {
    label: "Loss trend",
    what: "Daily count of Closed-Lost transitions across the window.",
    how:
      "Buckets lost rows by Closing_Date day. " +
      "Line shows raw daily count — no smoothing. Useful for spotting day-of-week patterns and bad weeks.",
  },

  // ── Rep Performance ──────────────────────────────────────────────
  repTable: {
    label: "Rep performance",
    what: "Per-rep volume / admits / lost / active / conversion.",
    how:
      "Per deal owner: volume = deals created in window; admits = admits in window; lost = lost in window; " +
      "active = current active pipeline; conversion% = admits ÷ (admits + lost). " +
      "Hidden for Digital Marketing role since the rep concept doesn't apply.",
  },
} as const;

export type MetricKey = keyof typeof METRIC_DEFS;
