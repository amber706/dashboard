// healthScore.ts — pure function that computes the 0-100 Pipeline
// Health Score from a small set of pre-aggregated inputs. Both the
// server (executive-analytics-summary edge function) and the frontend
// (for the Vitest unit test) import this directly so the math has
// exactly one source of truth.
//
// Formula (from the spec):
//
//   score = 0.20 * freshness
//         + 0.20 * velocity
//         + 0.20 * conversion
//         + 0.15 * staleness
//         + 0.15 * followup
//         + 0.10 * lossPressure
//
// Each factor is normalised to 0-100 before weighting; the weights
// sum to 1.0 so the output is always in [0, 100].
//
// Factor definitions (open deals = non-terminal stages):
//
//   freshness     = 100 * (open modified in last 48h) / open
//
//   velocity      = 100 * (1 - (# stages where avg-days > slaDays) /
//                              (# stages considered))
//
//   conversion    = min(100, (admitRate / 0.35) * 100)
//                   — 35% admit rate hits 100; over-target clamps.
//
//   staleness     = 100 - 100 * (open stale per-SLA) / open
//                   — "stale per-SLA" = days_in_stage > stage's slaDays;
//                   uniform >3-day rule was considered but rejected in
//                   favour of per-stage SLA since each stage already
//                   encodes its own pacing expectation.
//
//   followup      = 100 * (open with Next_Follow_Up_Date set) / open
//
//   lossPressure  = period-over-period guardrail. Compare lost in the
//                   current window vs lost in the equal-length prior
//                   window. If current <= prior → no pressure (100).
//                   If current > prior → pressure ramps linearly to 0
//                   when current is 2× prior or more.
//                   Laplace smoothing on the denominator (+1 to both)
//                   avoids divide-by-zero blowups when prior is 0.

export interface HealthScoreInputs {
  openDealsTotal: number;
  openModifiedLast48h: number;
  openStalePerSla: number;
  openWithFollowUp: number;

  // Velocity: count of stages where mean(daysInStage) > slaDays vs total stages considered.
  stagesBreachingSla: number;
  stagesConsidered: number;

  // Conversion (admit rate over the selected range).
  admittedInRange: number;
  totalClosedInRange: number; // admitted + lost in the range

  // Loss pressure (period over period).
  lostInRange: number;
  lostInPriorPeriod: number;

  /** Target admit rate. 0.35 = 35%. */
  targetAdmitRate?: number;
}

export interface HealthScoreFactors {
  freshness: number;
  velocity: number;
  conversion: number;
  staleness: number;
  followup: number;
  lossPressure: number;
}

export interface HealthScoreResult {
  score: number;
  factors: HealthScoreFactors;
  mainRisk: { factor: keyof HealthScoreFactors; value: number };
}

const WEIGHTS: HealthScoreFactors = {
  freshness: 0.20,
  velocity: 0.20,
  conversion: 0.20,
  staleness: 0.15,
  followup: 0.15,
  lossPressure: 0.10,
};

// Clamp helper — every factor sits in [0, 100] before weighting, but
// callers occasionally compute slightly out-of-range values due to
// floating-point noise. Belt-and-suspenders.
function clamp(n: number, min = 0, max = 100): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Safe rate: returns 0 when denominator is 0 instead of NaN/Infinity.
function safeRate(num: number, den: number): number {
  if (den <= 0) return 0;
  return num / den;
}

export function computeHealthScore(input: HealthScoreInputs): HealthScoreResult {
  const targetAdmitRate = input.targetAdmitRate ?? 0.35;

  // When there are no open deals, the pipeline-pace factors are
  // meaningless. Default to neutral (50) for those factors so a
  // brand-new org or a wholly-cleared pipeline doesn't read as
  // catastrophic.
  const noOpenDeals = input.openDealsTotal <= 0;

  const freshness = noOpenDeals
    ? 50
    : clamp(100 * safeRate(input.openModifiedLast48h, input.openDealsTotal));

  const velocity = input.stagesConsidered <= 0
    ? 50
    : clamp(100 * (1 - safeRate(input.stagesBreachingSla, input.stagesConsidered)));

  // Conversion: admit rate normalised to the 35% target. Anything at
  // or above target = 100.
  const admitRate = safeRate(input.admittedInRange, input.totalClosedInRange);
  const conversion = targetAdmitRate <= 0
    ? 0
    : clamp((admitRate / targetAdmitRate) * 100);

  const staleness = noOpenDeals
    ? 50
    : clamp(100 - 100 * safeRate(input.openStalePerSla, input.openDealsTotal));

  const followup = noOpenDeals
    ? 50
    : clamp(100 * safeRate(input.openWithFollowUp, input.openDealsTotal));

  // Period-over-period loss pressure. Laplace smoothing (+1 on both
  // sides) keeps the ratio bounded when prior is zero. Pressure ramps
  // from 100 (current <= prior) down to 0 (current is 2x or more of
  // prior).
  const lossRatio = (input.lostInRange + 1) / (input.lostInPriorPeriod + 1);
  const lossOver = Math.max(0, lossRatio - 1); // 0 when not worsening
  const lossPressure = clamp(100 - lossOver * 100);

  const factors: HealthScoreFactors = {
    freshness,
    velocity,
    conversion,
    staleness,
    followup,
    lossPressure,
  };

  const score = clamp(
    factors.freshness    * WEIGHTS.freshness +
    factors.velocity     * WEIGHTS.velocity +
    factors.conversion   * WEIGHTS.conversion +
    factors.staleness    * WEIGHTS.staleness +
    factors.followup     * WEIGHTS.followup +
    factors.lossPressure * WEIGHTS.lossPressure,
  );

  // mainRisk = the lowest-scoring factor (i.e. the biggest pull-down
  // on overall score). The dashboard surfaces this so the manager
  // knows where to focus first.
  const factorEntries = Object.entries(factors) as Array<[keyof HealthScoreFactors, number]>;
  factorEntries.sort((a, b) => a[1] - b[1]);
  const [riskKey, riskValue] = factorEntries[0];

  return {
    score: Math.round(score * 10) / 10,
    factors,
    mainRisk: { factor: riskKey, value: riskValue },
  };
}

// Re-export the weights so the UI can render the breakdown legend
// with the exact percentages used in the calculation.
export { WEIGHTS as HEALTH_SCORE_WEIGHTS };
