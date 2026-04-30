import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  loading?: boolean;
  accent?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, change, changeType = "neutral", loading, accent, onClick }: StatCardProps) {
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
          <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
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
