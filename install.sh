#!/usr/bin/env bash
# install.sh — install the claude-harness into a target project (non-destructive).
#
#   ./install.sh /path/to/your/project
#
# What it does (MERGES, never clobbers):
#   • copies the hooks + verifier core into  <target>/scripts/claude-harness/
#   • deep-merges the hooks block into        <target>/.claude/settings.json
#   • copies agents/skills/commands into       <target>/.claude/
#   • installs the pre-commit gate only if none exists (else ships a *.harness copy)
#   • leaves a .harness.json config if absent
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GATE_ONLY=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--gate-only" ]; then GATE_ONLY=1; else ARGS+=("$a"); fi
done
TARGET="${ARGS[0]:-}"

if [ -z "$TARGET" ]; then
  echo "usage: ./install.sh [--gate-only] /path/to/your/project"; exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "✗ target does not exist: $TARGET"; exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"
echo "▶ installing claude-harness into: $TARGET${GATE_ONLY:+  (gate-only)}"

# ── 1. copy hooks + verifier core ────────────────────────────────────────────
# hook-verify-due.mjs imports ./dev/verifier-receipt.mjs, so they MUST share a parent.
DEST_SCRIPTS="$TARGET/scripts/claude-harness"
mkdir -p "$DEST_SCRIPTS/dev"
cp "$HARNESS_DIR"/scripts/dev/verifier-receipt.mjs "$DEST_SCRIPTS/dev/"
cp "$HARNESS_DIR"/scripts/dev/verify-fast.mjs      "$DEST_SCRIPTS/dev/"
cp "$HARNESS_DIR"/scripts/dev/architecture-ambiguity-gate.mjs "$DEST_SCRIPTS/dev/"

# In gate-only mode (plugin already provides hooks/agents/skills) skip the rest and just gate.
if [ "$GATE_ONLY" = "1" ]; then
  GATE_SRC="$HARNESS_DIR/scripts/dev/pre-commit"
  GATE_BODY="$(sed 's#scripts/dev/verify-fast.mjs#scripts/claude-harness/dev/verify-fast.mjs#; s#scripts/dev/verifier-receipt.mjs#scripts/claude-harness/dev/verifier-receipt.mjs#' "$GATE_SRC")"
  if [ -d "$TARGET/.git" ]; then
    mkdir -p "$TARGET/.git/hooks"
    if [ -f "$TARGET/.git/hooks/pre-commit" ] && ! grep -q "claude-harness" "$TARGET/.git/hooks/pre-commit" 2>/dev/null; then
      printf '%s\n' "$GATE_BODY" > "$TARGET/.git/hooks/pre-commit.harness"; chmod +x "$TARGET/.git/hooks/pre-commit.harness"
      echo "  ⚠ existing pre-commit kept. Shipped .git/hooks/pre-commit.harness — merge manually."
    else
      printf '%s\n' "$GATE_BODY" > "$TARGET/.git/hooks/pre-commit"; chmod +x "$TARGET/.git/hooks/pre-commit"
      echo "  ✓ pre-commit gate installed (HARNESS_VERIFIER_GATE=block by default)"
    fi
  else
    echo "  • no .git/ — run after git init"
  fi
  echo "✅ gate-only install done."
  exit 0
