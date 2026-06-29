#!/usr/bin/env node
// scripts/hook-syntax-check.mjs — PostToolUse hook (matcher: Edit|Write).
//
// After Claude edits/writes a JS file, run `node --check` on it to catch syntax
// errors immediately instead of at the next `npm test` / server start. A
// PostToolUse hook that exits 2 feeds its stderr back to Claude so it can fix
// the file in the same turn. Non-JS files and unexpected errors are no-ops
// (exit 0) — a hook must never crash a turn.
import { spawnSync } from "node:child_process";
import { extname } from "node:path";
import process from "node:process";

const JS_EXT = new Set([".js", ".mjs", ".cjs"]);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const file = payload?.tool_input?.file_path;

  if (!file || !JS_EXT.has(extname(file).toLowerCase())) process.exit(0);

  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    process.stderr.write(
      `[syntax-check] node --check failed for ${file}:\n${res.stderr || res.stdout || "(no output)"}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  // Never crash a turn on an unexpected error — allow the tool.
  process.exit(0);
}
