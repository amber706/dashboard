/**
 * Role-aware label helper for the reporting dashboards.
 *
 * The Phase 2 brief calls for KPI tiles and section headers to read "Your X"
 * for specialists and "Team X" for managers / admins. RLS enforces the data
 * scoping server-side; this helper only adjusts copy.
 *
 * Used by `/src/components/reporting/KPICard.tsx` and the page itself.
 * Do NOT hardcode "Your" / "Team" prefixes elsewhere — pull through here so
 * any future copy rules (e.g. supervisor-of-team) live in one place.
 */

import type { UserRole } from "@/lib/auth-context";

/**
 * Return the role-adjusted version of a metric / section label.
 *
 * NOTE: The auth context's UserRole enum is "rep" | "manager" | "admin".
 * CLAUDE.md uses the term "specialist" in narrative copy, but the TS type
 * uses "rep". We map "rep" → "Your" / others → "Team" here so callers can
 * keep the auth role as-is without translating.
 *
 *   roleLabel("rep",     "MQLs")           → "Your MQLs"
 *   roleLabel("manager", "MQLs")           → "Team MQLs"
 *   roleLabel("admin",   "MQLs")           → "Team MQLs"
 *   roleLabel("rep",     "Missed-call rate") → "Your missed-call rate"
 *
 * The first word of the label keeps its case; subsequent words pass through
 * unchanged so phrases like "Missed-call rate" don't get sentence-cased.
 */
export function roleLabel(role: UserRole | null | undefined, label: string): string {
  const prefix = role === "rep" ? "Your" : "Team";
  if (!label) return prefix;
  // Lower-case the first character of the label so "MQLs" → "MQLs" stays
  // upper but "Missed-call rate" stays lower. We special-case acronyms by
  // checking whether the first two chars are both upper.
  const first = label[0];
  const second = label[1] ?? "";
  const looksLikeAcronym = first === first.toUpperCase() && second === second.toUpperCase();
  const tail = looksLikeAcronym ? label : label[0].toLowerCase() + label.slice(1);
  return `${prefix} ${tail}`;
}

/**
 * Subtitle for the page header. Singular hook the page calls once.
 *   "rep" → "Your performance"
 *   "manager"/"admin" → "Team performance"
 */
export function pageSubtitle(role: UserRole | null | undefined): string {
  return role === "rep" ? "Your performance" : "Team performance";
}

/** True for roles that get the by-rep + closed-lost-by-rep sections. */
export function showsByRepSections(role: UserRole | null | undefined): boolean {
  return role === "manager" || role === "admin";
}
