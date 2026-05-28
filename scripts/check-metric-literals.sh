#!/usr/bin/env bash
#
# check-metric-literals.sh
#
# Phase 1A guard. Enforces that every pipeline / stage / source category /
# level-of-care string literal in the reporting subsystem is sourced from
# `src/lib/metrics/definitions.ts` — never inlined elsewhere.
#
# Scope: this script scans ONLY the reporting subsystem paths (the allowlist
# below). Legacy pre-reporting code is exempt. As Phase 1B and 1C land, the
# allowlist grows.
#
# Exit code: 0 = clean, 1 = at least one stray literal found.
#
# Usage:
#   bash scripts/check-metric-literals.sh
#   npm run lint:metrics

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Paths in scope. These are the directories the metric resolver, op_metric
# builders, and reporting components will live in. Edit this list as new
# reporting modules land.
SCOPE_PATHS=(
  "src/lib/metrics"
  # Phase 1B will add: "supabase/functions/sync_*", "supabase/functions/build_op_metrics"
  # Phase 1C will add: "src/components/reporting", "src/features/reporting", "src/pages/reporting"
)

# Files exempt within the scope — these are the source of truth for the
# string values themselves and ARE allowed to contain them verbatim.
EXEMPT_FILES=(
  "src/lib/metrics/definitions.ts"
  "src/lib/metrics/schemas.ts"
  "src/lib/metrics/__tests__/definitions.test.ts"
)

# Forbidden literal strings. Each is a string that ONLY appears in
# definitions.ts (or a mapping table). If grep finds one elsewhere, that's
# a literal that needs to be replaced with a constant import.
#
# IMPORTANT: each entry is matched as a literal substring inside a TS/SQL
# source file. Quoted forms are sufficient because every legit use case
# inside the scope is a TS string literal or an SQL string literal.
FORBIDDEN=(
  # Normalized enum values (string identifiers used in DB + JSON)
  '"commercial_cash"'
  '"ahcccs"'
  '"dui"'
  '"zocdoc"'
  '"closed_won"'
  '"closed_lost_referred_out"'
  '"closed_lost_other"'
  '"vob_submitted"'
  '"digital_marketing"'
  '"business_development"'
  # Raw Zoho stage strings
  '"Closed Lost - Referred Out"'
  '"Closed Lost - Referred out Unattached"'
  '"Referred out coming back"'
  '"Closed Won"'
  # Raw source category strings
  '"Business Development"'
  '"ZocDoc"'
  # Insurance type strings
  '"Commercial Insurance"'
  '"Private Pay"'
  '"AHCCCS"'
  # Rep profile strings
  '"Treatment Standard"'
)

violations=0

for path in "${SCOPE_PATHS[@]}"; do
  if [ ! -d "$path" ]; then
    continue
  fi

  while IFS= read -r -d '' file; do
    skip=0
    for exempt in "${EXEMPT_FILES[@]}"; do
      if [ "$file" = "$exempt" ]; then
        skip=1
        break
      fi
    done
    [ "$skip" = "1" ] && continue

    for needle in "${FORBIDDEN[@]}"; do
      if grep -nH -F -- "$needle" "$file" >/dev/null 2>&1; then
        echo "FORBIDDEN literal $needle in $file:"
        grep -nH -F -- "$needle" "$file"
        violations=$((violations + 1))
      fi
    done
  done < <(find "$path" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.sql" \) -print0)
done

if [ "$violations" -gt 0 ]; then
  echo
  echo "$violations metric-literal violation(s) found."
  echo "Replace each with an import from src/lib/metrics/definitions.ts."
  exit 1
fi

echo "ok — no stray metric literals in reporting scope."
