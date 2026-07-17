#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# THT CRM — one-command safe deploy (frontend / GitHub Pages)
#
#   ./deploy.sh "what you changed"
#
# It does the whole error-prone dance for you:
#   1. Bumps the cache/version token EVERYWHERE (js/*.js, index.html, version.json)
#      — GitHub Pages ignores ?v=, so without a fresh token clients keep the old
#      cached code. version.json drives the auto-reload so users don't hard-refresh.
#   2. Runs the deploy guardrail (scripts/ci-check.mjs): every file must parse, the
#      critical features must still exist, and all tokens must match. If it fails,
#      NOTHING is pushed.
#   3. Commits with YOUR git identity and pushes to main → GitHub Action publishes.
#
# If any step fails the script stops and pushes nothing. Safe to re-run.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Usage: ./deploy.sh \"describe what you changed\""
  exit 1
fi

cd "$(dirname "$0")"

# Current uniform version token (all files share one; grab it from index.html)
CUR=$(grep -oE '\?v=[0-9A-Za-z]+' index.html | head -1 | sed 's/?v=//')
if [ -z "$CUR" ]; then
  echo "✗ Could not find a ?v= version token in index.html — aborting."
  exit 1
fi

# New token = timestamp (always unique, always increasing)
NEXT="$(date +%Y%m%d%H%M%S)"
echo "→ Bumping version token: $CUR → $NEXT"

# Bump it everywhere it appears: module imports, the <script src> tags, the
# __APP_V constant in index.html, and version.json.
LC_ALL=C sed -i '' "s/$CUR/$NEXT/g" js/*.js index.html version.json

echo "→ Running deploy guardrail (ci-check)…"
if ! node scripts/ci-check.mjs; then
  echo ""
  echo "✗ Guardrail FAILED — nothing was pushed. Fix the errors above and re-run."
  echo "  (Your token bump is already applied locally; re-running deploy.sh is fine.)"
  exit 1
fi

echo "→ Committing + pushing to main…"
git add -A
git commit -m "$MSG"
git push origin main

echo ""
echo "✓ Pushed. GitHub Actions will re-run the guardrail and publish to Pages (~1 min)."
echo "  Open the CRM and it will auto-reload to the new version — no hard-refresh needed."
echo "  Watch the deploy: https://github.com/theheadlinetheory/tht-crm/actions"
