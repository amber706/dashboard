import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { DatePreset, DateRange } from "../api/types";

const PRESETS: { value: DatePreset; label: string; group?: string }[] = [
  { value: "TODAY",      label: "Today",         group: "Days" },
  { value: "YESTERDAY",  label: "Yesterday",     group: "Days" },
  { value: "THIS_WEEK",  label: "This week",     group: "Weeks" },
  { value: "LAST_WEEK",  label: "Last week",     group: "Weeks" },
  { value: "MTD",        label: "Month to date", group: "Months" },
  { value: "LAST_MONTH", label: "Last month",    group: "Months" },
  { value: "QTD",        label: "Quarter to date", group: "Quarters" },
  { value: "YTD",        label: "Year to date",  group: "Years" },
  { value: "L30D",       label: "Last 30 days",  group: "Rolling" },
  { value: "L90D",       label: "Last 90 days",  group: "Rolling" },
  { value: "CUSTOM",     label: "Custom range…", group: "Custom" },
];

interface Props {
  preset: DatePreset;
  range: DateRange;
  onChange: (preset: DatePreset, custom?: DateRange) => void;
}

export function RangePicker({ preset, range, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(range.from);
  const [draftTo, setDraftTo]   = useState(range.to);

  const handlePresetChange = (v: DatePreset) => {
    if (v === "CUSTOM") {
      setDraftFrom(range.from);
      setDraftTo(range.to);
      setCustomOpen(true);
    } else {
      onChange(v);
    }
  };

  const applyCustom = () => {
    onChange("CUSTOM", { from: draftFrom, to: draftTo });
    setCustomOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={(v) => handlePresetChange(v as DatePreset)}>
        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={() => { setDraftFrom(range.from); setDraftTo(range.to); setCustomOpen(true); }}
            className="text-xs text-muted-foreground hover:text-foreground tabular-nums hidden sm:inline"
            title="Edit custom range"
          >
            {range.from} → {range.to}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 space-y-2">
          <div className="text-xs font-medium">Custom date range</div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="h-8 text-xs w-[140px]"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="h-8 text-xs w-[140px]"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCustomOpen(false)} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={applyCustom} disabled={!draftFrom || !draftTo || draftFrom > draftTo} className="h-7 text-xs">
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
