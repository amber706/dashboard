import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Info } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  loading?: boolean;
  accent?: string;
  onClick?: () => void;
  /**
   * Plain-English explanation shown on hovering the small "i" badge
   * next to the label. Should describe what's counted, the source
   * field/table, the time-window basis, and any threshold rules.
   */
  info?: string;
}

export function StatCard({ label, value, icon, change, changeType = "neutral", loading, accent, onClick, info }: StatCardProps) {
  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-5">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-9 w-16" />
        </CardContent>
      </Card>
    );
  }

  const card = (
    <Card
      className={`border-border/50 ${accent ? `border-l-2 ${accent}` : ""} ${
        onClick
          ? "cursor-pointer transition-all duration-200 hover:shadow-md hover:border-border active:scale-[0.99]"
          : ""
      }`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground tracking-wide flex items-center gap-1.5">
            {label}
            {info && (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`About ${label}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed normal-case font-normal tracking-normal">
                  {info}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          {icon && <span className="text-muted-foreground/70">{icon}</span>}
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {change && (
          <div className={`text-xs mt-2 flex items-center gap-1 ${
            changeType === "positive" ? "text-emerald-500" : changeType === "negative" ? "text-red-400" : "text-muted-foreground"
          }`}>
            {changeType === "positive" && <TrendingUp className="w-3 h-3" />}
            {changeType === "negative" && <TrendingDown className="w-3 h-3" />}
            {change}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (onClick) {
    return (
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>{card}</TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Click to view details
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return card;
}
