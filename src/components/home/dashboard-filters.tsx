// DashboardFilters — the bar at the top of SpecialistOverview that
// scopes the entire grid to a date range + specific admissions rep.
//
// State shape (lifted to parent):
//   { range, customStart, customEnd, repId }
//
// Range options: today, yesterday, this week (Sun-start), this month,
// this quarter (Jan/Apr/Jul/Oct), custom.
//
// Rep options: loaded from public.profiles filtered to roles that
// could plausibly own deals or calls (rep / manager / admin), with a
// non-null zoho_user_id (otherwise the COQL Owner.id filter would be a
// no-op). "Whole team" entry at the top.

import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/lib/supabase";

export type DashboardRange =
  | "today" | "yesterday" | "week" | "month" | "quarter" | "custom";

export interface DashboardFilterState {
  range: DashboardRange;
  customStart: string;  // YYYY-MM-DD
  customEnd: string;
  repId: string | null; // null = whole team
}

export const DEFAULT_FILTERS: DashboardFilterState = {
  range: "today",
  customStart: isoDay(new Date(Date.now() - 7 * 86400_000)),
  customEnd: isoDay(new Date()),
  repId: null,
};

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface RepOption {
  id: string;
  full_name: string | null;
  role: string;
}

const RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  custom: "Custom range",
};

export function DashboardFilters({
  value, onChange,
}: {
  value: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
}) {
  const [reps, setReps] = useState<RepOption[]>([]);
  const [loadingReps, setLoadingReps] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pull every active profile that has a zoho_user_id — those are
      // the people who could own a deal or a call. Manager/admin
      // included because in practice they get filtered onto deals too.
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, role, zoho_user_id, is_active")
        .not("zoho_user_id", "is", null)
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (cancelled || !data) { setLoadingReps(false); return; }
      setReps(data as RepOption[]);
      setLoadingReps(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const showCustom = value.range === "custom";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Range selector */}
      <div className="inline-flex items-center gap-1.5">
        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <Select
          value={value.range}
          onValueChange={(v) => onChange({ ...value, range: v as DashboardRange })}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGE_LABELS) as DashboardRange[]).map((k) => (
              <SelectItem key={k} value={k} className="text-xs">{RANGE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Custom range inputs — only when "custom" is selected */}
      {showCustom && (
        <div className="inline-flex items-center gap-1">
          <Input
            type="date"
            value={value.customStart}
            onChange={(e) => onChange({ ...value, customStart: e.target.value })}
            className="h-8 w-[150px] text-xs"
          />
          <span className="text-[10px] text-muted-foreground">→</span>
          <Input
            type="date"
            value={value.customEnd}
            onChange={(e) => onChange({ ...value, customEnd: e.target.value })}
            className="h-8 w-[150px] text-xs"
          />
        </div>
      )}

      {/* Rep selector */}
      <div className="inline-flex items-center gap-1.5">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
        <Select
          value={value.repId ?? "__all__"}
          onValueChange={(v) => onChange({ ...value, repId: v === "__all__" ? null : v })}
          disabled={loadingReps}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder={loadingReps ? "Loading…" : "Whole team"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">Whole team</SelectItem>
            {reps.map((r) => (
              <SelectItem key={r.id} value={r.id} className="text-xs">
                {r.full_name ?? "(unnamed)"}
                {r.role !== "specialist" && r.role !== "rep" && (
                  <span className="text-muted-foreground ml-1">· {r.role}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clear-filters convenience — appears only when something is set
          past defaults so the bar stays compact when unused. */}
      {(value.range !== "today" || value.repId) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...DEFAULT_FILTERS })}
          className="h-7 px-2 text-[11px] gap-1"
        >
          <X className="w-3 h-3" /> Reset
        </Button>
      )}
    </div>
  );
}
