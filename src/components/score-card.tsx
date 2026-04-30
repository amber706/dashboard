import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getConfidenceLabel, getScoreColor } from "@/lib/design-tokens";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ScoreCardProps {
  title: string;
  score: number;
  maxScore?: number;
  confidence?: number;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function ScoreCard({ title, score, maxScore = 100, confidence, trend, trendValue, subtitle, icon, size = "md" }: ScoreCardProps) {
  const colorClass = getScoreColor(score, maxScore);
  const pct = Math.round((score / maxScore) * 100);

  return (
    <Card className="overflow-hidden">
      <CardContent className={size === "sm" ? "p-4" : "p-6"}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
          </div>
          {confidence !== undefined && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              {getConfidenceLabel(confidence)}
            </Badge>
          )}
        </div>
        <div className="flex items-end gap-3">
          <span className={`${size === "lg" ? "text-4xl" : size === "sm" ? "text-2xl" : "text-3xl"} font-bold tracking-tight ${colorClass}`}>
            {score}
          </span>
          <span className="text-sm text-muted-foreground mb-1">/ {maxScore}</span>
          {trend && (
            <div className={`flex items-center gap-1 text-xs mb-1 ${trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
              {trend === "up" ? <TrendingUp className="w-3 h-3" /> : trend === "down" ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {trendValue}
            </div>
          )}
        </div>
        <div className="mt-3 w-full bg-muted rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-500" : pct >= 40 ? "bg-orange-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: React.ReactNode;
}

export function MetricCard({ label, value, change, changeType = "neutral", icon }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {change && (
          <div className={`text-xs mt-1 ${changeType === "positive" ? "text-green-600" : changeType === "negative" ? "text-red-600" : "text-muted-foreground"}`}>
            {change}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
