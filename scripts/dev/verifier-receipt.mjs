#!/usr/bin/env node
// scripts/dev/verifier-receipt.mjs
//
// the verifier harness  — the SHARED CORE for the verifier-agent
// enforcement harness. This module is the SSOT for:
//   • where a verifier receipt lives + its shape         (receiptDir / receiptPath / writeReceipt)
//   • how a "turn token" is derived from the transcript  (turnTokenFromTranscript)
//   • the freshness rule both gates agree on             (findFreshReceipt)
//   • the pre-commit gate decision                        (checkVerifierReceipt)
//
// SCRIBE: this REPLACES nothing and EXTENDS the T95 harness. Before D, the only
// artifact was hook-verify-due.mjs emitting a skim-past-able stdout reminder. C
// (hook-verify-due.mjs, exit 2) and B (pre-commit gate) BOTH import THIS file so
// the receipt shape + freshness rule live in ONE place (MERGE of would-be-duplicated
// "what is a fresh receipt" logic — receipt knowledge is a fact, so n=2 callers ⇒
// one home, per CLAUDE.md SCRIBE). No prior receipt logic existed elsewhere (grep
// 'verifier-receipt'/'runtime/verifier' was clean) → core is INDEPENDENT/new.
//
// HONEST CEILING (read this before trusting a green gate): the receipt is
// MODEL-WRITTEN. This harness enforces that "a verifier-SHAPED receipt exists and is
// fresh for this turn" — it does NOT and CANNOT verify that a real sub-agent ran or
// that its judgement was sound. A model on auto-pilot could fabricate the JSON. The
// value is: it makes skipping the verifier an EXPLICIT act (write a false receipt or
// pass --no-verify), not a silent omission. Treat the receipt as an audit-trail
// breadcrumb, not proof of verification quality.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot(fallback) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || fallback; }
  catch { return fallback; }
}


const ROOT = repoRoot(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
// HARNESS_VERIFIER_DIR override lets tests point at an isolated tmp dir so a real
// session's receipt in runtime/verifier never leaks into (and silences) a test.
// A function (not a const) so the env override is read at CALL time — lets a test
// set HARNESS_VERIFIER_DIR to a tmp dir and stay fully isolated from the repo's real
// runtime/verifier (otherwise this turn's own receipt leaks into freshness assertions).
export function receiptDir() { return process.env.HARNESS_VERIFIER_DIR || join(ROOT, "runtime", "verifier"); }

// A receipt is "fresh" if written within this window. A coding turn rarely spans
// more than a few minutes between the verifier sub-agent finishing and the commit;
// this bounds a stale receipt from a previous, unrelated turn being reused forever.
export const FRESH_WINDOW_MS = 30 * 60 * 1000; // 30 min

// ── live src detection — kept in lockstep with hook-verify-due.isLiveCodeChange ──
// (Same KNOWLEDGE as the hook's detector. The hook owns the PostToolUse single-file
// version; here we need the staged-SET version for the commit gate. Same rule,
// different input shape — EXTEND, exported so the hook could import it too.)
export function isLiveSrc(file) {
  if (!file) return false;
  const f = String(file).replace(/\\/g, "/");
  if (!/\.(js|mjs)$/.test(f)) return false;
  if (/\.test\.(js|mjs)$/.test(f)) return false;
  if (/(^|\/)(tests?|runtime|node_modules|public|dist|build)\//.test(f)) return false;
  return /(^|\/)src\//.test(f) || /(^|\/)scripts\/(lib|dev)\//.test(f);
}

// ── turn token ───────────────────────────────────────────────────────────────
// Identifies the current conversational turn so a receipt written this turn counts
// and a receipt from a prior turn does not. We use the uuid of the most-recent REAL
// user message (role:user with text content — NOT a tool_result echo) in the
// transcript jsonl. Falls back to a session-scoped token, then to "no-turn".
export function turnTokenFromTranscript(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return null;
    const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let j;
      try { j = JSON.parse(lines[i]); } catch { continue; }
      if (j?.type !== "user") continue;
      const c = j?.message?.content;
      // a real user prompt is a string, or an array containing a {type:"text"} part;
      // a tool_result turn is an array of {type:"tool_result"} parts → skip.
      const isReal = typeof c === "string"
        ? c.trim().length > 0
        : Array.isArray(c) && c.some((p) => p?.type === "text" && String(p.text || "").trim());
      if (isReal && j.uuid) return String(j.uuid);
    }
    return null;
  } catch { return null; }
}

// hash of the transcript tail — a cheap, stable-ish fingerprint recorded in the
// receipt so a human can sanity-check the receipt was written against this convo.
export function transcriptHash(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return null;
    const buf = readFileSync(transcriptPath);
    const tail = buf.subarray(Math.max(0, buf.length - 64 * 1024));
    return createHash("sha256").update(tail).digest("hex").slice(0, 16);
  } catch { return null; }
}

