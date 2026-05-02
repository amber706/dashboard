import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Status = "pending" | "acknowledged" | "resolved" | "open" | "dismissed" | "closed";

interface MetaChip {
  /** Lucide icon component, e.g. Phone, Clock, MapPin */
  icon?: LucideIcon;
  /** Short label, e.g. "+18002738255" or "38m 37s" */
  label: ReactNode;
  /** Optional descriptor for screen readers ("phone", "duration") */
  srLabel?: string;
  /** Use mono font (good for phone numbers, IDs) */
  mono?: boolean;
  /** Make label muted (less important) */
  muted?: boolean;
}

interface IncidentCardProps {
  severity: Severity;
  category?: string;            // e.g. "Self-harm", "Compliance flag"
  status?: Status;
  /** Title of the incident — Fraunces, prominent */
  title?: ReactNode;
  /** Row 1 timing chips: usually [date, duration]. Right-aligned. */
  timingChips?: MetaChip[];
  /** Row 2 context chips: caller, specialist, location, call id, recording. */
  contextChips?: MetaChip[];
  /** Body — typically a transcript quote or summary. Larger + readable, not muted. */
  body?: ReactNode;
  /** Pinned hint after the body (e.g. "From your manager: foo"). */
  pinnedNote?: ReactNode;
  /** Actions — rendered on the right of the timing row + at the bottom of the card */
  actions?: ReactNode;
  /** Default expanded; collapse caret only shown when expandable=true */
  expandable?: boolean;
  defaultExpanded?: boolean;
  /** Body shown only when expanded (full transcript, all rubric scores, etc.) */
  expandedBody?: ReactNode;
  /** Click anywhere on the header drills into the row */
  onClick?: () => void;
  /** ARIA label for the whole card */
  ariaLabel?: string;
}

const SEVERITY_BAR_CLASS: Record<Severity, string> = {
  critical: "danger",
  high:     "danger",
  medium:   "warning",
  low:      "info",
  info:     "info",
};

const SEVERITY_PILL: Record<Severity, string> = {
  critical: "bg-[#E89077]/20 border-[#E89077]/55 text-[#E89077]",
  high:     "bg-[#E89077]/15 border-[#E89077]/45 text-[#E89077]",
  medium:   "bg-[#E5C879]/15 border-[#E5C879]/40 text-[#E5C879]",
  low:      "bg-[#5BA3D4]/12 border-[#5BA3D4]/30 text-[#5BA3D4]",
  info:     "bg-[#5BA3D4]/12 border-[#5BA3D4]/30 text-[#5BA3D4]",
};

const STATUS_PILL: Record<Status, string> = {
  pending:      "bg-[#E5C879]/12 border-[#E5C879]/35 text-[#E5C879]",
  open:         "bg-[#5BA3D4]/12 border-[#5BA3D4]/30 text-[#5BA3D4]",
  acknowledged: "bg-[#A98FA8]/15 border-[#A98FA8]/35 text-[#A98FA8]",
  resolved:     "bg-[#10B981]/12 border-[#10B981]/35 text-[#10B981]",
  closed:       "bg-[#3D4E6E]/30 border-[#3D4E6E]/50 text-[#A6B5D0]",
  dismissed:    "bg-[#3D4E6E]/30 border-[#3D4E6E]/50 text-[#6E7E9E]",
};

const SEVERITY_GLOW: Record<Severity, string> = {
  critical: "danger-glow",
  high:     "danger-glow",
  medium:   "",
  low:      "",
  info:     "",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ${tone}`}>
      {children}
    </span>
  );
}

function ChipRow({ chips, align = "left" }: { chips: MetaChip[]; align?: "left" | "right" }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] ${align === "right" ? "justify-end" : ""}`}>
      {chips.map((c, i) => {
        const Icon = c.icon;
        return (
          <span key={i} className={`flex items-center gap-1 ${c.muted ? "text-[#6E7E9E]" : "text-[#A6B5D0]"} ${c.mono ? "font-mono" : ""}`}>
            {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
            {c.srLabel && <span className="sr-only">{c.srLabel}: </span>}
            {c.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Standard incident-style card used for High-Priority Alerts, QA review,
 * AI Bot Feedback, callback queue, abandoned-calls, etc.
 *
 * Visual structure:
 *   [severity bar at top edge, color-coded]
 *   ROW 1:  [severity pill] [category pill] [status pill] ─── [timing chips]
 *   TITLE:  Fraunces serif, prominent
 *   ROW 2:  [caller] [specialist] [location] [call id] [recording]
 *   BODY:   transcript quote / summary at readable size + line-height
 *   PIN:    optional note (manager coaching, why it triggered, etc.)
 *   ACTIONS: review / acknowledge / resolve / open
 */
export function IncidentCard({
  severity,
  category,
  status,
  title,
  timingChips,
  contextChips,
  body,
  pinnedNote,
  actions,
  expandable,
  defaultExpanded,
  expandedBody,
  onClick,
  ariaLabel,
}: IncidentCardProps) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);

  return (
    <article
      className={`glass rounded-2xl relative overflow-hidden ${SEVERITY_GLOW[severity]} ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className={`severity-bar ${SEVERITY_BAR_CLASS[severity]}`} aria-hidden="true" />

      <div className="p-5 space-y-3">
        {/* ROW 1: Severity / Category / Status pills + timing chips on the right */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {expandable && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="text-[#6E7E9E] hover:text-[#F4EFE6] transition-colors -ml-1 mr-0.5"
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            )}
            <Pill tone={SEVERITY_PILL[severity]}>{severity}</Pill>
            {category && <Pill tone="bg-[#0F2549] border-[#1B335F] text-[#A6B5D0]">{category}</Pill>}
            {status && <Pill tone={STATUS_PILL[status]}>{status}</Pill>}
          </div>
          {timingChips && timingChips.length > 0 && <ChipRow chips={timingChips} align="right" />}
        </div>

        {/* TITLE — Fraunces serif at a readable display size */}
        {title && (
          <h3 className="font-display text-[18px] font-normal tracking-[-0.005em] text-[#F4EFE6] leading-snug">
            {title}
          </h3>
        )}

        {/* ROW 2: Context chips — caller, specialist, location, call id, recording */}
        {contextChips && contextChips.length > 0 && <ChipRow chips={contextChips} />}

        {/* BODY — transcript quote or summary at primary text contrast */}
        {body && (
          <div className="bg-[#050E24]/60 border border-[#11244A] rounded-lg px-3.5 py-2.5">
            <div className="text-[13.5px] text-[#F4EFE6] leading-[1.55]">{body}</div>
          </div>
        )}

        {/* Pinned note (manager coaching, etc.) */}
        {pinnedNote && (
          <div className="border-l-2 border-[#E5C879] pl-3 text-[12.5px] text-[#A6B5D0]">
            {pinnedNote}
          </div>
        )}

        {/* Expanded extras — full transcript, rubric, etc. */}
        {expandable && expanded && expandedBody && (
          <div className="pt-1 border-t border-[#11244A]">{expandedBody}</div>
        )}

        {/* Actions */}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
        )}
      </div>
    </article>
  );
}