fi
# full install: also copy the hooks + memory helper
cp "$HARNESS_DIR"/hooks/*.mjs              "$DEST_SCRIPTS/"
cp "$HARNESS_DIR"/scripts/agent-memory.mjs "$DEST_SCRIPTS/"
echo "  ✓ scripts → scripts/claude-harness/ (+ dev/)"

# optional hooks (display/diagnostics) — copied but NOT wired by default
mkdir -p "$DEST_SCRIPTS/optional"
cp "$HARNESS_DIR"/hooks/optional/*.mjs "$DEST_SCRIPTS/optional/" 2>/dev/null || true

# ── 2. deep-merge the hooks block into .claude/settings.json ─────────────────
mkdir -p "$TARGET/.claude"
SETTINGS="$TARGET/.claude/settings.json"
TEMPLATE="$HARNESS_DIR/settings.template.json"
python3 - "$SETTINGS" "$TEMPLATE" <<'PY'
import json, os, sys
settings_path, template_path = sys.argv[1], sys.argv[2]
template = json.load(open(template_path))
if os.path.exists(settings_path):
    try: cur = json.load(open(settings_path))
    except Exception: cur = {}
else:
    cur = {}
cur.setdefault("hooks", {})
def cmds(hook_entries):
    out = set()
    for e in hook_entries:
        for h in e.get("hooks", []):
            out.add(h.get("command"))
    return out
for event, entries in template["hooks"].items():
    existing = cur["hooks"].setdefault(event, [])
    have = cmds(existing)
    for entry in entries:
        # dedupe by command string: only add hook commands not already present
        new_hooks = [h for h in entry.get("hooks", []) if h.get("command") not in have]
        if not new_hooks:
            continue
        merged = dict(entry); merged["hooks"] = new_hooks
        existing.append(merged)
json.dump(cur, open(settings_path, "w"), indent=2)
print("  ✓ .claude/settings.json hooks merged (deduped by command)")
PY

# ── 3. copy agents / skills / commands into .claude/ ─────────────────────────
mkdir -p "$TARGET/.claude/agents" "$TARGET/.claude/skills" "$TARGET/.claude/commands"
cp "$HARNESS_DIR"/agents/*.md   "$TARGET/.claude/agents/"   2>/dev/null || true
cp -R "$HARNESS_DIR"/skills/*   "$TARGET/.claude/skills/"   2>/dev/null || true
cp "$HARNESS_DIR"/commands/*.md "$TARGET/.claude/commands/" 2>/dev/null || true
echo "  ✓ agents / skills / commands → .claude/"

# ── 4. pre-commit gate (only if none) ────────────────────────────────────────
# Generate a pre-commit that points at the installed location.
GATE_SRC="$HARNESS_DIR/scripts/dev/pre-commit"
GATE_BODY="$(sed 's#scripts/dev/verify-fast.mjs#scripts/claude-harness/dev/verify-fast.mjs#; s#scripts/dev/verifier-receipt.mjs#scripts/claude-harness/dev/verifier-receipt.mjs#' "$GATE_SRC")"
HOOK_DIR="$TARGET/.git/hooks"
if [ -d "$TARGET/.git" ]; then
  mkdir -p "$HOOK_DIR"
  if [ -f "$HOOK_DIR/pre-commit" ] && ! grep -q "claude-harness" "$HOOK_DIR/pre-commit" 2>/dev/null; then
    printf '%s\n' "$GATE_BODY" > "$HOOK_DIR/pre-commit.harness"
    chmod +x "$HOOK_DIR/pre-commit.harness"
    echo "  ⚠ existing pre-commit kept. Shipped .git/hooks/pre-commit.harness — merge manually."
  else
    printf '%s\n' "$GATE_BODY" > "$HOOK_DIR/pre-commit"
    chmod +x "$HOOK_DIR/pre-commit"
    echo "  ✓ pre-commit gate installed (HARNESS_VERIFIER_GATE=block by default)"
  fi
else
  echo "  • no .git/ — skipped pre-commit (run install again after git init)"
fi

# ── 5. config + memory scaffold ──────────────────────────────────────────────
[ -f "$TARGET/.harness.json" ] || cp "$HARNESS_DIR/.harness.example.json" "$TARGET/.harness.json"
mkdir -p "$TARGET/.agent"
[ -f "$TARGET/.agent/TASKS.md" ] || printf '# TASKS — open work-requests\n\n- [ ] example open task\n' > "$TARGET/.agent/TASKS.md"

# Drop the CLAUDE.md template ONLY if the project has no CLAUDE.md yet (non-destructive).
if [ ! -f "$TARGET/CLAUDE.md" ] && [ ! -f "$TARGET/.claude/CLAUDE.md" ]; then
  cp "$HARNESS_DIR/CLAUDE.template.md" "$TARGET/CLAUDE.md"
  echo "  ✓ seeded CLAUDE.md from template (no existing one found)"
else
  cp "$HARNESS_DIR/CLAUDE.template.md" "$TARGET/.claude/CLAUDE.template.md"
  echo "  • CLAUDE.md already exists — shipped .claude/CLAUDE.template.md to merge from"
fi

echo ""
echo "✅ done. Next:"
echo "   1. Restart Claude Code in $TARGET so it reloads .claude/settings.json."
echo "   2. (optional) edit .harness.json — set { \"test_cmd\": \"...\" }."
echo "   3. (optional) wire display hooks from scripts/claude-harness/optional/ into Stop."
echo "   Gate knobs: HARNESS_VERIFIER_GATE=block|warn|0 · HARNESS_PRECOMMIT=0 · git commit --no-verify"
