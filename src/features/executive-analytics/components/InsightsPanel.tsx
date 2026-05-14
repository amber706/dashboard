// InsightsPanel — surfaces Claude-generated prescriptive recommendations
// based on the current dashboard snapshot. Fires on-demand (manager
// clicks "Generate insights") rather than on every page load so we
// don't burn Anthropic calls when the dashboard is just being
// glanced at.

import { Sparkles, Loader2, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AnalyticsInsight } from "../api/client";

interface Props {
  insights: AnalyticsInsight[] | null;
  generatedAt: string | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
}

export function InsightsPanel({ insights, generatedAt, loading, error, onGenerate }: Props) {
  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-semibold">AI Insights — areas of weakness + how to improve</span>
          </div>
          <div className="flex items-center gap-2">
            {generatedAt && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(generatedAt).toLocaleTimeString()}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={onGenerate}
              disabled={loading}
            >
              {loading
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing…</>
                : insights
                  ? <><Sparkles className="w-3 h-3" /> Refresh</>
                  : <><Sparkles className="w-3 h-3" /> Generate insights</>}
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {!insights && !loading && !error && (
          <p className="text-[11px] text-muted-foreground italic">
            Click <strong>Generate insights</strong> to have Claude analyze the current snapshot and recommend 3-5 specific actions ordered by impact.
          </p>
        )}

        {loading && (
          <div className="space-y-2">
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
          </div>
        )}

        {insights && insights.length > 0 && (
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <InsightRow key={i} insight={ins} index={i + 1} />
            ))}
          </div>
        )}

        {insights && insights.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            Claude didn't surface any actionable weaknesses — the pipeline looks healthy in this window.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight, index }: { insight: AnalyticsInsight; index: number }) {
  const sev = insight.severity;
  const palette = sev === "critical"
    ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
    : sev === "warning"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
      : "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400";
  const Icon = sev === "critical" ? AlertTriangle : sev === "warning" ? AlertCircle : Info;
  return (
    <div className={`rounded-md border ${palette} px-3 py-2.5 space-y-1.5`}>
      <div className="flex items-start gap-2">
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold opacity-70">
              #{index} · {insight.area}
            </span>
            <Badge variant="outline" className="text-[9px] uppercase">
              {sev}
            </Badge>
          </div>
          <div className="text-xs text-foreground/90 leading-relaxed">
            {insight.observation}
          </div>
          <div className="text-xs leading-relaxed mt-1.5">
            <span className="font-semibold">Action: </span>
            <span className="text-foreground/90">{insight.action}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
