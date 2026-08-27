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

# ─────────────────────────────────────────────────────────────
# Step 0 — reconcile with anything a teammate pushed while you worked.
#
# Several of us deploy from this repo. Every deploy rewrites the ?v= token in
# every file, so a plain `git pull` conflicts in ALL of them — and resolving 47
# token conflicts by hand is exactly how someone silently reverts a colleague's
# work (that nearly happened on 2026-07-23).
#
# So instead of merging blind, compare with the tokens stripped out. That shows
# what each side ACTUALLY changed. No overlap → reconcile automatically. Same
# file touched by both → stop and make a human look.
# ─────────────────────────────────────────────────────────────
strip_tokens() { sed -E 's/\?v=[0-9A-Za-z]+//g'; }

# Does $1 really differ between two treeish refs (ignoring token churn)?
really_differs() { # really_differs <file> <refA> <refB>
  ! diff -q <(git show "$2:$1" 2>/dev/null | strip_tokens) \
            <(git show "$3:$1" 2>/dev/null | strip_tokens) >/dev/null 2>&1
}

echo "→ Checking for changes pushed by others…"
git fetch -q origin main

BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "$BEHIND" -gt 0 ]; then
  echo "  Someone pushed $BEHIND commit(s) while you were working. Comparing…"

  # What THEY really changed (tokens ignored).
  THEIRS=""
  for f in $(git diff --name-only HEAD origin/main); do
    if really_differs "$f" HEAD origin/main; then THEIRS="$THEIRS $f"; fi
  done

  # What YOU really changed — your edits are still uncommitted at this point,
  # so compare the working tree against HEAD. Untracked files count too.
  MINE=""
  for f in $(git status --porcelain | awk '{print $2}'); do
    if [ -f "$f" ]; then
      if ! diff -q <(git show "HEAD:$f" 2>/dev/null | strip_tokens) \
                   <(strip_tokens < "$f") >/dev/null 2>&1; then
        MINE="$MINE $f"
      fi
    fi
  done

  echo "  They really changed:${THEIRS:- (tokens only)}"
  echo "  You really changed: ${MINE:- (tokens only)}"

  # Same file on both sides → a human must decide.
  OVERLAP=""
  for m in $MINE; do
    for t in $THEIRS; do
      if [ "$m" = "$t" ]; then OVERLAP="$OVERLAP $m"; fi
    done
  done

  if [ -n "$OVERLAP" ]; then
    echo ""
    echo "✗ You and a teammate both changed:$OVERLAP"
    echo "  Nothing was pushed. Open those file(s), combine both sets of changes,"
    echo "  then re-run deploy.sh. Do NOT 'git pull' and mass-resolve conflicts —"
    echo "  that is how someone's work gets silently reverted."
    exit 1
  fi

  # No overlap: rebuild on top of theirs, keeping your files verbatim.
  echo "  No overlap — reconciling automatically."
  TMP=$(mktemp -d)
  for f in $MINE; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done
  git reset --hard -q origin/main
  for f in $MINE; do cp "$TMP/$f" "$f"; done
  rm -rf "$TMP"
  echo "  Rebased onto $(git rev-parse --short origin/main); your changes re-applied."
fi

# Bump the token everywhere it appears: module imports, the <script src> tags,
# the __APP_V constant in index.html, and version.json.
#
# This was a sed one-liner substituting ONE literal old value — whatever ?v=
# happened to come first in index.html. Any token already out of step with that
# value was skipped, so drift could never heal, only accumulate. On 2026-08-26 a
# lazy `await import('./render.js?v=…')` in js/dialer.js sat a day behind the
# rest of the tree; ci-check compares only the 8-digit date prefix, so it read as
# "in sync" until the date rolled over — and then failed the deploy, with no way
# for this script to fix what it had never been looking at.
#
# bump-tokens.mjs matches every token by pattern instead of by old value, so it
# heals drift rather than stepping around it. It also moots the sed -i portability
# dance this block used to do (BSD wants a backup suffix, GNU refuses one), since
# it runs wherever node does — which this script already requires for ci-check.
NEXT="$(date +%Y%m%d%H%M%S)"
node scripts/bump-tokens.mjs "$NEXT"

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
