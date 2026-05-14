// Shared types for the warehouse-backed analytics dashboards.
// Mirror the contracts used by cornerstone-dashboard but stripped of
// CPA + revenue-proxy fields (HOLD).

export interface DateRange {
  /** ISO YYYY-MM-DD inclusive */
  from: string;
  /** ISO YYYY-MM-DD inclusive */
  to: string;
}

export type DatePreset =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "MTD"
  | "LAST_MONTH"
  | "QTD"
  | "YTD"
  | "L30D"
  | "L90D"
  | "CUSTOM";

export interface MonthlySeries {
  month: string;
  digital: number;
  bd: number;
  isCurrent: boolean;
}

export interface StageCount {
  stageKey: string;
  label: string;
  count: number;
  isStuck?: boolean;
}

export interface PayerRow {
  month: string;
  commercial: number;
  ahcccs: number;
  cash: number;
  dui?: number;
  dv?: number;
  unknown?: number;
}

export interface ExecutiveSnapshot {
  range: DateRange;
  kpis: {
    newLeads:   { value: number; delta: number | null; priorValue: number };
    admits:     { value: number; delta: number | null; digital: number; bd: number };
    census:     { value: number; virtual: number; inPerson: number };
    vobRate:    { value: number | null; approved: number; completed: number };
  };
  trend: MonthlySeries[];
  funnel: StageCount[];
  payerTrend: PayerRow[];
}
