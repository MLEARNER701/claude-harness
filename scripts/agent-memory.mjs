#!/usr/bin/env node
// scripts/agent-memory.mjs — real-time, git-committed project memory helpers.
//
// Any agent (Claude Code, Codex, Cursor, …) appends here so the NEXT session — in
// ANY tool — inherits context. Git is the ground truth: commit `.agent/` and the
// memory travels to every clone / AI / human. This is what makes the project state
// portable across tools (Claude's ~/.claude memory does not travel; this does).
//
//   node scripts/agent-memory.mjs log  "<what changed + why>"     → append .agent/SESSION_LOG.md
//   node scripts/agent-memory.mjs fact "<slug>" "<durable fact>"  → upsert .agent/FACTS.md
//   node scripts/agent-memory.mjs show                            → print STATE + recent log
//
// Set AGENT_ACTOR to label entries (e.g. AGENT_ACTOR="Codex"). Defaults to "agent".
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";
function repoRoot(fallback) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || fallback; }
  catch { return fallback; }
}


const ROOT = repoRoot(join(dirname(fileURLToPath(import.meta.url)), ".."));
const AGENT_DIR = join(ROOT, ".agent");
const LOG = join(AGENT_DIR, "SESSION_LOG.md");
const FACTS = join(AGENT_DIR, "FACTS.md");
const STATE = join(AGENT_DIR, "STATE.md");
const E2E = join(AGENT_DIR, "E2E_LOG.md");
const RESEARCH = join(AGENT_DIR, "RESEARCH_LOG.md");
const TASKS = join(AGENT_DIR, "TASKS.md");

const ensureDir = () => { if (!existsSync(AGENT_DIR)) mkdirSync(AGENT_DIR, { recursive: true }); };
const read = (p, fb = "") => (existsSync(p) ? readFileSync(p, "utf8") : fb);
const today = () => new Date().toISOString().slice(0, 10);
const actor = () => process.env.AGENT_ACTOR || "agent";
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cmdLog(text) {
  if (!text) { console.error('usage: agent-memory log "<text>"'); process.exit(1); }
  ensureDir();
  let body = read(LOG, "# SESSION LOG — append-only (newest at bottom)\n").replace(/\s*$/, "");
  const header = `## ${today()} · ${actor()}`;
  if (!body.includes(header)) body += `\n\n${header}`;
  body += `\n- ${text}`;
  writeFileSync(LOG, body + "\n");
  console.log("logged → .agent/SESSION_LOG.md");
}

function cmdFact(slug, text) {
  if (!slug || !text) { console.error('usage: agent-memory fact "<slug>" "<text>"'); process.exit(1); }
  ensureDir();
  let body = read(FACTS, "# FACTS — durable cross-AI knowledge\n").replace(/\s*$/, "");
  if (!body.includes("## Log-added facts")) body += "\n\n## Log-added facts";
  const line = `- **${slug}** (${today()}): ${text}`;
  const re = new RegExp(`^- \\*\\*${reEsc(slug)}\\*\\*.*$`, "m");
  body = re.test(body) ? body.replace(re, line) : body + `\n${line}`;
  writeFileSync(FACTS, body + "\n");
  console.log(`fact "${slug}" upserted → .agent/FACTS.md`);
}

// Append-only chained ledgers — e2e test runs + research/investigations. One
// line per entry so the chain accumulates and we stop re-running/re-researching.
function cmdAppend(path, file, fallbackTitle, text) {
  if (!text) { console.error(`usage: agent-memory ${file} "<one-line>"`); process.exit(1); }
  ensureDir();
  const body = read(path, `# ${fallbackTitle}\n`).replace(/\s*$/, "");
  writeFileSync(path, `${body}\n- ${today()} · ${actor()}: ${text}\n`);
  console.log(`appended → .agent/${path.split(/[\\/]/).pop()}`);
}

// Quick-capture a NEW work request so it is never dropped. Lands in TASKS.md
// ## Inbox (uncategorized) for triage into the curated OPEN list. The hook
// (hook-open-tasks.mjs) surfaces all `- [ ]` items, inbox included.
function cmdTask(text) {
  if (!text) { console.error('usage: agent-memory task "<request>"'); process.exit(1); }
  ensureDir();
  let body = read(TASKS, "# TASKS — work-request SSOT (정본)\n").replace(/\s*$/, "");
  if (!body.includes("## Inbox")) body += "\n\n## Inbox (uncategorized — triage into OPEN)";
  writeFileSync(TASKS, `${body}\n- [ ] (${today()} · ${actor()}) ${text}\n`);
  console.log("task captured → .agent/TASKS.md (## Inbox)");
}

function cmdShow() {
  process.stdout.write(read(STATE, "(no .agent/STATE.md)\n"));
  const tail = read(LOG, "").trimEnd().split("\n").slice(-15).join("\n");
  if (tail) process.stdout.write("\n--- recent session log ---\n" + tail + "\n");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "log") cmdLog(rest.join(" "));
else if (cmd === "fact") cmdFact(rest[0], rest.slice(1).join(" "));
else if (cmd === "e2e") cmdAppend(E2E, "E2E_LOG.md", "E2E TEST LOG — append-only, chronological", rest.join(" "));
else if (cmd === "research") cmdAppend(RESEARCH, "RESEARCH_LOG.md", "RESEARCH LOG — append-only, chronological", rest.join(" "));
else if (cmd === "task") cmdTask(rest.join(" "));
else if (cmd === "show") cmdShow();
else { console.error("usage: agent-memory <log|fact|e2e|research|task|show> ..."); process.exit(1); }
