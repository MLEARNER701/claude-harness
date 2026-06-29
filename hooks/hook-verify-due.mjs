#!/usr/bin/env node
// scripts/hook-verify-due.mjs
//
//  + verify-due signal .
//
// On a CODE-CHANGE turn, the pre/post verifier-agent harness (CLAUDE.md "코드 작성
// 전/후 verifier agent 하네스") is DUE. A Claude Code hook is a shell command — it
// cannot itself spawn a verifier sub-agent (that's a tool the MODEL calls). So this
// hook does the enforceable part.
//
// BEFORE D: emitted a stdout reminder on every live-src edit, exit 0 — skim-past-able.
// D (C-arm): on the FIRST live src/** edit of a turn that has NO fresh verifier
//   receipt, exit(2). A PostToolUse hook exiting 2 feeds stderr back to the model as
//   a BLOCKING signal it must act on (vs stdout-exit-0 which is easy to ignore). It
//   tells the model to spawn a POST-code verifier sub-agent and write a receipt via
//   scripts/dev/verifier-receipt.mjs. IDEMPOTENT: once a fresh receipt exists for the
//   turn (or we've already fired this turn), subsequent edits pass silently — we do
//   NOT re-fire on every keystroke.
//
// SCRIBE: EXTENDS the existing reminder; the receipt shape + freshness + live-src rule
// are imported from scripts/dev/verifier-receipt.mjs (single home — no duplicated
// "what is a fresh receipt" logic). Never crashes a turn (exit 0 on any unexpected
// error; only the deliberate due-signal uses exit 2).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isLiveSrc, turnTokenFromTranscript, findFreshReceipt } from "./dev/verifier-receipt.mjs";

import { execFileSync } from "node:child_process";
function repoRoot(fallback) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || fallback; }
  catch { return fallback; }
}


const ROOT = repoRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
// per-turn "already fired" marker so we exit(2) at most once per turn.
const FIRED_PATH = join(ROOT, "runtime", "verifier", ".last-fired-turn");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function alreadyFiredThisTurn(turnToken) {
  if (!turnToken) return false;
  try { return existsSync(FIRED_PATH) && readFileSync(FIRED_PATH, "utf8").trim() === turnToken; }
  catch { return false; }
}
function markFired(turnToken) {
  if (!turnToken) return;
  try {
    mkdirSync(dirname(FIRED_PATH), { recursive: true });
    writeFileSync(FIRED_PATH, turnToken);
  } catch { /* best-effort */ }
}

try {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const file = payload?.tool_input?.file_path;
  const transcriptPath = payload?.transcript_path;

  if (!isLiveSrc(file)) { process.exit(0); }

  const turnToken = turnTokenFromTranscript(transcriptPath);
  const fresh = findFreshReceipt({ turnToken });
  const shortFile = String(file).replace(/.*\/(src|scripts)\//, "$1/");

  // Receipt already exists for this turn → verifier ran. Silent pass.
  if (fresh) { process.exit(0); }

  // Already fired the blocking due-signal this turn → don't nag every edit. Soft note.
  if (alreadyFiredThisTurn(turnToken)) {
    process.stdout.write(
      `[verify-due] live code changed (${shortFile}); POST-code verifier still DUE ` +
      `(write a receipt: node scripts/dev/verifier-receipt.mjs write --verifier <name> --files ${shortFile}).\n`,
    );
    process.exit(0);
  }

  // FIRST unverified live edit of the turn → exit(2) so the model can't skim past it.
  markFired(turnToken);
  process.stderr.write(
    `[verify-due] ⚠ T95/the verifier harness: live code changed (${shortFile}) with NO fresh verifier receipt this turn.\n` +
    `ACTION REQUIRED before closeout/commit:\n` +
    `  1) Spawn the senior-code-reviewer sub-agent (.claude/agents/senior-code-reviewer.md):\n` +
    `     it reviews the changed files like a senior engineer (correctness/wiring/SCRIBE/tests),\n` +
    `     tells you WHAT is wrong + WHY + HOW to fix (file:line), then writes the receipt.\n` +
    `  2) Receipt that clears the gate (default mode=block):\n` +
    `       node scripts/dev/verifier-receipt.mjs write --verifier senior-code-reviewer --files <changed.js>${turnToken ? ` --turn ${turnToken}` : ""} --note "<verdict>"\n` +
    `(Fires once per turn. Receipt is model-written — only record 'pass' if there are genuinely no must-fixes.)\n`,
  );
  process.exit(2);
} catch {
  process.exit(0);
}
