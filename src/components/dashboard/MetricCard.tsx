import { ChevronUp, ChevronDown, Check, type LucideIcon } from "lucide-react";

export type Severity = "info" | "success" | "warning" | "danger" | "neutral";

interface MetricCardProps {
  label: string;
  value: number | string;
  /** Severity drives the colored top-edge bar + icon-tile color */
  severity?: Severity;
  /** Optional small icon (lucide-react component) shown top-right */
  icon?: LucideIcon;
  /** Optional change indicator e.g. "+12% vs yesterday" */
  delta?: { value: string; direction: "up" | "down" | "flat"; vs?: string };
  /** Optional sparkline data — array of numbers; placeholder sine wave used when omitted */
  sparkline?: number[];
  /** Click handler if the card is a drill-down */
  onClick?: () => void;
  /** When value is 0 AND severity is success, show a subtle check glyph */
  successCheck?: boolean;
}

const SEVERITY_TONE: Record<Severity, { bar: string; iconBg: string; iconText: string; glow?: string }> = {
  info:    { bar: "info",    iconBg: "bg-[#5BA3D4]/10", iconText: "text-[#5BA3D4]" },
  success: { bar: "success", iconBg: "bg-[#10B981]/10", iconText: "text-[#10B981]" },
  warning: { bar: "warning", iconBg: "bg-[#E5C879]/10", iconText: "text-[#E5C879]" },
  danger:  { bar: "danger",  iconBg: "bg-[#E89077]/10", iconText: "text-[#E89077]", glow: "danger-glow" },
  neutral: { bar: "info",    iconBg: "bg-[#0F2549]",    iconText: "text-[#C5D2E5]" },
};

const DELTA_COLOR: Record<string, string> = {
  up:   "text-[#10B981]",
  down: "text-[#E89077]",
  flat: "text-[#9AABC9]",
};

export function MetricCard({
  label,
  value,
  severity = "neutral",
  icon: Icon,
  delta,
  sparkline,
  onClick,
  successCheck,
}: MetricCardProps) {
  const tone = SEVERITY_TONE[severity];
  const points = sparkline && sparkline.length > 1
    ? sparkline
    : Array.from({ length: 12 }, (_, i) => 50 + Math.sin(i / 1.6) * 15 + (i % 3) * 4);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const norm = points.map((p, i) => ({
    x: (i / (points.length - 1)) * 50,
    y: 18 - ((p - min) / range) * 16,
  }));
  const path = norm.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L50,20 L0,20 Z`;
  const sparkColor = severity === "danger" ? "#E89077"
    : severity === "warning" ? "#E5C879"
    : severity === "success" ? "#10B981"
    : "#5BA3D4";

  const showSuccessCheck = successCheck && severity === "success" && (value === 0 || value === "0");

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={`glass rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all duration-150 relative overflow-hidden text-left w-full ${tone.glow ?? ""} ${onClick ? "cursor-pointer" : ""}`}
    >
      <span className={`severity-bar ${tone.bar}`} aria-hidden="true" />

      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-[12px] text-[#C5D2E5] leading-snug">{label}</span>
        {Icon && (
          <span className={`w-7 h-7 rounded-md ${tone.iconBg} ${tone.iconText} flex items-center justify-center shrink-0`}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[42px] font-normal tracking-[-0.02em] leading-none text-[#F4EFE6] tabular-nums">
            {value}
          </span>
          {showSuccessCheck && <Check className="w-4 h-4 text-[#10B981] mb-1" />}
        </div>

        {/* Sparkline */}
        <svg viewBox="0 0 50 20" className="w-[60px] h-[22px] shrink-0" aria-hidden="true">
          <defs>
            <linearGradient id={`spark-${label.replace(/\s+/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sparkColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={sparkColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#spark-${label.replace(/\s+/g, "")})`} />
          <path d={path} fill="none" stroke={sparkColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {delta && (
        <div className={`text-[11px] font-medium mt-2 flex items-center gap-1 ${DELTA_COLOR[delta.direction]}`}>
          {delta.direction === "up" && <ChevronUp className="w-3 h-3" />}
          {delta.direction === "down" && <ChevronDown className="w-3 h-3" />}
          <span>{delta.value}</span>
          {delta.vs && <span className="text-[#9AABC9] font-normal">{delta.vs}</span>}
        </div>
      )}
    </Wrapper>
  );
}
