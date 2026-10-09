#!/usr/bin/env bash
# Publish the current app state to the fork WITHOUT pushing local history or local-only art:
# builds the filtered tree (scripts/make-dist.js), commits it on top of the fork branch, runs the tests there,
# and (only with --push) fast-forwards the fork. The local branch is never pushed.
#   scripts/publish-fork.sh "commit message" [--push]
set -euo pipefail
MSG=${1:?usage: publish-fork.sh "commit message" [--push]}
BRANCH=feat/control-panel-pixoo
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cd "$ROOT"
git fetch fork "$BRANCH"
node scripts/make-dist.js "$TMP/dist" | head -1
git worktree add --detach "$TMP/wt" "fork/$BRANCH" >/dev/null
cd "$TMP/wt"
git rm -r -q --ignore-unmatch .
cp -R "$TMP/dist/." .
git add -A
if git diff --cached --quiet; then echo "Nothing new to publish."; cd "$ROOT"; git worktree remove --force "$TMP/wt"; exit 0; fi
ln -s "$ROOT/node_modules" node_modules
npx jest 2>&1 | grep -E "^(FAIL|Tests:)"
git -c user.email=11841923+wmbillock@users.noreply.github.com -c user.name="Willow Billock" commit -q -m "$MSG

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git show --stat --format='%h %s' HEAD | tail -3
if [ "${2:-}" = "--push" ]; then git push fork "HEAD:$BRANCH"; else echo "Dry run: not pushed. Re-run with --push."; fi
cd "$ROOT"; git worktree remove --force "$TMP/wt"
