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
  muted: "text-[#9AABC9]",
};

export function SectionHeader({
  number,
  eyebrow,
  title,
  subtitle,
  actions,
  eyebrowAccent: _eyebrowAccent,
}: SectionHeaderProps) {
  void _eyebrowAccent; // accent kept on the type for caller compatibility
  // Plain Inter, matches the home dashboard. No serif, no gradient, no
  // numbered prefix — the eyebrow is just a small uppercased label.
  const eyebrowText = number && eyebrow ? `${number} — ${eyebrow}` : (eyebrow ?? number);
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="space-y-1">
        {eyebrowText && (
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrowText}
          </div>
        )}
        <h2 className="text-base font-semibold flex items-center gap-2">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
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
