import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Zap, Loader2 } from "lucide-react";
import { PriorityBadge } from "./PriorityBadge";

interface RecommendationCardProps {
  priority: string;
  title: string;
  summary: string;
  /** Inline metadata chips shown under the summary (phone, caller, time, score, etc.) */
  meta?: ReactNode;
  /** Body shown when expanded — typically AI Reasoning + Transcript snippet panels */
  expandedContent?: ReactNode;
  /** Default-collapsed unless this is true */
  defaultExpanded?: boolean;
  /** Action handlers — Act is visually dominant; Acknowledge secondary; Dismiss tertiary */
  onAct?: () => void;
  onAcknowledge?: () => void;
  onDismiss?: () => void;
  /** Loading state for any of the three actions */
  loading?: "act" | "acknowledge" | "dismiss" | null;
  /** ARIA-friendly label, e.g. "Drill recommended for Dana Hall" */
  ariaLabel?: string;
}

export function RecommendationCard({
  priority,
  title,
  summary,
  meta,
  expandedContent,
  defaultExpanded,
  onAct,
  onAcknowledge,
  onDismiss,
  loading,
  ariaLabel,
}: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);

  return (
    <article
      className={`rounded-2xl transition-all duration-150 ${
        expanded ? "border-gradient-brand" : "glass"
      }`}
      aria-label={ariaLabel}
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 shrink-0 text-[#6E7E9E] hover:text-[#F4EFE6] transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse recommendation" : "Expand recommendation"}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <PriorityBadge priority={priority} />
              <h3 className="font-display text-[18px] font-normal tracking-[-0.005em] text-[#F4EFE6] leading-snug">
                {title}
              </h3>
            </div>
            <p className="text-[13.5px] text-[#A6B5D0] leading-relaxed">{summary}</p>
            {meta && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#6E7E9E]">
                {meta}
              </div>
            )}
          </div>
        </div>

        {expanded && expandedContent && (
          <div className="mt-4 pl-7">{expandedContent}</div>
        )}

        {(onAct || onAcknowledge || onDismiss) && (
          <div className="mt-4 pl-7 flex items-center gap-2 flex-wrap">
            {onAct && (
              <button
                type="button"
                onClick={onAct}
                disabled={loading === "act"}
                className="bg-chc-gradient-diag text-white text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity shadow-[0_0_0_1px_rgba(232,144,119,0.3),_0_8px_32px_rgba(91,163,212,0.25)]"
                aria-label="Act on recommendation"
              >
                {loading === "act" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Act
              </button>
            )}
            {onAcknowledge && (
              <button
                type="button"
                onClick={onAcknowledge}
                disabled={loading === "acknowledge"}
                className="border border-[#1B335F] text-[#A6B5D0] text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg hover:bg-[#0F2549] hover:text-[#F4EFE6] disabled:opacity-50 transition-colors"
              >
                {loading === "acknowledge" ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                Acknowledge
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                disabled={loading === "dismiss"}
                className="text-[#6E7E9E] hover:text-[#A6B5D0] text-[12.5px] font-medium px-2 py-1.5 disabled:opacity-50 transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Two-up panel layout for AI Reasoning + Transcript Snippet inside an expanded card */
export function ReasoningPanels({
  reasoning,
  transcript,
}: {
  reasoning?: ReactNode;
  transcript?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {reasoning && (
        <div className="bg-[#050E24]/60 border border-[#11244A] rounded-lg p-3">
          <div className="eyebrow text-[#5BA3D4] mb-2">AI Reasoning</div>
          <div className="text-[12.5px] text-[#A6B5D0] leading-relaxed">{reasoning}</div>
        </div>
      )}
      {transcript && (
        <div className="bg-[#050E24]/60 border border-[#11244A] rounded-lg p-3">
          <div className="eyebrow text-[#A6B5D0] mb-2">Transcript Snippet</div>
          <div className="text-[12.5px] text-[#A6B5D0] leading-relaxed">{transcript}</div>
        </div>
      )}
    </div>
  );
}
