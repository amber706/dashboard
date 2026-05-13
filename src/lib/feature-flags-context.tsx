// Feature flags — admin-controlled module toggles.
//
// The flags live in public.feature_flags (one row per toggleable
// module). Admin flips them in /admin/settings; everyone else reads.
// The provider subscribes to Postgres realtime so a toggle in one
// browser propagates to others without a refresh.
//
// Defaults: while we're loading (or if the table is empty for any
// reason) we default every flag to TRUE — i.e. fail open. Disabling a
// module should be an explicit admin action, never a side-effect of a
// network blip.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

// Module-level keys — own a master tab + section.
export type ModuleKey =
  | "module_training"
  | "module_kb"
  | "module_qa"
  | "module_bd"
  | "module_ctm"
  | "module_executive";

// Page-level keys — sub-features inside a module (or floating sub-
// features inside Admissions). Cascade rule: if a page's parent module
// is off, the page is off regardless of its own enabled value.
export type PageKey =
  | "page_supervisor_review"
  | "page_suggestions"
  | "page_dispositions"
  | "page_ai_bot_feedback"
  | "page_staffing_schedule"
  | "page_rep_workload"
  | "page_funnel"
  | "page_outcomes"
  | "page_attribution"
  | "page_objection_mining"
  | "page_training_paths"
  | "page_training_analytics"
  | "page_kb_drafts"
  | "page_knowledge_review"
  | "page_bd_referrals"
  | "page_bd_stuck_accounts"
  | "page_bd_top_accounts"
  | "page_bd_account_intel"
  | "page_bd_meetings";

export type FeatureKey = ModuleKey | PageKey;

export interface FeatureFlag {
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
  parent: ModuleKey | null;
}

interface FeatureFlagsContextType {
  flags: Partial<Record<FeatureKey, FeatureFlag>>;
  /** Returns true when the flag itself is enabled AND its parent module
   *  (if any) is enabled. Unknown keys fail open. */
  isEnabled: (key: FeatureKey) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

// Fail-open default — used only during the initial fetch window, when
// the table hasn't returned yet. We default the cached map to empty
// and let isEnabled fail open for unknown keys (the realistic default
// state is "everything on").
const EMPTY_FLAGS: Partial<Record<FeatureKey, FeatureFlag>> = {};

const FeatureFlagsContext = createContext<FeatureFlagsContextType>({
  flags: EMPTY_FLAGS,
  isEnabled: () => true,
  loading: true,
  refresh: async () => {},
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Partial<Record<FeatureKey, FeatureFlag>>>(EMPTY_FLAGS);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("key, label, description, enabled, parent");
    if (error || !data) {
      setLoading(false);
      return;
    }
    const next: Partial<Record<FeatureKey, FeatureFlag>> = {};
    for (const row of data) {
      const k = row.key as FeatureKey;
      next[k] = {
        key: k,
        label: row.label,
        description: row.description,
        enabled: row.enabled,
        parent: (row.parent ?? null) as ModuleKey | null,
      };
    }
    setFlags(next);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Realtime — when an admin toggles a flag, everyone else sees it
    // immediately without a refresh. Falls back silently if realtime
    // isn't enabled for this table; the next page nav will re-fetch.
    const chan = supabase
      .channel("feature_flags")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "feature_flags" }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(chan); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<FeatureFlagsContextType>(() => {
    function isEnabled(key: FeatureKey): boolean {
      const f = flags[key];
      // Unknown key → fail open (network blip / new code, old DB).
      if (!f) return true;
      if (!f.enabled) return false;
      // Cascade — a page is off whenever its parent module is off,
      // regardless of its own flag.
      if (f.parent) {
        const p = flags[f.parent];
        if (p && !p.enabled) return false;
      }
      return true;
    }
    return { flags, isEnabled, loading, refresh: load };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags, loading]);

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}

export function useFeatureFlag(key: FeatureKey): boolean {
  return useContext(FeatureFlagsContext).isEnabled(key);
}
