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

export type FeatureKey =
  | "module_training"
  | "module_kb"
  | "module_qa"
  | "module_bd"
  | "module_ctm"
  | "module_executive";

export interface FeatureFlag {
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
}

interface FeatureFlagsContextType {
  flags: Record<FeatureKey, FeatureFlag>;
  isEnabled: (key: FeatureKey) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

// Fail-open defaults. Match the seed in the migration so the nav
// renders correctly during the first ~100ms while we fetch.
const DEFAULT_FLAGS: Record<FeatureKey, FeatureFlag> = {
  module_training:  { key: "module_training",  label: "Training",            description: "", enabled: true },
  module_kb:        { key: "module_kb",        label: "Knowledge Base",      description: "", enabled: true },
  module_qa:        { key: "module_qa",        label: "QA + Coaching",       description: "", enabled: true },
  module_bd:        { key: "module_bd",        label: "Business Development", description: "", enabled: true },
  module_ctm:       { key: "module_ctm",       label: "CTM (Call Tracking)", description: "", enabled: true },
  module_executive: { key: "module_executive", label: "Executive Boards",    description: "", enabled: true },
};

const FeatureFlagsContext = createContext<FeatureFlagsContextType>({
  flags: DEFAULT_FLAGS,
  isEnabled: () => true,
  loading: true,
  refresh: async () => {},
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<FeatureKey, FeatureFlag>>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("key, label, description, enabled");
    if (error || !data) {
      setLoading(false);
      return;
    }
    const next = { ...DEFAULT_FLAGS };
    for (const row of data) {
      const k = row.key as FeatureKey;
      if (k in next) {
        next[k] = { key: k, label: row.label, description: row.description, enabled: row.enabled };
      }
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

  const value = useMemo<FeatureFlagsContextType>(() => ({
    flags,
    isEnabled: (key) => flags[key]?.enabled ?? true,
    loading,
    refresh: load,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [flags, loading]);

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}

export function useFeatureFlag(key: FeatureKey): boolean {
  return useContext(FeatureFlagsContext).isEnabled(key);
}
