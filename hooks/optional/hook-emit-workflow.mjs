#!/usr/bin/env node
// scripts/dev/hook-emit-workflow.mjs
//
// Claude Code Stop hook (SECOND in the Stop array, after hook-render-last-response).
// Emits, for the turn that just ended:
//   (a) a Mermaid flowchart of the tool_use SEQUENCE (what the turn did), and
//   (b) the list of changed files grouped by category.
// Appends both to runtime/responses/_hook-latest.md (the answer doc) and re-renders
// live.html via the existing tick-live → render-mermaid pipeline.
//
// Reference patterns: disler/claude-code-hooks-mastery (Stop semantics + anti-loop),
// patoles/agent-flow (transcript→graph), anthropics/skills. No new server/deps —
// reuses find-transcript + git-classify libs + tick-live (mermaid already vendored).
//
// Discipline (mirrors hook-render-last-response.mjs): never throw, exit 0 on any
// error (never block Claude Code); honor stop_hook_active; honor WORKFLOW_EMIT_DISABLE;
// do NOT read live.html/_latest as input (self-reference ban).

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { findTranscript } from "./lib/find-transcript.mjs";
import { gitChanges, classify } from "./lib/git-classify.mjs";
import { LAYER_ORDER, LAYER_META } from "./lib/layer-classify.mjs";
import { deriveTitle } from "../lib/response-format.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

function safeExit() { process.exit(0); }

try {
  if (process.env.WORKFLOW_EMIT_DISABLE) safeExit();

  let payload = {};
  try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  if (payload.stop_hook_active === true) safeExit(); // anti-loop

  // T92-2 (owner 2026-06-14, 정제 강제): if the agent curated live.html this turn via
  // tick-live (.live-lock fresh), do NOT clobber it with the raw tool-call workflow
  // (the owner finds the auto "Bash: ..." labels useless). tick-live output is canon.
  try {
    const lock = resolve(PROJECT_ROOT, "runtime", "responses", ".live-lock");
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 180_000) safeExit();
  } catch {/* lock check best-effort */}

  const sessionId = payload.session_id || "";
  const cwd = payload.cwd || PROJECT_ROOT;
  const transcript = findTranscript(sessionId);
  if (!transcript) safeExit();

  const lines = readFileSync(transcript, "utf8").split(/\r?\n/).filter(Boolean);
  const msgs = [];
  for (const l of lines) { try { msgs.push(JSON.parse(l)); } catch {} }

  // ── find the last real user turn boundary ──
  const roleOf = (m) => m.role || m.message?.role || m.type;
  const contentOf = (m) => m.message?.content ?? m.content;
  const isUserText = (m) => {
    if (roleOf(m) !== "user") return false;
    const c = contentOf(m);
    if (typeof c === "string") return c.trim().length > 0;
    if (Array.isArray(c)) return c.some((b) => b && (b.type === "text" || typeof b === "string"));
    return false;
  };
  let startIdx = 0;
  for (let i = msgs.length - 1; i >= 0; i--) { if (isUserText(msgs[i])) { startIdx = i; break; } }

  // ── collect tool_use sequence + result status from startIdx → end ──
  const steps = [];
  const byId = new Map();
  for (let i = startIdx; i < msgs.length; i++) {
    const m = msgs[i];
    const c = contentOf(m);
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b && b.type === "tool_use") {
        const step = { name: b.name || "tool", detail: toolDetail(b.name, b.input || {}), ok: true };
        steps.push(step);
        if (b.id) byId.set(b.id, step);
      } else if (b && b.type === "tool_result") {
        const s = b.tool_use_id && byId.get(b.tool_use_id);
        if (s && b.is_error) s.ok = false;
      }
    }
  }

  if (steps.length === 0) safeExit(); // nothing tool-driven this turn

  const collapsed = collapse(steps);
  const mermaid = toMermaid(collapsed);
  const changed = changedFilesSection(cwd);

  const section =
    `\n\n---\n\n## 🗺️ 이번 턴 워크플로\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n${changed}\n`;

  const OUT_DIR = join(PROJECT_ROOT, "runtime", "responses");
  if (!existsSync(OUT_DIR)) safeExit();
  const mdPath = join(OUT_DIR, "_hook-latest.md");
  let base = "";
  try { if (existsSync(mdPath)) base = readFileSync(mdPath, "utf8"); } catch {}
  // Avoid duplicate append if the previous render already has our section.
  const composed = base.includes("## 🗺️ 이번 턴 워크플로")
    ? base.replace(/\n\n---\n\n## 🗺️ 이번 턴 워크플로[\s\S]*$/, section)
    : base + section;
  writeFileSync(mdPath, composed, "utf8");
  // also a standalone copy for inspection / the architecture panel.
  writeFileSync(join(OUT_DIR, "_workflow-latest.md"), section.trimStart(), "utf8");

  // T113 (owner 2026-06-19, repeated MUST): this hook NO LONGER re-renders live.html.
  // It used to tick-live the (response + appended workflow) doc, but when
  // render-last-response had SKIPPED a non-4-section turn, `base` was stale/empty, so the
  // re-render produced a live.html whose BODY was ONLY the "바뀐 파일/워크플로" section —
  // the response body vanished (the bad screenshot the owner kept flagging). live.html is
  // now owned SOLELY by hook-render-last-response (the response) + manual tick-live. The
  // turn workflow/changed-files lives in _workflow-latest.md (+ the architecture panel),
  // and the response already carries its own §2 아키텍처 mermaid — so this was redundant.
  // (deriveTitle import retained for _workflow-latest.md consumers / future use.)
  void deriveTitle;
} catch { /* never block Claude Code */ }
safeExit();

