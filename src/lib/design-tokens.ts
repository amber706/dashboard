export const colors = {
  success: {
    50: "#f0fdf4",
    100: "#dcfce7",
    500: "#22c55e",
    600: "#16a34a",
    700: "#15803d",
  },
  warning: {
    50: "#fffbeb",
    100: "#fef3c7",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309",
  },
  danger: {
    50: "#fef2f2",
    100: "#fee2e2",
    500: "#ef4444",
    600: "#dc2626",
    700: "#b91c1c",
  },
  info: {
    50: "#eff6ff",
    100: "#dbeafe",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
  },
  tier: {
    hot: "#ef4444",
    warm: "#f59e0b",
    cool: "#3b82f6",
    cold: "#6b7280",
  },
} as const;

export const spacing = {
  section: "space-y-8",
  card: "p-6",
  cardCompact: "p-5",
  gap: "gap-5",
  gapLg: "gap-6",
} as const;

export const typography = {
  pageTitle: "text-2xl font-semibold tracking-tight",
  pageSubtitle: "text-base text-muted-foreground mt-1.5 leading-relaxed",
  sectionTitle: "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
  cardTitle: "text-base font-semibold",
  label: "text-xs font-medium text-muted-foreground tracking-wide",
  value: "text-sm font-medium",
  valueLg: "text-3xl font-bold tracking-tight",
  body: "text-sm leading-relaxed",
  caption: "text-xs text-muted-foreground",
} as const;

export const motion = {
  fast: "transition-all duration-150 ease-out",
  normal: "transition-all duration-200 ease-out",
  slow: "transition-all duration-300 ease-out",
  spring: "transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
} as const;

export type QualityTier = "hot" | "warm" | "cool" | "cold";

export function getTierColor(tier: QualityTier) {
  return colors.tier[tier] || colors.tier.cold;
}

export function getTierLabel(tier: QualityTier) {
  const labels: Record<QualityTier, string> = {
    hot: "Hot Lead",
    warm: "Warm Lead",
    cool: "Cool Lead",
    cold: "Cold Lead",
  };
  return labels[tier] || "Unknown";
}

export function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "Very High";
  if (confidence >= 0.75) return "High";
  if (confidence >= 0.5) return "Moderate";
  if (confidence >= 0.3) return "Low";
  return "Very Low";
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return "text-green-600";
  if (confidence >= 0.75) return "text-emerald-600";
  if (confidence >= 0.5) return "text-amber-600";
  if (confidence >= 0.3) return "text-orange-600";
  return "text-red-600";
}

export function getScoreColor(score: number, max = 100): string {
  const pct = score / max;
  if (pct >= 0.8) return "text-green-600";
  if (pct >= 0.6) return "text-amber-600";
  if (pct >= 0.4) return "text-orange-600";
  return "text-red-600";
}

export function getScoreBg(score: number, max = 100): string {
  const pct = score / max;
  if (pct >= 0.8) return "bg-green-50 border-green-200";
  if (pct >= 0.6) return "bg-amber-50 border-amber-200";
  if (pct >= 0.4) return "bg-orange-50 border-orange-200";
  return "bg-red-50 border-red-200";
}
