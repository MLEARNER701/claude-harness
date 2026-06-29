#!/usr/bin/env node
// scripts/hook-open-tasks.mjs — UserPromptSubmit hook.
//
// Surfaces the OPEN work-requests from .agent/TASKS.md into context on EVERY
// prompt, so earlier requests are not silently dropped when a new request
// interrupts. stdout from a UserPromptSubmit hook is injected as context before
// the model sees the user's message. Kept SHORT (titles only) to avoid bloat.
//
// Harness pairing: CLAUDE.md rule tells the agent to (a) `task`-record a NEW
// request before starting, (b) re-check these open items each turn.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TASKS = join(dirname(fileURLToPath(import.meta.url)), "..", ".agent", "TASKS.md");
if (!existsSync(TASKS)) process.exit(0);

const lines = readFileSync(TASKS, "utf8").split("\n");
// OPEN = unchecked / in-progress / blocked (skip done [x] + dropped [-]).
const open = lines.filter((l) => /^- \[[ ~!]\]/.test(l)).map((l) => l.replace(/\s+—.*$/, "").trim());
if (open.length === 0) process.exit(0);

const shown = open.slice(0, 20).map((l) => "  " + l).join("\n");
const more = open.length > 20 ? `\n  …(+${open.length - 20} more)` : "";
process.stdout.write(
  `[open work-requests — .agent/TASKS.md SSOT] ${open.length} not-done. ` +
  `Don't drop earlier ones when handling a new request; record any NEW request to TASKS.md first.\n${shown}${more}\n`,
);
process.exit(0);
