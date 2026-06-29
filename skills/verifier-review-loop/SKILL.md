---
name: verifier-review-loop
description: The verifier-in-the-loop pattern — after writing live source code, spawn the senior-code-reviewer sub-agent to review the uncommitted diff, then write a verifier receipt that clears the pre-commit gate. Use whenever you've changed src/** in a turn and are about to commit. This is the harness's core differentiator: skipping the review becomes an explicit act, not a silent omission.
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# verifier-review-loop — review before commit

## What this is
A closed loop that makes a senior code review a **physical precondition for committing live
source**. The pieces:

- **`hook-verify-due.mjs`** (PostToolUse) — fires when you edit live `src/**` with no fresh
  receipt this turn; exits 2 so the model is told to review.
- **`senior-code-reviewer`** sub-agent — reviews the diff like a staff engineer, tells you
  WHAT / WHY / HOW, and writes a receipt on `pass`.
- **`verifier-receipt.mjs`** — the shared core: where a receipt lives, the freshness rule, and
  the pre-commit `check` gate.
- **pre-commit hook** — blocks the commit if live src is staged with no fresh receipt
  (`HARNESS_VERIFIER_GATE=block`, the default).

## When
You changed live source (`src/**`, `scripts/lib/**`, `scripts/dev/**`) this turn and want to commit.
(Pure test / docs / config edits don't require a receipt — the gate ignores them.)

## Loop
1. **Finish the code change.** Stage it: `git add <files>`.
2. **Spawn the reviewer** — launch the `senior-code-reviewer` sub-agent on the uncommitted diff.
   It reads `git diff` + the changed files + their callers, and reports findings by severity.
3. **Fix the MUST-FIX findings**, if any. Re-review if the changes were substantial.
4. **Write the receipt** (the reviewer does this on `pass`, or you do after applying fixes):
   ```
   node scripts/dev/verifier-receipt.mjs write \
     --verifier senior-code-reviewer \
     --files "<changed files, comma-sep>" \
     --note "<verdict + one-line summary>"
   ```
5. **Commit.** The pre-commit gate finds the fresh receipt and passes.

## Knobs
- `HARNESS_VERIFIER_GATE=block` (default) — no fresh receipt → commit blocked.
- `HARNESS_VERIFIER_GATE=warn` — print a reminder, never block.
- `HARNESS_VERIFIER_GATE=0` / `off` — disable the gate.
- Per-commit bypass: `git commit --no-verify`.

## Honest ceiling
The receipt is **model-written**. It proves a receipt exists and is fresh for this turn — it
does NOT prove a real, sound review happened. A model on auto-pilot could fabricate it. The
value is that skipping the review becomes an **explicit act** (fake receipt or `--no-verify`),
not a silent omission. Treat the receipt as an audit breadcrumb, not proof of quality.
