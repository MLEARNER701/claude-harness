#!/usr/bin/env node
// scripts/dev/verify-fast.mjs
//
// The dev-loop's FAST INNER verifier (the tight-loop pass/fail oracle).
// The closed dev-loop runs this on every change (sub-second to a few seconds) as the inner
// pass/fail oracle; the OUTER gate before commit is still full `npm test` + ambiguity gate +
// the full review gate. This script does NOT replace `npm test` — it's the tight-loop signal so
// you catch syntax/obvious breakage immediately instead of after a 3-minute full run.
//
// What it checks (changed = staged + unstaged + untracked, vs HEAD):
//   1. SYNTAX: `node --check` on every changed *.js/*.mjs (catches the half of breakage that is
//      a typo/paren — the kind of breakage a full-suite run would catch later, but most breakage is syntactic).
//   2. SCOPED TESTS: run `node --test` on (a) changed *.test.mjs and (b) test files that import a
//      changed source module (grep the test tree for the module basename). If none match, skip —
//      the outer `npm test` gate is the backstop.
//
// Exit 0 = inner pass (proceed to outer gate). Exit 1 = inner fail (fix before wasting a full run).
// Never mutates the repo. Tolerant: a missing git / no changes → exit 0 with a note.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot(fallback) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || fallback; }
  catch { return fallback; }
}


const ROOT = repoRoot(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }); }
  catch { return ""; }
}

// changed = staged + unstaged + untracked, repo-relative, de-duped.
function changedFiles() {
  const out = new Set();
  for (const line of git(["status", "--porcelain"]).split("\n")) {
    const f = line.slice(3).trim();
    if (f && !f.startsWith('"C:')) out.add(f.replace(/^"|"$/g, ""));
  }
  for (const f of git(["diff", "--name-only", "HEAD"]).split("\n")) { if (f.trim()) out.add(f.trim()); }
  return [...out].filter((f) => existsSync(join(ROOT, f)));
}

// every *.test.mjs under tests/ (cheap one-time walk for the import-grep step).
function allTestFiles() {
  const tests = join(ROOT, "tests");
  const acc = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".test.mjs")) acc.push(p);
    }
  };
  if (existsSync(tests)) walk(tests);
  return acc;
}

const changed = changedFiles();
if (!changed.length) { console.log("[verify-fast] no changes vs HEAD — PASS (nothing to check)"); process.exit(0); }

// ── 1. SYNTAX ──────────────────────────────────────────────────────────────
const codeChanged = changed.filter((f) => [".js", ".mjs"].includes(extname(f)));
const syntaxFails = [];
for (const f of codeChanged) {
  const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { encoding: "utf8" });
  if (r.status !== 0) syntaxFails.push(`${f}\n${(r.stderr || "").split("\n").slice(0, 4).join("\n")}`);
}

// ── 2. SCOPED TESTS ────────────────────────────────────────────────────────
const scoped = new Set();
// (a) changed test files
for (const f of changed) if (f.endsWith(".test.mjs")) scoped.add(join(ROOT, f));
// (b) test files importing a changed source module (by basename without ext).
// Exclude BUILD ARTIFACTS (public/dist/build/node_modules): node tests never
// import the compiled SPA bundles, but a common basename there (e.g. a built
// `public/.../data.js`) would loose-match many unit tests by `/data.js` and
// false-scope them. Source modules that tests actually import live in src/scripts.
// PATH-AWARE match (not bare basename): use `<parent-dir>/<basename>` so a common
// name like schema/tier/basis/data/index only matches a test that imports THAT
// module's path (e.g. "ontology/schema.js"), not every unrelated `schema.js`. Bare
// basename matching collision-scoped unrelated tests → false-RED (batch interference).
const changedSrcRefs = codeChanged
  .filter((f) => !f.endsWith(".test.mjs"))
  .filter((f) => !/^(public|dist|build|node_modules|\.next|out)\//.test(f))
  .map((f) => {
    const base = basename(f, extname(f));
    if (base.length <= 1) return null;
    const dir = basename(dirname(f));
    return dir ? `${dir}/${base}` : base;
  })
  .filter(Boolean);
if (changedSrcRefs.length) {
  for (const tf of allTestFiles()) {
    let txt = "";
    try { txt = readFileSync(tf, "utf8"); } catch { continue; }
    if (changedSrcRefs.some((r) => txt.includes(`${r}.js`) || txt.includes(`${r}.mjs`))) {
      scoped.add(tf);
    }
  }
}
// Exclude ENV-DEPENDENT INTEGRATION tests from the FAST inner pass: they need a
// live server / bound port / spawned hermes, which the tight loop does not stand
// up — so they false-RED here even when the code is fine (the outer `npm test`
// gate, which provides that env, is their real home). Heuristic = the file
// stands up a server, binds a port, hits localhost, or spawns hermes.
const INTEGRATION_RE = /startServer|createServer|\.listen\(|http:\/\/(?:127\.0\.0\.1|localhost)|spawnSync?\([^)]*hermes|makeHermesRunner|listen\(\s*0\b|supertest/i;
function isEnvDependentIntegration(absPath) {
  try { return INTEGRATION_RE.test(readFileSync(absPath, "utf8")); } catch { return false; }
}
const deferredIntegration = [];
const scopedList = [...scoped]
  .filter((p) => { if (isEnvDependentIntegration(p)) { deferredIntegration.push(relative(ROOT, p)); return false; } return true; })
  .map((p) => relative(ROOT, p));

let testResult = { ran: false, ok: true, summary: "no scoped tests matched (outer npm test is the backstop)" };
if (scopedList.length) {
  // cap to avoid accidentally running the whole tree
  const run = scopedList.slice(0, 40);
  const r = spawnSync(process.execPath, ["--test", ...run.map((p) => join(ROOT, p))], { cwd: ROOT, encoding: "utf8" });
  const tail = (r.stdout || "") + (r.stderr || "");
  const m = tail.match(/# fail (\d+)/) || tail.match(/ℹ fail (\d+)/);
  const fails = m ? Number(m[1]) : (r.status === 0 ? 0 : 1);
  testResult = { ran: true, ok: r.status === 0 && fails === 0, count: run.length, fails, summary: tail.split("\n").filter((l) => /^(ℹ|#) (tests|pass|fail)/.test(l)).join(" · ") };
}

// ── verdict ────────────────────────────────────────────────────────────────
const ok = syntaxFails.length === 0 && testResult.ok;
console.log(`[verify-fast] changed=${changed.length} code=${codeChanged.length} scoped-tests=${scopedList.length}${deferredIntegration.length ? ` · deferred-integration=${deferredIntegration.length} (→ outer npm test)` : ""}`);
if (deferredIntegration.length) console.log(`DEFERRED (env-dependent, run in outer npm test): ${deferredIntegration.slice(0, 8).join(", ")}${deferredIntegration.length > 8 ? ` +${deferredIntegration.length - 8}` : ""}`);
if (syntaxFails.length) { console.log("SYNTAX FAIL:\n" + syntaxFails.join("\n---\n")); }
if (testResult.ran) console.log(`SCOPED TESTS: ${testResult.summary}`);
else console.log(`SCOPED TESTS: ${testResult.summary}`);
console.log(ok ? "✓ verify-fast PASS (→ run outer `npm test` gate before commit)" : "✗ verify-fast FAIL (fix before the full run)");
process.exit(ok ? 0 : 1);
