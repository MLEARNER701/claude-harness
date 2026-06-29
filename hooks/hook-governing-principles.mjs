#!/usr/bin/env node
// scripts/hook-governing-principles.mjs — SessionStart hook.
//
// Progressive disclosure of the governing-principles SSOT: injects ONLY the
// `## TL;DR` digest from .agent/GOVERNING-PRINCIPLES.md into context at session
// start (short + always-on, token-efficient even as the full doc grows). The
// agent reads the full doc on demand when a principle is in play.
//
// Discipline (mirrors the other hooks): never throw, exit 0 on any error, plain
// stdout (SessionStart stdout is injected as context). Do NOT read display
// outputs (live.html) — self-reference ban.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const DOC = join(dirname(fileURLToPath(import.meta.url)), "..", ".agent", "GOVERNING-PRINCIPLES.md");
  if (!existsSync(DOC)) process.exit(0);
  const text = readFileSync(DOC, "utf8");
  const lines = text.split(/\r?\n/);

  // Slice the `## TL;DR ...` section up to the next top-level `## ` heading.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+TL;DR/i.test(lines[i])) { start = i; break; }
  }
  if (start === -1) process.exit(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const digest = lines.slice(start, end).join("\n").trim();
  if (!digest) process.exit(0);

  process.stdout.write(
    "[GOVERNING PRINCIPLES — .agent/GOVERNING-PRINCIPLES.md (SSOT)] " +
    "These are the owner's non-negotiable rules. Follow them. Read the full doc when a " +
    "principle is in play.\n\n" + digest + "\n",
  );
} catch {
  // never block session start
}
process.exit(0);
