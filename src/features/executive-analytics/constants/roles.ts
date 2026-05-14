// roles.ts — role-driven section visibility for the analytics dashboard.
//
// Four role views: admissions / bd / digitalMarketing / all. Each tab
// can hide, replace, or reshape panels based on the active role. We
// keep that decision data in this single matrix rather than peppering
// `role === 'bd' && ...` conditionals throughout the tab components.
//
// The default-role inference at page mount maps profiles.role →
// RoleKey: admissions specialist → 'admissions', BD specialist → 'bd',
// manager/admin → 'all'. The user can override via the toggle group;
// the choice persists to localStorage.

import type { UserRole } from "@/lib/auth-context";

export type RoleKey = "admissions" | "bd" | "digitalMarketing" | "all";

export const ROLE_KEYS: RoleKey[] = ["admissions", "bd", "digitalMarketing", "all"];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admissions: "Admissions",
  bd: "Business Dev",
  digitalMarketing: "Digital Marketing",
  all: "All",
};

// Section visibility matrix — referenced by every tab component so the
// hide/replace logic stays declarative.
//
// `mode`:
//   - "full"    → render exactly as designed
//   - "hide"    → skip the panel
//   - "replace" → render an alternate panel; the tab decides which
//   - "headline"→ promote the panel to the top of the tab
export interface SectionVisibility {
  mode: "full" | "hide" | "replace" | "headline";
  /** Optional payload — e.g. the alternate-panel key when mode="replace". */
  variant?: string;
  /** When true, the user can click a toggle to override hide→show. */
  userToggleable?: boolean;
}

type TabKey =
  | "executiveOverview"
  | "livePipeline"
  | "stageMovement"
  | "closedAdmitted"
  | "closedLost"
  | "repPerformance";

type PanelKey =
  | "default"                  // a tab's main panel set
  | "bySource"                 // Live Pipeline "by source/referral"
  | "byProgram"                // Closed-Admitted "by program"
  | "preventableLossReasons"   // Closed-Lost preventable panel
  | "lossBySource";            // Closed-Lost referral-attributable variant

export const ROLE_VISIBILITY: Record<RoleKey, Partial<Record<TabKey, Partial<Record<PanelKey, SectionVisibility>>>>> = {
  admissions: {
    executiveOverview: { default: { mode: "full" } },
    livePipeline: {
      default: { mode: "full" },
      bySource: { mode: "hide", userToggleable: true },
    },
    stageMovement: { default: { mode: "full" } },
    closedAdmitted: { default: { mode: "full" } },
    closedLost: {
      default: { mode: "full" },
      preventableLossReasons: { mode: "full" },
    },
    repPerformance: { default: { mode: "full" } },
  },
  bd: {
    executiveOverview: { default: { mode: "full" } },
    livePipeline: {
      default: { mode: "full" },
      bySource: { mode: "headline" },
    },
    stageMovement: { default: { mode: "full" } },
    closedAdmitted: {
      default: { mode: "full" },
      byProgram: { mode: "hide" },
    },
    closedLost: {
      default: { mode: "full" },
      preventableLossReasons: { mode: "replace", variant: "lossBySource" },
    },
    repPerformance: { default: { mode: "full" } },
  },
  digitalMarketing: {
    executiveOverview: { default: { mode: "full" } },
    livePipeline: {
      default: { mode: "full" },
      bySource: { mode: "headline" },
    },
    stageMovement: { default: { mode: "full" } },
    closedAdmitted: { default: { mode: "full" } },
    closedLost: { default: { mode: "full" } },
    // The Rep Performance tab is hidden for digital marketing — the
    // tab strip itself omits the entry, and the edge function returns
    // { rows: [], note: 'not_applicable' } as a defensive backstop.
    repPerformance: { default: { mode: "hide" } },
  },
  all: {
    executiveOverview: { default: { mode: "full" } },
    livePipeline: { default: { mode: "full" }, bySource: { mode: "full" } },
    stageMovement: { default: { mode: "full" } },
    closedAdmitted: { default: { mode: "full" }, byProgram: { mode: "full" } },
    closedLost: { default: { mode: "full" }, preventableLossReasons: { mode: "full" } },
    repPerformance: { default: { mode: "full" } },
  },
};

export function panelVisibility(
  role: RoleKey,
  tab: TabKey,
  panel: PanelKey,
): SectionVisibility {
  return ROLE_VISIBILITY[role]?.[tab]?.[panel] ?? { mode: "full" };
}

export function isTabVisible(role: RoleKey, tab: TabKey): boolean {
  const v = ROLE_VISIBILITY[role]?.[tab]?.default;
  return v?.mode !== "hide";
}

// Returns the ordered list of tab keys to render for a role.
// Order is fixed — only "hide" mode strips entries.
export function visibleTabsForRole(role: RoleKey): TabKey[] {
  const order: TabKey[] = [
    "executiveOverview",
    "livePipeline",
    "stageMovement",
    "closedAdmitted",
    "closedLost",
    "repPerformance",
  ];
  return order.filter((t) => isTabVisible(role, t));
}

// Default-role inference at first mount. Used before the user has
// touched the toggle (no localStorage entry yet).
export function defaultRoleFor(profileRole: UserRole | null): RoleKey {
  // Manager + admin land on 'all' so they see every section.
  if (profileRole === "admin" || profileRole === "manager") return "all";
  // We don't have a stored team mapping yet, so specialists default to
  // 'admissions' (the most common case for the dashboard's primary
  // audience). BD reps can switch via the toggle and the choice
  // persists.
  return "admissions";
}