// ─── helpers ─────────────────────────────────────────────────────────
function toolDetail(name, input) {
  const n = String(name || "");
  const b = (p) => (p ? basename(String(p)) : "");
  if (/^(Edit|Write|Read|NotebookEdit)$/.test(n)) return b(input.file_path || input.notebook_path);
  if (/Bash|PowerShell/.test(n)) return String(input.description || input.command || "").slice(0, 40);
  if (n === "Grep") return String(input.pattern || "").slice(0, 30);
  if (n === "Glob") return String(input.pattern || "").slice(0, 30);
  if (n === "Agent" || /Task/.test(n)) return String(input.description || input.subagent_type || "").slice(0, 34);
  if (n === "Workflow") return String(input.name || "workflow").slice(0, 30);
  if (/WebSearch|WebFetch/.test(n)) return String(input.query || input.url || "").slice(0, 34);
  if (n === "Skill") return String(input.skill || "").slice(0, 30);
  if (n === "ToolSearch") return String(input.query || "").slice(0, 30);
  return "";
}

// collapse consecutive same-name steps → {name, detail, ok, count}
function collapse(steps) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.name === s.name) {
      prev.count += 1;
      prev.ok = prev.ok && s.ok;
      if (prev.count <= 3 && s.detail) prev.details.push(s.detail);
    } else {
      out.push({ name: s.name, ok: s.ok, count: 1, details: s.detail ? [s.detail] : [] });
    }
  }
  return out;
}

function esc(s) {
  return String(s || "").replace(/["`]/g, "'").replace(/[\n\r]/g, " ").replace(/[\[\]{}]/g, "");
}

// T82: render the git porcelain XY code as a human Korean label instead of the
// raw "M"/"??"/"A" that leaked into live.html. gitChanges already trims the code
// (untracked → "??"); map on the first meaningful status letter.
function codeLabel(code) {
  const c = String(code || "").trim();
  if (c === "??" || /^A/.test(c)) return "신규";
  if (/^M/.test(c) || /M$/.test(c)) return "수정";
  if (/^D/.test(c) || /D$/.test(c)) return "삭제";
  if (/^R/.test(c)) return "이름변경";
  if (/^C/.test(c)) return "복사";
  if (/^U/.test(c) || c === "DD" || c === "AA") return "충돌";
  return c || "변경";
}

function toMermaid(collapsed) {
  const lines = ["flowchart TD", '  u(["👤 사용자 prompt"])'];
  const fails = [];
  let prev = "u";
  collapsed.slice(0, 16).forEach((c, i) => {
    const id = `n${i}`;
    const det = c.details.slice(0, 2).join(", ");
    const label = esc(`${c.name}${c.count > 1 ? ` ×${c.count}` : ""}${det ? `: ${det}` : ""}`).slice(0, 52);
    lines.push(`  ${id}["${label}"]`);
    lines.push(`  ${prev} --> ${id}`);
    if (!c.ok) fails.push(id);
    prev = id;
  });
  lines.push(`  ${prev} --> done(["✅ 완료"])`);
  if (fails.length) {
    lines.push("  classDef fail fill:#5b1a1a,stroke:#ff8888,color:#fff;");
    lines.push(`  class ${fails.join(",")} fail;`);
  }
  return lines.join("\n");
}

function changedFilesSection(cwd) {
  let changes = [];
  try { changes = gitChanges(cwd); } catch {}

  // classify once: keep dir-category (existing) + canon layer (new, additive)
  const items = [];
  for (const c of changes) {
    let cls = null;
    try { cls = classify(c.path); } catch {}
    if (!cls) continue;
    items.push({ code: c.code, path: c.path, category: cls.category, layer: cls.layer || "Other" });
  }
  if (items.length === 0) return "## 📝 바뀐 파일\n\n_(추적 대상 변경 없음)_";

  // small helper: layer chip markdown. Emits a {{chip:...}} sentinel that
  // tick-live renderInline turns into a styled <span class="layer-chip">.
  // Falls back to inline code in any other markdown renderer. Never throws.
  const chip = (layer) => {
    const meta = (LAYER_META && LAYER_META[layer]) || { icon: "📦", ko: layer || "기타" };
    return `{{chip:${meta.icon} ${meta.ko}}}`;
  };

  const out = [];

  // ── (a) grouped by canon LAYER (canon sort order) ──
  out.push("## 📝 바뀐 파일 — 레이어별\n");
  const byLayer = new Map();
  for (const it of items) {
    if (!byLayer.has(it.layer)) byLayer.set(it.layer, []);
    byLayer.get(it.layer).push(it);
  }
  const order = Array.isArray(LAYER_ORDER) ? LAYER_ORDER : [];
  const layerKeys = [...byLayer.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  for (const layer of layerKeys) {
    const list = byLayer.get(layer);
    out.push(`- ${chip(layer)} (${list.length})`);
    for (const it of list.slice(0, 8)) out.push(`  - \`${it.path}\` _(${codeLabel(it.code)})_`);
    if (list.length > 8) out.push(`  - (+${list.length - 8} more)`);
  }

  // ── (b) dir-category grouping (existing consumers) + per-file 레이어 line ──
  out.push("\n### 디렉터리 카테고리별\n");
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  }
  for (const [cat, list] of groups) {
    out.push(`- **${cat}** (${list.length})`);
    for (const it of list.slice(0, 8)) out.push(`  - \`${it.path}\` _(${codeLabel(it.code)})_ — 레이어: ${chip(it.layer)}`);
    if (list.length > 8) out.push(`  - (+${list.length - 8} more)`);
  }
  return out.join("\n");
}
