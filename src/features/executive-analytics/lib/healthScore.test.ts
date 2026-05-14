// healthScore.test.ts — verifies the pipeline health score math
// against hand-computed samples. The Vitest suite is the canonical
// regression net for the formula; if these tests pass, the edge
// function and the frontend agree on every factor.

import { describe, it, expect } from "vitest";
import { computeHealthScore, HEALTH_SCORE_WEIGHTS } from "./healthScore";

describe("computeHealthScore", () => {
  it("returns 100 when every factor is at ceiling", () => {
    const r = computeHealthScore({
      openDealsTotal: 10,
      openModifiedLast48h: 10,
      openStalePerSla: 0,
      openWithFollowUp: 10,
      stagesBreachingSla: 0,
      stagesConsidered: 6,
      admittedInRange: 7,
      totalClosedInRange: 20, // 35% admit rate exactly = target
      lostInRange: 5,
      lostInPriorPeriod: 5,    // equal → no pressure
    });
    expect(r.score).toBeCloseTo(100, 1);
    expect(r.factors.freshness).toBe(100);
    expect(r.factors.staleness).toBe(100);
    expect(r.factors.followup).toBe(100);
    expect(r.factors.velocity).toBe(100);
    expect(r.factors.conversion).toBeCloseTo(100, 1);
    expect(r.factors.lossPressure).toBe(100);
  });

  it("returns 0 when every factor bottoms out", () => {
    const r = computeHealthScore({
      openDealsTotal: 10,
      openModifiedLast48h: 0,   // freshness = 0
      openStalePerSla: 10,      // staleness = 0
      openWithFollowUp: 0,      // followup = 0
      stagesBreachingSla: 6,    // velocity = 0
      stagesConsidered: 6,
      admittedInRange: 0,       // conversion = 0
      totalClosedInRange: 20,
      lostInRange: 100,         // 2x prior → lossPressure = 0
      lostInPriorPeriod: 49,    // (100+1)/(49+1) = 2.02 → over=1.02 → 0
    });
    expect(r.score).toBeCloseTo(0, 1);
    expect(r.factors.lossPressure).toBeCloseTo(0, 1);
  });

  it("conversion clamps to 100 when admit rate exceeds target", () => {
    const r = computeHealthScore({
      openDealsTotal: 10,
      openModifiedLast48h: 5,
      openStalePerSla: 0,
      openWithFollowUp: 5,
      stagesBreachingSla: 0,
      stagesConsidered: 6,
      admittedInRange: 18,         // 90% admit rate (way above 35%)
      totalClosedInRange: 20,
      lostInRange: 2,
      lostInPriorPeriod: 2,
    });
    expect(r.factors.conversion).toBe(100);
  });

  it("conversion is proportional below target", () => {
    // 17.5% admit rate is exactly half of the 35% target → conversion = 50.
    const r = computeHealthScore({
      openDealsTotal: 10,
      openModifiedLast48h: 5,
      openStalePerSla: 0,
      openWithFollowUp: 5,
      stagesBreachingSla: 0,
      stagesConsidered: 6,
      admittedInRange: 35,
      totalClosedInRange: 200,    // 17.5%
      lostInRange: 0,
      lostInPriorPeriod: 0,
    });
    expect(r.factors.conversion).toBeCloseTo(50, 1);
  });

  it("loss pressure handles prior=0 without blowing up", () => {
    // Laplace smoothing: ratio = (5+1) / (0+1) = 6, over = 5, pressure
    // = max(0, 100 - 500) = 0. New losses with no prior baseline read
    // as high pressure rather than NaN.
    const r = computeHealthScore({
      openDealsTotal: 5,
      openModifiedLast48h: 5,
      openStalePerSla: 0,
      openWithFollowUp: 5,
      stagesBreachingSla: 0,
      stagesConsidered: 6,
      admittedInRange: 10,
      totalClosedInRange: 30,
      lostInRange: 5,
      lostInPriorPeriod: 0,
    });
    expect(Number.isFinite(r.factors.lossPressure)).toBe(true);
    expect(r.factors.lossPressure).toBe(0);
  });

  it("loss pressure stays at 100 when current equals or is below prior", () => {
    const equal = computeHealthScore({
      openDealsTotal: 5, openModifiedLast48h: 5, openStalePerSla: 0, openWithFollowUp: 5,
      stagesBreachingSla: 0, stagesConsidered: 6, admittedInRange: 10, totalClosedInRange: 30,
      lostInRange: 8, lostInPriorPeriod: 8,
    });
    const below = computeHealthScore({
      openDealsTotal: 5, openModifiedLast48h: 5, openStalePerSla: 0, openWithFollowUp: 5,
      stagesBreachingSla: 0, stagesConsidered: 6, admittedInRange: 10, totalClosedInRange: 30,
      lostInRange: 3, lostInPriorPeriod: 8,
    });
    expect(equal.factors.lossPressure).toBe(100);
    expect(below.factors.lossPressure).toBe(100);
  });

  it("mainRisk identifies the lowest-scoring factor", () => {
    // staleness should be the worst here (8/10 stale = factor 20).
    const r = computeHealthScore({
      openDealsTotal: 10,
      openModifiedLast48h: 10,    // freshness 100
      openStalePerSla: 8,          // staleness 20
      openWithFollowUp: 10,        // followup 100
      stagesBreachingSla: 0,       // velocity 100
      stagesConsidered: 6,
      admittedInRange: 7,          // conversion 100
      totalClosedInRange: 20,
      lostInRange: 5,
      lostInPriorPeriod: 5,        // lossPressure 100
    });
    expect(r.mainRisk.factor).toBe("staleness");
    expect(r.mainRisk.value).toBe(20);
  });

  it("factors default to neutral (50) when there are no open deals", () => {
    const r = computeHealthScore({
      openDealsTotal: 0,
      openModifiedLast48h: 0,
      openStalePerSla: 0,
      openWithFollowUp: 0,
      stagesBreachingSla: 0,
      stagesConsidered: 6,
      admittedInRange: 0,
      totalClosedInRange: 0,
      lostInRange: 0,
      lostInPriorPeriod: 0,
    });
    expect(r.factors.freshness).toBe(50);
    expect(r.factors.staleness).toBe(50);
    expect(r.factors.followup).toBe(50);
    // conversion still 0 since admit rate is 0/0 → 0, and velocity 100
    // since 0/6 stages breaching. lossPressure is 100 (Laplace: 1/1 = 1, over = 0).
    expect(r.factors.conversion).toBe(0);
    expect(r.factors.velocity).toBe(100);
    expect(r.factors.lossPressure).toBe(100);
  });

  it("weights sum to 1.0", () => {
    const total = Object.values(HEALTH_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("hand-checked sample: mixed-realistic pipeline", () => {
    // 100 open deals; 60 touched in 48h; 22 stale per SLA; 78 with
    // follow-up; 2 of 6 stages breaching SLA; 12 admits + 22 lost in
    // window; 18 lost in prior window.
    //
    // factors:
    //   freshness    = 100 * 60/100 = 60
    //   velocity     = 100 * (1 - 2/6) = 66.67
    //   conversion   = (12/34) / 0.35 * 100 = 100.84 → clamps to 100
    //   staleness    = 100 - 100*22/100 = 78
    //   followup     = 100 * 78/100 = 78
    //   lossPressure = ratio = (22+1)/(18+1) = 1.2105
    //                  over = 0.2105 → pressure = 78.95
    //
    // score = 0.20*60 + 0.20*66.67 + 0.20*100 + 0.15*78 + 0.15*78 + 0.10*78.95
    //       = 12 + 13.333 + 20 + 11.7 + 11.7 + 7.895
    //       = 76.63
    const r = computeHealthScore({
      openDealsTotal: 100,
      openModifiedLast48h: 60,
      openStalePerSla: 22,
      openWithFollowUp: 78,
      stagesBreachingSla: 2,
      stagesConsidered: 6,
      admittedInRange: 12,
      totalClosedInRange: 34,
      lostInRange: 22,
      lostInPriorPeriod: 18,
    });
    expect(r.score).toBeCloseTo(76.6, 1);
    expect(r.factors.conversion).toBe(100);
    expect(r.factors.velocity).toBeCloseTo(66.7, 1);
    expect(r.factors.lossPressure).toBeCloseTo(78.9, 1);
  });
});
