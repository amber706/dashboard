// MetricInfo — a small info icon attached to any metric label that:
//   - On hover, shows a short "what is this" tooltip
//   - On click, opens a popover with the full "how it's calculated"
//
// Used on every KPI card, every health-score factor pill, every panel
// header. Driven by the METRIC_DEFS catalog so the copy stays in one
// place.

import { useState } from "react";
import { Info } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { METRIC_DEFS, type MetricKey } from "../lib/metricDefs";

interface MetricInfoProps {
  metric: MetricKey;
  /** Visual size of the info icon. */
  size?: "xs" | "sm";
}

export function MetricInfo({ metric, size = "xs" }: MetricInfoProps) {
  const def = METRIC_DEFS[metric];
  const [open, setOpen] = useState(false);
  const sizeClass = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <TooltipProvider delayDuration={150}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`About ${def.label}`}
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                className="inline-flex items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <Info className={sizeClass} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {/* Tooltip only shows when popover is closed — otherwise both
              fight for the same anchor and the popover loses. */}
          {!open && (
            <TooltipContent side="top" className="max-w-[240px] text-[11px]">
              <strong>{def.label}.</strong> {def.what}
              <div className="text-[10px] text-muted-foreground mt-0.5 italic">
                Click for calculation
              </div>
            </TooltipContent>
          )}
        </Tooltip>
        <PopoverContent side="top" align="start" className="w-[340px] text-xs">
          <div className="space-y-2">
            <div className="font-semibold text-sm">{def.label}</div>
            <div className="text-muted-foreground">{def.what}</div>
            <div className="pt-1.5 border-t">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                How it's calculated
              </div>
              <div className="leading-relaxed">{def.how}</div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
