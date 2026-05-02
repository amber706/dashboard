import { type ReactNode } from "react";
import { GradientWord } from "./SectionHeader";

interface PageShellProps {
  /** Two-digit section number, e.g. "00" */
  number?: string;
  /** Eyebrow label, uppercased */
  eyebrow?: string;
  /** Eyebrow color tone */
  eyebrowAccent?: "blue" | "coral" | "muted";
  /**
   * Page title — render as a string and the wrapper auto-renders it as
   * <h1>; the last word gets the CHC gradient treatment by default.
   * Pass a ReactNode for full control (e.g. add an icon).
   */
  title: ReactNode;
  /** When `title` is a string, the last word gets the gradient unless
   *  this is set to false. Ignored if `title` is a ReactNode. */
  emphasizeLastWord?: boolean;
  /** One-line subtitle / description below the title */
  subtitle?: ReactNode;
  /** Right-side actions (e.g. refresh button, export CSV) */
  actions?: ReactNode;
  /** Page body */
  children: ReactNode;
  /** Optional max-width override; default 1400 */
  maxWidth?: 1200 | 1400 | 1600;
}

const EYEBROW_TONE: Record<string, string> = {
  blue:  "text-[#5BA3D4]",
  coral: "text-[#E89077]",
  muted: "text-[#6E7E9E]",
};

/**
 * Standard page wrapper for every ops/admin page in the v2 design.
 * Provides:
 *   - consistent container padding + max-width
 *   - eyebrow + Fraunces gradient title + brand divider
 *   - subtitle + actions slot
 *   - vertical rhythm via space-y-8
 *
 * Usage:
 *   <PageShell number="00" eyebrow="QUEUE" title="Callback queue" subtitle="...">
 *     <Section>...</Section>
 *   </PageShell>
 */
export function PageShell({
  number,
  eyebrow,
  eyebrowAccent = "blue",
  title,
  emphasizeLastWord = true,
  subtitle,
  actions,
  children,
  maxWidth = 1400,
}: PageShellProps) {
  const eyebrowText = number && eyebrow ? `${number} — ${eyebrow}` : (eyebrow ?? number);
  const renderedTitle = (() => {
    if (typeof title !== "string") return title;
    if (!emphasizeLastWord) return title;
    const words = title.trim().split(/\s+/);
    if (words.length < 2) return <GradientWord>{title}.</GradientWord>;
    const last = words.pop()!;
    return (
      <>
        {words.join(" ")} <GradientWord>{last}.</GradientWord>
      </>
    );
  })();

  const widthClass = maxWidth === 1200 ? "max-w-[1200px]"
    : maxWidth === 1600 ? "max-w-[1600px]"
    : "max-w-[1400px]";

  return (
    <div className={`px-4 sm:px-6 lg:px-8 py-8 ${widthClass} mx-auto space-y-8`}>
      <header>
        {eyebrowText && (
          <div className="mb-3"><span className={`eyebrow ${EYEBROW_TONE[eyebrowAccent]}`}>{eyebrowText}</span></div>
        )}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="font-display text-[40px] sm:text-[48px] font-normal leading-[0.98] tracking-[-0.025em] text-[#F4EFE6]">
            {renderedTitle}
          </h1>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {subtitle && (
          <p className="mt-3 text-[15px] text-[#A6B5D0] max-w-2xl leading-relaxed">{subtitle}</p>
        )}
        <div className="chc-divider mt-6 max-w-md opacity-80" />
      </header>
      {children}
    </div>
  );
}
