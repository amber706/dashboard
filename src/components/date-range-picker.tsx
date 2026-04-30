import { useState, useMemo } from "react";
import { format, subDays, startOfDay, endOfDay, startOfMonth, isSameDay } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

type PresetKey = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "allTime";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "allTime", label: "All Time" },
];

function getPresetRange(key: PresetKey): DateRange | null {
  const now = new Date();
  switch (key) {
    case "today":
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { startDate: startOfDay(y), endDate: endOfDay(y) };
    }
    case "last7":
      return { startDate: startOfDay(subDays(now, 6)), endDate: endOfDay(now) };
    case "last30":
      return { startDate: startOfDay(subDays(now, 29)), endDate: endOfDay(now) };
    case "thisMonth":
      return { startDate: startOfMonth(now), endDate: endOfDay(now) };
    case "allTime":
      return null;
  }
}

function deriveActivePreset(value: DateRange | null): PresetKey | "custom" {
  if (!value) return "allTime";
  for (const preset of PRESETS) {
    if (preset.key === "allTime") continue;
    const range = getPresetRange(preset.key);
    if (range && isSameDay(value.startDate, range.startDate) && isSameDay(value.endDate, range.endDate)) {
      return preset.key;
    }
  }
  return "custom";
}

interface DateRangePickerProps {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  className?: string;
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const activePreset = useMemo(() => deriveActivePreset(value), [value]);

  const handlePreset = (key: PresetKey) => {
    const range = getPresetRange(key);
    onChange(range);
    setOpen(false);
  };

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range?.from) {
      onChange({
        startDate: startOfDay(range.from),
        endDate: range.to ? endOfDay(range.to) : endOfDay(range.from),
      });
    }
  };

  const displayLabel = (() => {
    if (activePreset !== "custom") {
      return PRESETS.find((p) => p.key === activePreset)?.label ?? "Select dates";
    }
    if (value) {
      return `${format(value.startDate, "MMM d, yyyy")} – ${format(value.endDate, "MMM d, yyyy")}`;
    }
    return "Select dates";
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5 text-xs font-normal", className)}
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          {displayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          <div className="border-r p-2 space-y-0.5 min-w-[140px]">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePreset(preset.key)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors",
                  activePreset === preset.key
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={
                value
                  ? { from: value.startDate, to: value.endDate }
                  : undefined
              }
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getDefaultDateRange(): DateRange {
  const now = new Date();
  return {
    startDate: startOfDay(subDays(now, 29)),
    endDate: endOfDay(now),
  };
}

export function formatDateParam(date: Date): string {
  return format(date, "yyyy-MM-dd");
}
