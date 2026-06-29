#!/usr/bin/env node
// scripts/hook-guard-destructive.mjs — PreToolUse hook (matcher: Bash).
//
// Blocks irreversible git/filesystem commands before they run. A PreToolUse
// hook that exits 2 BLOCKS the tool and shows its stderr to Claude. Patterns
// are written to avoid false positives — `git reset --soft` and
// `git checkout <branch>` are NOT blocked. Unexpected errors are no-ops
// (exit 0) so the hook never crashes a turn.
//
// Pairs with CLAUDE.md git discipline: destructive git (reset --hard / clean /
// rebase -i) and remote-rewriting pushes stay owner-gated.
import process from "node:process";

// [regex, human reason]. Patterns match anywhere in the command string.
const BLOCKED = [
  [/git\s+reset\s+(?:[^\n]*\s)?--hard\b/, "git reset --hard discards committed + working changes"],
  // -f anywhere in a short-flag run (e.g. -f, -fd, -df) or long --force.
  [/git\s+clean\s+(?:[^\n]*\s)?(?:-[a-eg-z]*f[a-z]*|--force)\b/, "git clean -f deletes untracked files irreversibly"],
  [/git\s+rebase\s+(?:[^\n]*\s)?(?:-i\b|--interactive\b)/, "git rebase -i rewrites history (interactive, also unsupported)"],
  [/git\s+checkout\s+--(?:\s|$)/, "git checkout -- discards uncommitted worktree changes"],
  // --force / --force-with-lease anywhere, or a short -f flag run as its own arg.
  [/git\s+push\s+(?:[^\n]*\s)?(?:--force(?:-with-lease)?\b|-[a-eg-z]*f[a-z]*\b)/, "git push --force rewrites remote history (owner-gated)"],
  [/(?:^|[\s;&|(])rm\s+(?:-\w*r\w*f|-\w*f\w*r|-[rf]\s+-[rf])\b/, "rm -rf permanently deletes files/directories"],
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command) process.exit(0);

  for (const [re, reason] of BLOCKED) {
    if (re.test(command)) {
      process.stderr.write(`[guard-destructive] BLOCKED: ${reason}\n  command: ${command}\n`);
      process.exit(2);
    }
  }
  process.exit(0);
} catch {
  process.exit(0);
}
