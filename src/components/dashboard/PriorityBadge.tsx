import { Flame } from "lucide-react";

type Priority = "critical" | "high" | "medium" | "low";

const PRIORITY_TONE: Record<Priority, string> = {
  critical: "bg-[#E89077]/20 border-[#E89077]/50 text-[#E89077]",
  high:     "bg-[#E89077]/15 border-[#E89077]/40 text-[#E89077]",
  medium:   "bg-[#E5C879]/15 border-[#E5C879]/40 text-[#E5C879]",
  low:      "bg-[#5BA3D4]/12 border-[#5BA3D4]/30 text-[#5BA3D4]",
};

/**
 * Single compact priority pill used on RecommendationCard rows.
 * Visually replaces the older two-pill (orange + green) treatment that
 * was a bug in the previous design. High and critical get a flame glyph.
 */
export function PriorityBadge({ priority }: { priority: string }) {
  const norm = (priority?.toLowerCase() as Priority) || "low";
  const tone = PRIORITY_TONE[norm] ?? PRIORITY_TONE.low;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {(norm === "high" || norm === "critical") && <Flame className="w-2.5 h-2.5" />}
      {norm}
    </span>
  );
}
