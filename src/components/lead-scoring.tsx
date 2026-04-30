import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTierColor, type QualityTier } from "@/lib/design-tokens";
import { Flame, Clock, TrendingUp, Zap, Target } from "lucide-react";
import { useState, useEffect } from "react";

interface LeadScoreData {
  total_score: number;
  quality_tier: QualityTier;
  conversion_probability?: number;
  is_hot?: boolean;
  follow_up_sla_deadline?: string;
  score_drivers?: string[];
  score_history?: { date: string; score: number }[];
}

export function LeadScoreCard({ data, compact = false }: { data: LeadScoreData; compact?: boolean }) {
  const tierColor = getTierColor(data.quality_tier);

  return (
    <Card className={data.is_hot ? "border-red-300 bg-red-50/30" : ""}>
      <CardHeader className={compact ? "pb-2 p-4" : "pb-3"}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Lead Score
          </CardTitle>
          <TierBadge tier={data.quality_tier} />
        </div>
      </CardHeader>
      <CardContent className={compact ? "p-4 pt-0" : ""}>
        {data.is_hot && (
          <div className="flex items-center gap-2 mb-3 p-2 bg-red-100 border border-red-200 rounded-lg">
            <Flame className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-red-700">Hot Lead — Prioritize immediately</span>
          </div>
        )}

        <div className="flex items-end gap-3 mb-3">
          <span className="text-4xl font-bold tracking-tight" style={{ color: tierColor }}>{data.total_score}</span>
          <span className="text-sm text-muted-foreground mb-1">/ 100</span>
          {data.conversion_probability !== undefined && (
            <Badge variant="outline" className="mb-1.5 text-[10px] gap-1">
              <Zap className="w-2.5 h-2.5" />
              {Math.round(data.conversion_probability * 100)}% conversion
            </Badge>
          )}
        </div>

        {data.follow_up_sla_deadline && (
          <SLACountdown deadline={data.follow_up_sla_deadline} />
        )}

        {!compact && data.score_drivers && data.score_drivers.length > 0 && (
          <div className="mt-3">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Score Drivers</span>
            <ul className="mt-1.5 space-y-1">
              {data.score_drivers.map((driver, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <TrendingUp className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  {driver}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TierBadge({ tier, size = "sm" }: { tier: QualityTier; size?: "sm" | "md" }) {
  const styles: Record<QualityTier, string> = {
    hot: "bg-red-100 text-red-700 border-red-300",
    warm: "bg-amber-100 text-amber-700 border-amber-300",
    cool: "bg-blue-100 text-blue-700 border-blue-300",
    cold: "bg-gray-100 text-gray-700 border-gray-300",
  };
  const labels: Record<QualityTier, string> = {
    hot: "Hot",
    warm: "Warm",
    cool: "Cool",
    cold: "Cold",
  };

  return (
    <Badge variant="outline" className={`${styles[tier]} ${size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"} font-semibold`}>
      {tier === "hot" && <Flame className="w-3 h-3 mr-1" />}
      {labels[tier]}
    </Badge>
  );
}

function SLACountdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const end = new Date(deadline).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setRemaining("Overdue");
        setIsUrgent(true);
        return;
      }

      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setRemaining(`${hours}h ${mins}m`);
      setIsUrgent(hours < 1);
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [deadline]);

  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border ${isUrgent ? "bg-red-50 border-red-200" : "bg-muted/30 border-border"}`}>
      <Clock className={`w-3.5 h-3.5 ${isUrgent ? "text-red-500" : "text-muted-foreground"}`} />
      <span className={`text-xs font-medium ${isUrgent ? "text-red-700" : "text-muted-foreground"}`}>
        Follow-up SLA: {remaining}
      </span>
    </div>
  );
}
