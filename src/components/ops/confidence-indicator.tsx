import { Badge } from "@/components/ui/badge";

function getConfidenceInfo(confidence: number): { label: string; color: string } {
  if (confidence >= 0.9) return { label: "Very High", color: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" };
  if (confidence >= 0.75) return { label: "High", color: "bg-green-600/20 text-green-400 border-green-600/30" };
  if (confidence >= 0.5) return { label: "Moderate", color: "bg-amber-600/20 text-amber-400 border-amber-600/30" };
  if (confidence >= 0.3) return { label: "Low", color: "bg-orange-600/20 text-orange-400 border-orange-600/30" };
  return { label: "Very Low", color: "bg-red-600/20 text-red-400 border-red-600/30" };
}

export function ConfidenceIndicator({ confidence, showPercent = false }: { confidence: number; showPercent?: boolean }) {
  const info = getConfidenceInfo(confidence);
  return (
    <Badge variant="outline" className={`${info.color} text-[10px]`}>
      {showPercent ? `${Math.round(confidence * 100)}%` : info.label}
    </Badge>
  );
}

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const barColor = confidence >= 0.75 ? "bg-emerald-500" : confidence >= 0.5 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}
