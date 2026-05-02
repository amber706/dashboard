import { type ReactNode } from "react";

interface SectionHeaderProps {
  /** Two-digit section number, e.g. "01" — rendered in the eyebrow */
  number?: string;
  /** Eyebrow text (uppercased automatically by .eyebrow) */
  eyebrow?: string;
  /** Display title — Fraunces */
  title: ReactNode;
  /** Optional gradient-emphasis word inside the title; when used, render
      <SectionHeader title={<>Operations <GradientWord>Overview.</GradientWord></>} /> */
  subtitle?: ReactNode;
  /** Right-side actions like a "View all →" link */
  actions?: ReactNode;
  /** Optional accent color for the eyebrow (default CHC blue) */
  eyebrowAccent?: "blue" | "coral" | "muted";
}

const EYEBROW_TONE: Record<string, string> = {
  blue:  "text-[#5BA3D4]",
  coral: "text-[#E89077]",
  muted: "text-[#6E7E9E]",
};

export function SectionHeader({
  number,
  eyebrow,
  title,
  subtitle,
  actions,
  eyebrowAccent = "blue",
}: SectionHeaderProps) {
  const eyebrowText = number && eyebrow ? `${number} — ${eyebrow}` : (eyebrow ?? number);
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        {eyebrowText && (
          <div className={`eyebrow ${EYEBROW_TONE[eyebrowAccent]} mb-1.5`}>
            {eyebrowText}
          </div>
        )}
        <h2 className="font-display text-[28px] font-normal tracking-[-0.02em] text-[#F4EFE6] flex items-center gap-2.5">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-[13.5px] text-[#A6B5D0]">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/** Wraps text in the CHC sky-blue → lavender → coral gradient — for in-line emphasis
    inside a SectionHeader title. NOT italicized per design rules. */
export function GradientWord({ children }: { children: ReactNode }) {
  return <span className="text-chc-gradient">{children}</span>;
}
