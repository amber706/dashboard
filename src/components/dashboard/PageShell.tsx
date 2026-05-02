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
  muted: "text-[#9AABC9]",
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
  eyebrowAccent = "muted",
  title,
  emphasizeLastWord: _emphasizeLastWord = false, // ignored — kept for prop compatibility
  subtitle,
  actions,
  children,
  maxWidth = 1400,
}: PageShellProps) {
  // Render rules match the home dashboard: plain Inter, text-2xl, semibold.
  // No GradientWord, no big serif headline, no brand divider — just a
  // standard page header. The eyebrow stays as a small uppercased label
  // for context.
  void _emphasizeLastWord;
  void GradientWord; // keep import alive for callers that still consume it
  const eyebrowText = number && eyebrow ? `${number} — ${eyebrow}` : (eyebrow ?? number);

  const widthClass = maxWidth === 1200 ? "max-w-[1200px]"
    : maxWidth === 1600 ? "max-w-[1600px]"
    : "max-w-[1400px]";

  return (
    <div className={`px-4 sm:px-6 lg:px-8 py-6 ${widthClass} mx-auto space-y-6`}>
      <header className="space-y-1">
        {eyebrowText && (
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrowText}
          </div>
        )}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold">
            {typeof title === "string" ? title : title}
          </h1>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground max-w-3xl">{subtitle}</p>
        )}
      </header>
      {children}
    </div>
  );
}
