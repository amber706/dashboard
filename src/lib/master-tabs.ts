// Master-tab structure for the dashboard. Six (well, seven) top-level
// areas — Admissions is the only fully-built one today; Training holds
// the practice + admin training pages; the rest are placeholder
// landings until those product surfaces get built.

import type { LucideIcon } from "lucide-react";
import {
  Phone, TrendingUp, ClipboardCheck, Award, BarChart3,
  LayoutDashboard, GraduationCap, BookOpen,
} from "lucide-react";

export type MasterTabKey =
  | "admissions"
  | "business_development"
  | "intake"
  | "alumni"
  | "digital_marketing"
  | "executive"
  | "training"
  | "knowledge_base";

export interface MasterTab {
  key: MasterTabKey;
  label: string;
  icon: LucideIcon;
  /** Where the tab lands when clicked. */
  defaultPath: string;
  /** URL prefixes that belong to this tab (for active-detection). */
  prefixes: string[];
  /** Which existing nav sections show in the sidebar when this tab is active. */
  sections: string[];
  /** Whether the tab is just a placeholder landing for now. */
  empty: boolean;
}

// Order matters — this is the left-to-right order in the tab bar.
export const MASTER_TABS: MasterTab[] = [
  {
    key: "admissions",
    label: "Admissions",
    icon: Phone,
    defaultPath: "/",
    // Admissions owns the bulk of the existing dashboard. Note: the
    // Executive tab below claims more-specific Quality / Staffing /
    // Insights / Admin paths first via getActiveMasterTab's iteration
    // order, so navigating to e.g. /ops/qa-review activates Executive
    // even though /ops/ is in Admissions' broad prefix list.
    prefixes: [
      "/", "/me", "/ctm-calls", "/ctm-agents", "/ctm-attribution",
      "/queue", "/kb", "/knowledge-review",
      "/pre-call", "/live", "/wrap-up", "/leads",
      "/onboarding", "/suggestion",
      "/ops/", "/admin",
    ],
    sections: ["Overview", "Workflow", "Alerts", "Live Ops"],
    empty: false,
  },
  {
    key: "business_development",
    label: "Business Dev",
    icon: TrendingUp,
    defaultPath: "/bd",
    prefixes: ["/bd"],
    sections: ["BD"],
    empty: false,
  },
  {
    key: "intake",
    label: "Intake",
    icon: ClipboardCheck,
    defaultPath: "/intake",
    prefixes: ["/intake"],
    sections: [],
    empty: true,
  },
  {
    key: "alumni",
    label: "Alumni",
    icon: Award,
    defaultPath: "/alumni",
    prefixes: ["/alumni"],
    sections: [],
    empty: true,
  },
  {
    key: "digital_marketing",
    label: "Digital Marketing",
    icon: BarChart3,
    defaultPath: "/marketing",
    prefixes: ["/marketing"],
    sections: [],
    empty: true,
  },
  {
    key: "executive",
    label: "Executive",
    icon: LayoutDashboard,
    defaultPath: "/executive",
    // Executive owns the management surfaces — Quality, Staffing,
    // Insights, Admin — that used to live under Admissions but are
    // really exec/ops oversight territory rather than day-to-day
    // intake workflow. The specific URL prefixes below match in
    // getActiveMasterTab BEFORE Admissions' broad /ops/ + /admin
    // catch-alls, so navigating to e.g. /ops/qa-review or /admin/audit
    // activates the Executive tab.
    prefixes: [
      "/executive",
      // Quality
      "/ops/qa-review", "/ops/dispositions", "/ops/ai-bot-feedback",
      // Staffing
      "/ops/team", "/ops/staffing", "/ops/workload",
      // Insights
      "/ops/funnel", "/ops/outcomes", "/ops/attribution",
      "/ops/training-analytics", "/ops/kb-drafts", "/ops/objections",
      // Admin
      "/admin/leads", "/admin/health", "/admin/audit", "/admin/settings",
      "/admin", "/settings",
    ],
    sections: ["Quality", "Staffing", "Insights", "Admin"],
    empty: false,
  },
  {
    key: "training",
    label: "Training",
    icon: GraduationCap,
    defaultPath: "/training",
    prefixes: ["/training", "/ops/training-", "/ops/scenario-review"],
    sections: ["Training"],
    empty: false,
  },
  {
    key: "knowledge_base",
    label: "Knowledge Base",
    icon: BookOpen,
    defaultPath: "/kb",
    prefixes: ["/kb"],
    // No sub-sections — the /kb page IS the workspace. Same data
    // source as the Knowledge Base link inside Admissions; both
    // surfaces read from kb_documents, so any edit/approval shows
    // up in both places automatically (no sync layer needed).
    sections: [],
    empty: false,
  },
];

/** Resolve which master tab a URL belongs to. Defaults to Admissions. */
export function getActiveMasterTab(pathname: string): MasterTab {
  // Training and Knowledge Base prefixes overlap with Admissions —
  // "/training" and "/kb" are also referenced from Admissions sub-nav.
  // Resolve those tabs first so the workspace highlight follows the
  // most-specific match.
  for (const key of ["training", "knowledge_base"] as const) {
    const t = MASTER_TABS.find((mt) => mt.key === key)!;
    if (t.prefixes.some((p) => pathname === p || pathname.startsWith(p))) {
      return t;
    }
  }
  // Then check the rest in order, skipping Admissions until last.
  for (const t of MASTER_TABS) {
    if (t.key === "admissions" || t.key === "training" || t.key === "knowledge_base") continue;
    if (t.prefixes.some((p) => pathname === p || pathname.startsWith(p))) {
      return t;
    }
  }
  return MASTER_TABS.find((t) => t.key === "admissions")!;
}
