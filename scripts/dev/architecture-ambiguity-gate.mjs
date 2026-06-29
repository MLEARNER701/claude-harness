#!/usr/bin/env node
// architecture-ambiguity-gate.mjs
//
// Ambiguity gate for ARCHITECTURAL changes (run BEFORE writing code for a "big"
// change: new worker/service, DB schema change, new cross-cutting rule, system-prompt
// structure change, new sub-agent, new external integration).
//
// Formula (inspired by Q00/ouroboros):
//   Ambiguity = 1 - Σ(clarity_i × weight_i) / Σ(weight_i)
//   Goal (0.40) · Constraint (0.30) · Success (0.30) · Context (0.15, brownfield)
//
// Threshold: ambiguity ≤ 0.2 → PROCEED · > 0.2 → BLOCK (write/extend the spec first).
//
// TWO MODES (zero required dependencies):
//   • DEFAULT — a transparent HEURISTIC scorer (keyword/structure analysis). No network,
//     no API key. Good enough to catch "fix the bug" / "improve X" with no concrete outcome.
//   • LLM — if OPENAI_API_KEY (or HARNESS_JUDGE_API_KEY) is set, an LLM judge scores the
//     four dimensions for a sharper read. Falls back to heuristic on any error.
//
// Usage:
//   node architecture-ambiguity-gate.mjs "<change description>"
//   echo "..." | node architecture-ambiguity-gate.mjs --stdin
//   --force  proceed even when blocked (counts as tech debt)
//
// Exit: 0 = proceed · 1 = blocked · (never hard-fails; degrades to heuristic)

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
function repoRoot(fallback) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || fallback; }
  catch { return fallback; }
}
const ROOT = repoRoot(resolve(__dirname, ".."));

// ── read change description ──────────────────────────────────────────────────
let description = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (process.argv.includes("--stdin")) description = readFileSync(0, "utf8");
const force = process.argv.includes("--force");

if (!description.trim()) {
  console.error('usage: node architecture-ambiguity-gate.mjs "<change description>"');
  process.exit(1);
}

// ── load existing spec context (optional) ────────────────────────────────────
let specContext = "";
for (const rel of [".specify/spec.md", ".specify/plan.md"]) {
  const p = join(ROOT, rel);
  if (existsSync(p)) specContext += `\n--- ${rel} ---\n` + readFileSync(p, "utf8").slice(0, 4000);
}

// ── HEURISTIC scorer (default, dependency-free) ──────────────────────────────
// Each dimension starts clear (1.0) and loses clarity for tell-tale vagueness signals.
function heuristicScore(text) {
  const t = text.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  // Goal: low if it's a vague verb with no concrete outcome.
  let goal = 1.0;
  if (/\b(fix|improve|enhance|optimi[sz]e|refactor|clean up|make better|tweak|update)\b/.test(t)
      && !has("so that", "in order to", "→", "->", "result", "output", "returns", "produces")) goal = 0.25;
  if (text.trim().split(/\s+/).length < 6) goal = Math.min(goal, 0.3); // one-liner with no detail

  // Constraint: low if no mention of an existing rule / contract / invariant to respect.
  let constraint = has("must", "constraint", "invariant", "preserve", "without breaking",
    "respect", "contract", "rule", "adr", "compat", "backward") ? 0.85 : 0.35;

  // Success: low if there's no measurable check.
  let success = has("test", "assert", "verify", "measure", "metric", "e2e", "expect",
    "should return", "pass", "coverage", "benchmark") ? 0.85 : 0.3;

  // Context: low if it conflicts-sounding or no anchor to existing system; high if spec exists.
  let context = specContext ? 0.8 : 0.55;
  if (has("not sure", "maybe", "somehow", "or something", "tbd", "figure out")) context = 0.2;

  return { goal_clarity: goal, constraint_clarity: constraint, success_clarity: success,
    context_clarity: context, mode: "heuristic" };
}

// ── optional LLM judge ───────────────────────────────────────────────────────
async function llmScore(text) {
  const key = process.env.HARNESS_JUDGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.HARNESS_JUDGE_MODEL || "gpt-4o-mini";
  const system = [
    "You are the Ambiguity Judge for an architectural change request. Score it on FOUR",
    "dimensions, each 0.0-1.0 (1.0 = fully clear). Return ONLY JSON, no prose:",
    '{ "goal_clarity":<0-1>, "constraint_clarity":<0-1>, "success_clarity":<0-1>,',
    '  "context_clarity":<0-1>, "missing_dims":[...], "rationale":"<one sentence>",',
    '  "suggested_spec_additions":["<bullet>", ...] }',
    "Goal LOW if 'fix bug'/'improve X' with no concrete outcome. Constraint LOW if no existing",
    "rule/contract named. Success LOW if no measurable check. Context LOW if it conflicts with",
    "the spec. Be HONEST — the user WANTS to be blocked when ambiguous.",
  ].join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Change description:\n${text}\n${specContext}` },
        ],
      }),
    });
    const j = await res.json();
    const out = j?.choices?.[0]?.message?.content || "";
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return { ...JSON.parse(m[0]), mode: "llm" };
  } catch { return null; }
}

// ── score ────────────────────────────────────────────────────────────────────
let s = (await llmScore(description)) || heuristicScore(description);

const W = { goal: 0.40, constraint: 0.30, success: 0.30, context: 0.15 };
const sumW = W.goal + W.constraint + W.success + W.context;
const a = Math.max(0, Math.min(1, 1 - (
  (s.goal_clarity || 0) * W.goal +
  (s.constraint_clarity || 0) * W.constraint +
  (s.success_clarity || 0) * W.success +
  (s.context_clarity || 0) * W.context
) / sumW));
const ambiguity = Number(a.toFixed(3));

// ── report ───────────────────────────────────────────────────────────────────
console.log("\n┌─ Architecture Ambiguity Gate ──────────────────────────────┐");
console.log(`│ mode               : ${s.mode}`);
console.log(`│ Goal clarity       : ${(s.goal_clarity || 0).toFixed(2)}`);
console.log(`│ Constraint clarity : ${(s.constraint_clarity || 0).toFixed(2)}`);
console.log(`│ Success clarity    : ${(s.success_clarity || 0).toFixed(2)}`);
console.log(`│ Context clarity    : ${(s.context_clarity || 0).toFixed(2)}`);
console.log(`│ Ambiguity          : ${ambiguity}  (threshold = 0.2)`);
if (s.rationale) console.log(`│ Rationale: ${String(s.rationale).slice(0, 70)}`);
if (s.missing_dims?.length) console.log(`│ Missing: ${s.missing_dims.join(", ")}`);
if (s.suggested_spec_additions?.length) {
  console.log("├─ Suggested spec additions ─────────────────────────────────┤");
  for (const x of s.suggested_spec_additions) console.log(`│   • ${String(x).slice(0, 70)}`);
}
console.log("└────────────────────────────────────────────────────────────┘\n");

if (ambiguity <= 0.2) {
  console.log("✓ PROCEED — spec is clear enough to write code.");
  process.exit(0);
} else {
  console.log(`✗ BLOCKED — ambiguity ${ambiguity} > 0.2`);
  console.log("  1) Write/extend .specify/spec.md with the missing dimensions (Goal/Constraint/Success/Context)");
  console.log("  2) Re-run this gate.  (Set OPENAI_API_KEY for a sharper LLM judge.)");
  if (force) { console.log("  ⚠ --force set, proceeding anyway. This counts as tech debt."); process.exit(0); }
  process.exit(1);
}
