#!/usr/bin/env node
// scripts/dev/hook-arch-graph.mjs
//
// Claude Code Stop hook for T30. Regenerates the code-derived harness graph
// and self-contained architecture.html after a task. Never throws; exits 0.
// It intentionally does not read runtime/responses/live.html.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

function safeExit() { process.exit(0); }

try {
  if (process.env.ARCH_GRAPH_HOOK_DISABLE || process.env.WORKFLOW_EMIT_DISABLE) safeExit();

  let payload = {};
  try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  if (payload.stop_hook_active === true) safeExit();

  const generatedAt = new Date().toISOString();
  const gitHead = currentGitHead();
  const env = {
    ...process.env,
    ARCH_GRAPH_GENERATED_AT: generatedAt,
    ARCH_DASHBOARD_GENERATED_AT: generatedAt,
    ...(gitHead ? { ARCH_GRAPH_GIT_HEAD: gitHead } : {}),
  };

  runNode(["scripts/dev/gen-harness-graph.mjs", "--generated-at", generatedAt, ...(gitHead ? ["--git-head", gitHead] : [])], env);
  runNode(["scripts/dev/gen-architecture-html.mjs"], env);
} catch {
  // Hooks must not block the agent session.
}

safeExit();

function currentGitHead() {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true,
    });
    return r.status === 0 ? String(r.stdout || "").trim() : null;
  } catch {
    return null;
  }
}

function runNode(args, env) {
  try {
    spawnSync("node", args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: "ignore",
      timeout: 45_000,
      windowsHide: true,
    });
  } catch {
    // best effort only
  }
}
