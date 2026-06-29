#!/bin/sh
# Install the claude-harness git hooks. Idempotent.
# .git/hooks is not tracked by git, so the canonical pre-commit lives in
# scripts/dev/pre-commit and is copied in. Run once after install, or after the hook changes.
set -e
ROOT=$(git rev-parse --show-toplevel)
SRC="$ROOT/scripts/dev"
DST="$ROOT/.git/hooks"
for hook in pre-commit; do
  if [ -f "$SRC/$hook" ]; then
    if [ -f "$DST/$hook" ] && ! grep -q "claude-harness" "$DST/$hook" 2>/dev/null; then
      echo "⚠ $DST/$hook already exists and is NOT a claude-harness hook."
      echo "  Shipped a copy at $DST/$hook.harness — merge it manually, then chmod +x."
      cp "$SRC/$hook" "$DST/$hook.harness"
      chmod +x "$DST/$hook.harness"
      continue
    fi
    cp "$SRC/$hook" "$DST/$hook"
    chmod +x "$DST/$hook"
    echo "installed $hook -> .git/hooks/$hook"
  fi
done
echo "done. bypass a single commit: git commit --no-verify  |  disable session: export HARNESS_PRECOMMIT=0"
