#!/usr/bin/env node
// scripts/hook-guard-secrets.mjs — PreToolUse hook (matcher: Edit|Write).
//
// Blocks edits/writes to .env secret files before they happen. A PreToolUse
// hook that exits 2 BLOCKS the tool and shows its stderr to Claude. `.env` and
// `.env.<anything>` (e.g. .env.local, .env.production) are blocked; the
// template variants (.env.example / .env.sample / .env.template) are allowed
// since they hold no real secrets. Unexpected errors are no-ops (exit 0) so the
// hook never crashes a turn.
//
// Pairs with CLAUDE.md: API keys stay in .env on the owning host; never copied
// or exfiltrated.
import { basename } from "node:path";
import process from "node:process";

const ALLOWED = new Set([".env.example", ".env.sample", ".env.template"]);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const file = payload?.tool_input?.file_path;
  if (!file) process.exit(0);

  const name = basename(file);
  const isEnv = name === ".env" || /^\.env\./.test(name);
  if (isEnv && !ALLOWED.has(name)) {
    process.stderr.write(
      `[guard-secrets] BLOCKED: refusing to edit secret file "${name}". ` +
        `Real secrets stay in .env on the owning host. ` +
        `Use .env.example / .env.sample / .env.template for templates.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0);
}
