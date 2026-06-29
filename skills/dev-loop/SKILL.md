---
name: dev-loop
description: A small, verifiable, closed development loop for autonomous coding — PICK (an open task) → WORK → VERIFY (two-tier: verify-fast inner + full test suite outer) → CLOSE (green commit / on red, one fix attempt then revert) → LOOP. Use when an agent develops a repo across many bounded units (especially self-driven / overnight runs). The test suite is the pass/fail oracle and the moat.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# dev-loop — small, verifiable, closed loop

## When
Use when developing a repo across **many bounded units** of work autonomously (self-driven /
overnight). For a single small fix this is overkill — just code.

## One iteration = PICK → WORK → VERIFY → CLOSE → LOOP

### 0. FRESH (every iteration — no in-memory residue)
Re-read state from disk, not from your own memory: `.agent/STATE.md`, recent `SESSION_LOG.md`,
open items in `TASKS.md`, `FACTS.md`, `git log -15`. grep your knowledge index before
re-researching anything.

### 1. PICK (human-seeded — do not invent tasks)
Pick **one bounded task** from `.agent/TASKS.md` open items. The agent only does priority
triage (what to do first). It does NOT invent new tasks autonomously (bounded + verifiable
principle). No open task → idle / exit.

### 2. WORK
- Small (< ~10 lines, single file, no DB/prompt/rule change) → just code.
- Big (worker / schema / core-loop / prompt / config registry) → run the `spec-driven` workflow
  (ambiguity gate → specify → plan → tasks → implement).

### 3. VERIFY (two-tier — the verifier is the pass/fail oracle)
- **inner (seconds, every change):** `node scripts/dev/verify-fast.mjs` — `node --check` on
  changed *.js/*.mjs + the tests that import a changed module. exit ≠ 0 → fix immediately
  (before wasting a full run).
- **outer gate (just before commit):** full `npm test` green. If a dev-only env flag breaks a
  test, override it to test the real regression, not the flag.

### 4. CLOSE
- **green** → one Conventional Commit (one logical unit) + append to `SESSION_LOG.md`. Do not
  push if the owner controls upstream.
- **red** → **one fix attempt.** Still red → revert that change (`git revert` / checkout),
  record the SKIP reason, move to the next task. **NEVER commit red** (a 1-attempt cap prevents
  an infinite fix loop).

### 5. LOOP
Hand off (what you finished + what's next), then either stop (e.g. elapsed ≥ a budget) or
schedule the next iteration starting fresh from step 0.

## HARD RAILS (invariant)
- Fixed branch · no push if owner-manual · zero secret/credential exposure · LF line endings.
- **No red commits** · no destructive git (reset --hard / clean / rebase -i) · DB changes additive only.
- Verification core + config registries are owner-gated — read-only in autonomous / overnight runs.
- The verifier is the moat: if the test suite is slow or flaky, the loop degrades → keep the
  two-tier split (fast inner + full outer) and quarantine flaky tests.
