// types.ts — shared TypeScript contracts for the Admissions Analytics
// Dashboard. Every edge function response shape lives here so the
// frontend hooks + server functions stay in sync.
//
// No `any`. All optional fields are explicit with `| null` or `?` so
// strict null checks don't lie about what callers can rely on.

import type { RoleKey } from "../constants/roles";
import type { StageKey } from "../constants/stages";

// ── Inputs ────────────────────────────────────────────────────────

export type DashboardRangePreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "mtd"
  | "lastMonth"
  | "ytd"
  | "lastYear"
  | "custom";

export interface DashboardRange {
  preset: DashboardRangePreset;
  /** YYYY-MM-DD; required when preset === "custom", otherwise computed. */
  start: string;
  end: string;
  /** Human-readable label for the UI ("This month", "Apr 1 → 14"). */
  label: string;
}

export interface AnalyticsRequestBase {
  role: RoleKey;
  start: string;  // ISO date YYYY-MM-DD
  end: string;
}

// ── Health Score ──────────────────────────────────────────────────

export interface HealthScoreFactors {
  freshness: number;     // 0-100
  velocity: number;
  conversion: number;
  staleness: number;
  followup: number;
  lossPressure: number;
}

export interface HealthScore {
  score: number;                                    // 0-100
  factors: HealthScoreFactors;
  mainRisk: { factor: keyof HealthScoreFactors; value: number };
}

export type HealthBadge = "green" | "yellow" | "red";

export function badgeFor(score: number): HealthBadge {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

// ── Summary (Executive Overview) ──────────────────────────────────

export interface AnalyticsSummary {
  activePipeline: number;
  newInRange: { leads: number; deals: number };
  admitted: number;
  lost: number;
  conversion: { numerator: number; denominator: number; pct: number };
  healthScore: HealthScore;
  topRisks: Array<{ label: string; count: number; severity: HealthBadge }>;
  missing_fields?: string[];
}

// ── Live Pipeline / Kanban ────────────────────────────────────────

export type DealRiskFlag = "none" | "warm" | "risk";

export interface DealCard {
  id: string;
  name: string;
  source: string | null;
  owner: string;
  daysInStage: number;
  lastActivity: string | null;
  nextTask: string | null;
  riskFlag: DealRiskFlag;
}

export interface PipelineSnapshot {
  kpis: {
    active: number;
    newToday: { leads: number; deals: number };
    stale: { leads: number; deals: number };
  };
  byOwner: Array<{ owner: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  followups: Array<{
    id: string;
    dealName: string;
    owner: string;
    stage: string;
    dueAt: string;
  }>;
  staleList: Array<{
    id: string;
    dealName: string;
    stage: string;
    owner: string;
    days: number;
  }>;
  kanban: Record<StageKey, DealCard[]>;
  missing_fields?: string[];
}

// ── Stage Movement ────────────────────────────────────────────────

export interface AgingBuckets {
  "0-1": number;
  "2-3": number;
  "4-7": number;
  "8-14": number;
  "15+": number;
}

export interface StageMovement {
  todayInByStage: Array<{ stage: string; count: number }>;
  todayOutByStage: Array<{ stage: string; count: number }>;
  netByStage: Array<{ stage: string; net: number }>;
  avgDaysByStage: Array<{
    stage: string;
    avgDays: number;
    slaDays: number | null;
    breach: boolean;
  }>;
  agingBuckets: AgingBuckets;
  stuck: Array<{
    id: string;
    dealName: string;
    stage: string;
    owner: string;
    days: number;
    lastChange: string;
  }>;
  missing_fields?: string[];
}

// ── Closed-Admitted ───────────────────────────────────────────────

export interface ClosedAdmitted {
  total: number;
  daysToAdmit: { avg: number; median: number; n: number };
  bySource: Array<{ source: string; count: number }>;
  byRep: Array<{ rep: string; count: number }>;
  byProgram: Array<{ program: string; count: number }>;
  conversionBySource: Array<{
    source: string;
    created: number;
    admitted: number;
    rate: number;
  }>;
  speedBySource: Array<{
    source: string;
    avgDays: number;
    medianDays: number;
    n: number;
  }>;
  forecastNext7Days: number;
  /** Per-deal rows used by drill-down sheets. */
  details?: AdmittedDealDetail[];
  missing_fields?: string[];
}

export interface AdmittedDealDetail {
  id: string;
  dealName: string;
  owner: string;
  source: string | null;
  program: string | null;
  admitDate: string | null;
  createdTime: string | null;
}

// ── Closed-Lost ───────────────────────────────────────────────────

export interface ClosedLost {
  total: number;
  lossRate: number;
  preventableCount: number;
  byReason: Array<{ reason: string; count: number }>;
  byStage: Array<{ stage: string; count: number }>;
  byOwner: Array<{ owner: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  trend: Array<{ date: string; count: number }>;
  heatmap: {
    sources: string[];
    stages: string[];
    counts: number[][];
  };
  /** Per-deal rows used by drill-down sheets. */
  details?: LostDealDetail[];
  missing_fields?: string[];
}

export interface LostDealDetail {
  id: string;
  dealName: string;
  stage: string;
  owner: string;
  source: string | null;
  reason: string | null;
  closingDate: string | null;
}

// ── Rep Performance ───────────────────────────────────────────────

export interface RepPerformanceRow {
  rep: string;
  volume: number;
  admits: number;
  lost: number;
  active: number;
  conversionPct: number;
  /** Average days from Created_Time to Admit_Date for admits in window. */
  avgDaysToAdmit: number;
  /** Sample size used to compute avgDaysToAdmit. */
  admitSpeedN: number;
  avgDaysPerStage: number;
  followupCompliancePct: number;
}

export interface RepPerformance {
  rows: RepPerformanceRow[];
  /** Set when the role is `digitalMarketing` — tab hides the table. */
  note?: "not_applicable";
  missing_fields?: string[];
}

// ── Edge function envelope ────────────────────────────────────────
// Every endpoint returns { ok, ... } so callers can `if (!json.ok)`
// uniformly. Errors that come back over the wire are always a string.

export type EdgeResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type AnalyticsSummaryResponse = EdgeResponse<AnalyticsSummary>;
export type PipelineSnapshotResponse = EdgeResponse<PipelineSnapshot>;
export type StageMovementResponse = EdgeResponse<StageMovement>;
export type ClosedAdmittedResponse = EdgeResponse<ClosedAdmitted>;
export type ClosedLostResponse = EdgeResponse<ClosedLost>;
export type RepPerformanceResponse = EdgeResponse<RepPerformance>;
