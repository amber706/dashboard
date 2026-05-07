// Master-tab structure for the dashboard. Six (well, seven) top-level
// areas — Admissions is the only fully-built one today; Training holds
// the practice + admin training pages; the rest are placeholder
// landings until those product surfaces get built.

import type { LucideIcon } from "lucide-react";
import {
  Phone, TrendingUp, ClipboardCheck, Award, BarChart3,
  LayoutDashboard, GraduationCap,
} from "lucide-react";

export type MasterTabKey =
  | "admissions"
  | "business_development"
  | "intake"
  | "alumni"
  | "digital_marketing"
  | "executive"
  | "training";

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
    // Admissions owns the bulk of the existing dashboard.
    prefixes: [
      "/", "/me", "/ctm-calls", "/ctm-agents", "/ctm-attribution",
      "/queue", "/kb", "/knowledge-review",
      "/pre-call", "/live", "/wrap-up", "/leads",
      "/onboarding", "/settings", "/suggestion",
      "/ops/", "/admin",
    ],
    sections: [
      "Overview", "Workflow", "Alerts", "Live Ops",
      "Quality", "Staffing", "Insights", "Admin",
    ],
    empty: false,
  },
  {
    key: "business_development",
    label: "Business Dev",
    icon: TrendingUp,
    defaultPath: "/bd",
    prefixes: ["/bd"],
    sections: [],
    empty: true,
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
    prefixes: ["/executive"],
    // Executive Overview page already exists; no sub-sections yet.
    sections: [],
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
];

/** Resolve which master tab a URL belongs to. Defaults to Admissions. */
export function getActiveMasterTab(pathname: string): MasterTab {
  // Training prefixes overlap with Admissions ("/training" is also a
  // standalone path, "/ops/training-*" looks like ops). Match those
  // first, then fall through to Admissions for everything ops-y.
  const trainingTab = MASTER_TABS.find((t) => t.key === "training")!;
  if (trainingTab.prefixes.some((p) => pathname === p || pathname.startsWith(p))) {
    return trainingTab;
  }
  // Then check the rest in order, skipping Admissions until last.
  for (const t of MASTER_TABS) {
    if (t.key === "admissions" || t.key === "training") continue;
    if (t.prefixes.some((p) => pathname === p || pathname.startsWith(p))) {
      return t;
    }
  }
  return MASTER_TABS.find((t) => t.key === "admissions")!;
}
