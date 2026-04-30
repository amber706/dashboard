import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getConfidenceLabel, getScoreColor } from "@/lib/design-tokens";
import { Award, TrendingUp, CheckCircle2, AlertTriangle, Shield, Lightbulb } from "lucide-react";

const SCORE_CATEGORIES = [
  { key: "qualification_completeness", label: "Qualification", icon: "📋" },
  { key: "rapport_empathy", label: "Rapport & Empathy", icon: "🤝" },
  { key: "objection_handling", label: "Objection Handling", icon: "💬" },
  { key: "urgency_handling", label: "Urgency Handling", icon: "⏱️" },
  { key: "next_step_clarity", label: "Next-Step Clarity", icon: "🎯" },
  { key: "script_adherence", label: "Script Adherence", icon: "📝" },
  { key: "compliance", label: "Compliance", icon: "🛡️" },
  { key: "booking_transfer", label: "Booking/Transfer", icon: "📅" },
  { key: "overall_quality", label: "Overall Quality", icon: "⭐" },
];

interface CallScoreData {
  total_score: number;
  max_score?: number;
  confidence?: number;
  categories?: Record<string, number>;
  quality_signals?: string[];
  compliance_flags?: string[];
  coaching_takeaways?: { well?: string[]; improve?: string[] };
  trend?: { direction: "up" | "down" | "flat"; delta?: number };
}

export function CallScoreCard({ data, compact = false }: { data: CallScoreData; compact?: boolean }) {
  const maxScore = data.max_score || 100;
  const pct = Math.round((data.total_score / maxScore) * 100);

  return (
    <Card>
      <CardHeader className={compact ? "pb-2 p-4" : "pb-3"}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-4 h-4 text-primary" />
            Call Score
          </CardTitle>
          {data.confidence !== undefined && (
            <Badge variant="outline" className="text-[10px]">{getConfidenceLabel(data.confidence)}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className={compact ? "p-4 pt-0" : ""}>
        <div className="flex items-end gap-3 mb-4">
          <span className={`text-4xl font-bold tracking-tight ${getScoreColor(data.total_score, maxScore)}`}>{data.total_score}</span>
          <span className="text-sm text-muted-foreground mb-1">/ {maxScore}</span>
          {data.trend && (
            <div className={`flex items-center gap-1 text-xs mb-1.5 ${data.trend.direction === "up" ? "text-green-600" : data.trend.direction === "down" ? "text-red-600" : "text-muted-foreground"}`}>
              <TrendingUp className={`w-3 h-3 ${data.trend.direction === "down" ? "rotate-180" : ""}`} />
              {data.trend.delta !== undefined ? `${data.trend.delta > 0 ? "+" : ""}${data.trend.delta}` : data.trend.direction}
            </div>
          )}
        </div>

        <div className="w-full bg-muted rounded-full h-2 mb-4">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>

        {!compact && data.categories && (
          <div className="space-y-2 mb-4">
            {SCORE_CATEGORIES.map((cat) => {
              const score = data.categories?.[cat.key];
              if (score === undefined) return null;
              return (
                <div key={cat.key} className="flex items-center gap-3">
                  <span className="text-xs w-32 text-muted-foreground truncate">{cat.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${score >= 8 ? "bg-green-500" : score >= 6 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${(score / 10) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-6 text-right">{score}</span>
                </div>
              );
            })}
          </div>
        )}

        {data.quality_signals && data.quality_signals.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              <span className="text-xs font-medium text-muted-foreground">Quality Signals</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.quality_signals.map((sig, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] bg-green-50 text-green-700 border-green-200">{sig}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.compliance_flags && data.compliance_flags.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-3 h-3 text-amber-500" />
              <span className="text-xs font-medium text-muted-foreground">Compliance Flags</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.compliance_flags.map((flag, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{flag}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.coaching_takeaways && (
          <CoachingTakeaways data={data.coaching_takeaways} />
        )}
      </CardContent>
    </Card>
  );
}

export function CoachingTakeaways({ data }: { data: { well?: string[]; improve?: string[] } }) {
  return (
    <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coaching Takeaways</span>
      </div>
      {data.well && data.well.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-green-600 uppercase tracking-wider">What went well</span>
          <ul className="mt-1 space-y-1">
            {data.well.map((item, i) => (
              <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.improve && data.improve.length > 0 && (
        <div>
          <span className="text-[10px] font-medium text-amber-600 uppercase tracking-wider">What to improve</span>
          <ul className="mt-1 space-y-1">
            {data.improve.map((item, i) => (
              <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