// ── receipt I/O ──────────────────────────────────────────────────────────────
function ensureDir() { const d = receiptDir(); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

export function receiptPath(key) {
  return join(receiptDir(), `${String(key).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}.json`);
}

// write a receipt. `key` = short sha / turn token; model fills verifier+files.
export function writeReceipt({ key, verifier, files = [], transcript_hash = null, turn_token = null, note = null } = {}) {
  ensureDir();
  const k = key || turn_token || `turn_${Date.now()}`;
  const rec = {
    verifier: verifier || "(unnamed)",
    files,
    transcript_hash,
    turn_token,
    note,
    ts: new Date().toISOString(),
    // FABRICATION CAVEAT: model-written. Presence ≠ a real sub-agent ran. See header.
    model_written: true,
  };
  const p = receiptPath(k);
  writeFileSync(p, JSON.stringify(rec, null, 2));
  return p;
}

// read every receipt, newest first.
export function listReceipts() {
  const d = receiptDir();
  if (!existsSync(d)) return [];
  const out = [];
  for (const name of readdirSync(d)) {
    if (!name.endsWith(".json")) continue;
    const p = join(d, name);
    try {
      const rec = JSON.parse(readFileSync(p, "utf8"));
      const mtime = statSync(p).mtimeMs;
      out.push({ path: p, mtime, ...rec });
    } catch { /* skip malformed */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// the freshness rule BOTH gates agree on.
//   • If `turnToken` is given → a receipt matching that turn_token (any age) is fresh
//     (the verifier ran THIS turn). This is the strong signal C uses.
//   • Otherwise (pre-commit has no transcript) → newest receipt within FRESH_WINDOW_MS.
export function findFreshReceipt({ turnToken = null, now = Date.now() } = {}) {
  const all = listReceipts();
  if (turnToken) {
    const hit = all.find((r) => r.turn_token && r.turn_token === turnToken);
    if (hit) return hit;
  }
  const recent = all.find((r) => {
    const ts = Date.parse(r.ts || "");
    return Number.isFinite(ts) && (now - ts) <= FRESH_WINDOW_MS;
  });
  return recent || null;
}

// ── pre-commit gate (B) ──────────────────────────────────────────────────────
// Decide whether the staged set requires (and has) a fresh verifier receipt.
// Pure decision function — does no I/O on git; caller passes the staged file list so
// this is unit-testable. Returns { required, hasReceipt, block, liveFiles, receipt }.
export function checkVerifierReceipt({ stagedFiles = [], now = Date.now() } = {}) {
  const liveFiles = stagedFiles.filter(isLiveSrc);
  const required = liveFiles.length > 0;
  const receipt = required ? findFreshReceipt({ now }) : null;
  const hasReceipt = !!receipt;
  return {
    required,
    hasReceipt,
    block: required && !hasReceipt,
    liveFiles,
    receipt,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Usages:
//   node scripts/dev/verifier-receipt.mjs write --verifier code-reviewer --files a.js,b.js [--turn <tok>]
//   node scripts/dev/verifier-receipt.mjs check            # pre-commit gate over staged set
//   node scripts/dev/verifier-receipt.mjs check --staged a.js,b.js   # explicit set (tests)
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
  }
  return a;
}

function stagedFromGit() {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === "write") {
    const files = args.files ? String(args.files).split(",").map((s) => s.trim()).filter(Boolean) : [];
    const p = writeReceipt({
      key: args.turn || args.key,
      verifier: args.verifier,
      files,
      transcript_hash: args.transcript_hash || null,
      turn_token: args.turn || null,
      note: args.note || null,
    });
    console.log(`[verifier-receipt] wrote ${p}`);
    process.exit(0);
  }

  if (cmd === "check") {
    // FLAG-GATED. Default = block (default: enforce the closed loop —
    // no fresh senior-code-reviewer receipt ⇒ src commit is blocked). warn = remind only;
    // 0/off = skip entirely. Per-commit bypass: git commit --no-verify.
    const mode = (process.env.HARNESS_VERIFIER_GATE || "block").toLowerCase();
    if (mode === "0" || mode === "off") { process.exit(0); }
    const staged = args.staged ? String(args.staged).split(",").map((s) => s.trim()).filter(Boolean) : stagedFromGit();
    const r = checkVerifierReceipt({ stagedFiles: staged });
    if (!r.required) { console.log("[verifier-receipt] no live src/** staged — PASS"); process.exit(0); }
    if (r.hasReceipt) {
      console.log(`[verifier-receipt] fresh receipt found (${r.receipt.verifier}, ${r.receipt.ts}) — PASS`);
      process.exit(0);
    }
    // closed-loop guidance: WHERE it's missing + HOW to close it via the senior reviewer.
    const lines = [
      `[verifier-receipt] ⚠ live src staged with NO fresh verifier review this turn:`,
      ...r.liveFiles.slice(0, 8).map((f) => `    - ${f}`),
      `  → Spawn the senior-code-reviewer sub-agent (agents/senior-code-reviewer.md):`,
      `      it reviews these files like a senior engineer (correctness/wiring/SCRIBE/tests),`,
      `      tells you WHAT is wrong, WHY, and HOW to fix it, then writes the receipt:`,
      `      node <harness>/dev/verifier-receipt.mjs write --verifier senior-code-reviewer --files ${r.liveFiles.slice(0, 3).join(",")} --note "<verdict>"`,
      `  Bypass (only if you accept the risk): git commit --no-verify   |   disable: HARNESS_VERIFIER_GATE=0`,
    ];
    console.log(lines.join("\n"));
    // Fail-safe: only an EXPLICIT `warn` exits 0. Default + any unrecognized/typo'd
    // value (e.g. "blok") BLOCKS — a misspelled override must not silently disable a
    // safety-critical gate (senior-code-reviewer NOTE 2026-06-20). off/0 already exited above.
    if (mode === "warn") { console.log("[verifier-receipt] mode=warn → warn-only (set HARNESS_VERIFIER_GATE=block to enforce)"); process.exit(0); }
    console.log(`[verifier-receipt] mode=${mode === "block" ? "block" : `${mode} (unknown → fail-safe block)`} → BLOCKING commit until a fresh review receipt exists`);
    process.exit(1);
  }

  console.log("usage: verifier-receipt.mjs <write|check> [--verifier <n>] [--files a,b] [--turn <tok>] [--staged a,b]");
  process.exit(0);
}
