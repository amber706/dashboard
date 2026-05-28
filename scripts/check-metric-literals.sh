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

# Paths in scope. Edit as new reporting modules land.
SCOPE_PATHS=(
  "src/lib/metrics"
  # Phase 1B will add: "supabase/functions/sync_*", "supabase/functions/build_op_metrics"
  # Phase 1C will add: "src/components/reporting", "src/features/reporting", "src/pages/reporting"
)

# Files exempt within the scope — these are the source of truth.
EXEMPT_FILES=(
  "src/lib/metrics/definitions.ts"
  "src/lib/metrics/schemas.ts"
  "src/lib/metrics/__tests__/definitions.test.ts"
)

# Forbidden literal strings. Each is matched as a literal substring against
# TS/SQL source. Quoted forms are sufficient because every legit reporting
# use case is either a TS string literal or an SQL string literal.
FORBIDDEN=(
  # Normalized pipeline enum values
  '"commercial_cash"'
  '"ahcccs"'
  '"zocdoc"'
  '"dui_cash"'
  '"dv_cash"'

  # Normalized stage_category enum values
  '"vob_qualifying"'
  '"vob_approved"'
  '"pre_admit"'
  '"referred_out_coming_back"'
  '"closed_won_admitted"'
  '"closed_won_referred_out_unattached"'
  '"closed_won_dui_completion"'
  '"closed_lost"'

  # Normalized source_category enum values
  '"digital_marketing"'
  '"business_development"'

  # Raw Zoho pipeline strings
  '"Commercial-Cash"'
  '"DUI - Cash"'
  '"DV - Cash"'

  # Raw Zoho stage strings — Closed wins / losses
  '"Closed - Admitted"'
  '"Closed - Referred Out Unattached"'
  '"Closed - Screening Only"'
  '"Closed - Both Screening & Classes"'
  '"Closed - Classes Only"'
  '"Closed - Lost (Treatment)"'
  '"Closed - Lost (DUI)"'
  '"Closed - Lost (DV)"'

  # Raw Zoho stage strings — VOB
  '"VOB - Qualifying"'
  '"VOB - Approved"'

  # Raw Zoho stage strings — referred-out active
  '"Referred Out - Coming Back"'

  # Raw source category strings
  '"Business Development"'

  # Insurance type strings
  '"Commercial Insurance"'
  '"Private Pay"'

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
