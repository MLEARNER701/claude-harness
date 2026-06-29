#!/usr/bin/env node
// scripts/hook-render-last-response.mjs
//
// Claude Code Stop hook. Triggers after every assistant turn.
//
// Reads stdin JSON from Claude Code:
//   { session_id, cwd, hook_event_name: "Stop", stop_hook_active: bool }
//
// Then:
//   1. Locates this session's transcript JSONL under ~/.claude/projects/
//   2. Extracts the LAST assistant message
//   3. Saves it as runtime/responses/_hook-latest.md
//   4. Renders to HTML via render-response.mjs (--no-open, index auto-refreshes)
//
// Anti-loop: respects `stop_hook_active=true` and exits immediately.
// Anti-recursion: render-response.mjs is a node script, not a Claude session,
// so it cannot re-trigger Stop.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { deriveTitle, validateOwnerFormat } from "./lib/response-format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ─── 1. Read stdin (Claude Code hook payload) ─────────────────────────
let payload = {};
let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
  payload = JSON.parse(stdin || "{}");
} catch {
  // Tolerant: if invoked manually without stdin, fall through.
}

// Debug trace — always log fire event so we know hook ran.
const PROJECT_ROOT_FOR_LOG = resolve(__dirname, "..");
const debugLog = (msg) => {
  try {
    const logPath = join(PROJECT_ROOT_FOR_LOG, "runtime", "responses", "_hook-debug.log");
    const entry = `${new Date().toISOString()} ${msg}\n`;
    if (existsSync(dirname(logPath))) {
      const cur = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      writeFileSync(logPath, cur + entry, "utf8");
    }
  } catch {/* never fail the hook */}
};
debugLog(`fired · stdin.length=${stdin.length} · keys=${Object.keys(payload).join(",")} · session_id=${payload.session_id || "(none)"} · stop_hook_active=${payload.stop_hook_active}`);

if (payload.stop_hook_active === true) {
  // Anti-loop: another Stop hook already triggered a continuation.
  process.exit(0);
}

// T92-2 (owner 2026-06-14, 정제 강제): defer to the agent's manual tick-live render.
// If .live-lock is fresh (the agent curated live.html + archive this turn with a clean
// Korean 4-section + clean --title), skip — never clobber with the raw response text
// (run-on first-line titles, English leak). tick-live is the authoritative renderer.
try {
  const lock = join(PROJECT_ROOT, "runtime", "responses", ".live-lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 180_000) {
    debugLog("skip: .live-lock fresh (agent tick-live owns this turn)");
    process.exit(0);
  }
} catch {/* lock check best-effort */}

const sessionId = payload.session_id || "";
if (!sessionId) {
  // No session_id → cannot locate transcript. Exit silently.
  process.exit(0);
}

// ─── 2. Locate session transcript ─────────────────────────────────────
// Claude Code stores transcripts at:
//   ~/.claude/projects/<encoded-project-path>/<session_id>.jsonl
// where encoded-project-path = the cwd with separators replaced by "-"
// (and a leading "C--" on Windows). To avoid encoding ambiguities, just
// glob ~/.claude/projects/*/$sessionId.jsonl.
const projectsRoot = join(homedir(), ".claude", "projects");
let transcriptPath = null;
if (existsSync(projectsRoot)) {
  for (const proj of readdirSync(projectsRoot)) {
    const candidate = join(projectsRoot, proj, `${sessionId}.jsonl`);
    if (existsSync(candidate)) { transcriptPath = candidate; break; }
  }
}
if (!transcriptPath) {
  // Transcript not found. Exit silently — never block Claude Code.
  process.exit(0);
}

// ─── 3. Extract last assistant message ────────────────────────────────
let lines;
try {
  lines = readFileSync(transcriptPath, "utf8").split(/\r?\n/).filter(Boolean);
} catch {
  process.exit(0);
}

let lastAssistant = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const m = JSON.parse(lines[i]);
    // Claude Code transcript message shape: { type: "assistant", message: { role: "assistant", content: [...] } }
    // or simpler { role: "assistant", content: "..." }
    const role = m.role || m.message?.role || m.type;
    if (role !== "assistant") continue;
    const content = m.message?.content ?? m.content;
    if (!content) continue;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      // Concatenate text blocks; skip tool_use / tool_result blocks.
      text = content
        .filter((c) => c.type === "text" || typeof c === "string")
        .map((c) => (typeof c === "string" ? c : c.text || ""))
        .join("\n\n");
    }
    if (text.trim()) { lastAssistant = text.trim(); break; }
  } catch {
    /* skip malformed line */
  }
}

if (!lastAssistant) process.exit(0);

// ─── 4. Save + render ────────────────────────────────────────────────
const OUT_DIR = join(PROJECT_ROOT, "runtime", "responses");
if (!existsSync(OUT_DIR)) process.exit(0); // not initialized — skip

// Save the markdown source (overwritten each tick — index keeps the rendered HTML history).
const mdPath = join(OUT_DIR, "_hook-latest.md");
writeFileSync(mdPath, lastAssistant, "utf8");

// Title = REPRESENTATIVE work summary (T93). deriveTitle skips the scaffold/status
// headings ("📍 현재 위치", section headers) and the run-on first line that used to
// flood the sidebar slug, preferring the turn's own "방금 한 것: …" work summary.
const title = deriveTitle(lastAssistant, "Claude 응답");
// Owner-format compliance audit (T93). Non-blocking: we log the verdict so the
// audit trail shows whether the turn met the mandated 4-section Korean format,
// without ever blocking the render (which would leave live.html stale).
const fmt = validateOwnerFormat(lastAssistant);
debugLog(`format ${fmt.ok ? "OK" : "MISSING:" + fmt.missing.join(",")} · title="${title.slice(0, 40)}"`);

// Render — --no-open keeps the existing index page in the user's browser,
// which auto-refreshes every 30s and picks up the new entry on next tick.
const renderScript = join(PROJECT_ROOT, "scripts", "render-response.mjs");
spawnSync("node", [renderScript, "--title", title, "--in", mdPath, "--no-open"], {
  stdio: "ignore",
  cwd: PROJECT_ROOT,
  timeout: 20_000,
});

// Also write to live.html (a single canonical tab you can keep open).
// render-response.mjs only updates _index.html + timestamped archives;
// live.html is the meta-refresh tab and needs a separate tick.
const tickLiveScript = join(PROJECT_ROOT, "scripts", "tick-live.mjs");
spawnSync("node", [tickLiveScript, "--title", title, "--in", mdPath], {
  stdio: "ignore",
  cwd: PROJECT_ROOT,
  timeout: 15_000,
});
debugLog(`tick-live + render-response dispatched · title="${title.slice(0,40)}"`);

process.exit(0);
