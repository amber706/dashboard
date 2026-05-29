// FilterBar — Phase 1C shared multi-select filter UI.
//
// Mirrors the contract enumerated in METRIC_DEFINITIONS.md §26 (Pipeline,
// Marketing Channel / Source Category, Level of Care). Date range stays on
// the existing RangePicker so this component composes alongside it.
//
// Each filter is a Popover with a checklist. "All" = empty array =
// no filter applied. Caller owns state; this is a pure controlled component.

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, X } from "lucide-react";
import {
  PIPELINE_VALUES,
  SOURCE_CATEGORY_VALUES,
  LEVEL_OF_CARE_VALUES,
  type Pipeline,
  type SourceCategory,
  type LevelOfCare,
} from "@/lib/metrics/definitions";

export interface FilterContract {
  pipelines: Pipeline[];
  sources: SourceCategory[];
  locs: LevelOfCare[];
}

export const EMPTY_FILTERS: FilterContract = {
  pipelines: [],
  sources: [],
  locs: [],
};

const PIPELINE_LABEL: Record<Pipeline, string> = {
  commercial_cash: "Commercial-Cash",
  ahcccs: "AHCCCS",
  zocdoc: "ZocDoc",
  dui_cash: "DUI",
  dv_cash: "DV",
};
const SOURCE_LABEL: Record<SourceCategory, string> = {
  digital_marketing: "Digital",
  business_development: "BD",
  zocdoc: "ZocDoc",
};
const LOC_LABEL: Record<LevelOfCare, string> = {
  bhrf: "BHRF",
  detox: "Detox",
  php: "PHP",
  iop5: "IOP-5",
  iop3: "IOP-3",
  viop_adult: "VIOP Adult",
  viop_adolescent: "VIOP Adolescent",
  op: "OP",
  vop: "VOP",
  vop_adult: "VOP Adult",
  vop_adolescent: "VOP Adolescent",
  dui: "DUI",
  dv: "DV",
};

interface MultiSelectProps<T extends string> {
  label: string;
  values: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
  labelMap: Record<T, string>;
}

function MultiSelect<T extends string>({ label, values, selected, onChange, labelMap }: MultiSelectProps<T>) {
  const isAll = selected.length === 0;
  const displayText = isAll
    ? "All"
    : selected.length === 1
    ? labelMap[selected[0]]
    : `${selected.length} selected`;

  const toggle = (v: T) => {
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else {
      onChange([...selected, v]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 min-w-[140px] justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-sm flex-1 text-left truncate">{displayText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="flex items-center justify-between px-2 pb-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {!isAll && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {values.map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
            >
              <Checkbox checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
              <span>{labelMap[v]}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FilterBarProps {
  filters: FilterContract;
  onChange: (next: FilterContract) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const activeCount = useMemo(
    () => filters.pipelines.length + filters.sources.length + filters.locs.length,
    [filters],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect
        label="Pipeline"
        values={PIPELINE_VALUES}
        selected={filters.pipelines}
        onChange={(pipelines) => onChange({ ...filters, pipelines })}
        labelMap={PIPELINE_LABEL}
      />
      <MultiSelect
        label="Channel"
        values={SOURCE_CATEGORY_VALUES}
        selected={filters.sources}
        onChange={(sources) => onChange({ ...filters, sources })}
        labelMap={SOURCE_LABEL}
      />
      <MultiSelect
        label="LOC"
        values={LEVEL_OF_CARE_VALUES}
        selected={filters.locs}
        onChange={(locs) => onChange({ ...filters, locs })}
        labelMap={LOC_LABEL}
      />
      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs gap-1"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X className="h-3 w-3" /> Clear all
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {activeCount}
          </Badge>
        </Button>
      )}
    </div>
  );
}
