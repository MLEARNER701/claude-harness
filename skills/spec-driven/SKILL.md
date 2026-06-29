---
name: spec-driven
description: Use BEFORE any "big" architectural change — new worker/service, DB schema change, new cross-cutting rule, LLM system-prompt change, new sub-agent, new external integration. Forces a specify → plan → tasks → implement workflow so design precedes code. Skip for small fixes, bug fixes that restore an existing invariant, or docs-only changes.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Spec-Driven Workflow

When invoked, force the four-stage workflow before code:

1. **specify** — write `.specify/specs/<feature>.md` describing Goal, Constraint, Success, Context.
2. **plan** — read the spec, write `.specify/plans/<feature>.md`: file-by-file change list, edit order, rollback plan.
3. **tasks** — read the plan, write `.specify/tasks/<feature>.md` with a concrete PR-size task list.
4. **implement** — only NOW write code. Re-read spec + plan + tasks first.

## When this skill activates

Activate for any of:
- new worker / service / background job
- new cross-cutting rule or invariant
- DB schema change / migration
- system-prompt structural change
- new sub-agent
- new external integration / API adapter

Do NOT activate for:
- small fix (typo, color, single-function regex)
- bug fix that restores an invariant already specified
- documentation-only update
- adding a test to existing behavior

## The workflow

### Step 1 — Resolve ambiguity FIRST
Before writing any spec, decide whether the change is well-specified. If the Goal, the Success
criterion, the Constraints (which existing rules must be preserved), or the Context (which part
of the system it touches) is unclear — **ask the user explicit questions** with 2–4 concrete
options each. Do not autonomously strengthen an underspecified spec unless the user has
explicitly authorized autonomous mode (and then flag it for review on close).

### Step 2 — specify
Create `.specify/specs/<kebab-name>.md`:
- **Goal** — one-paragraph outcome
- **Constraint** — existing rules / contracts this change must respect
- **Success** — a measurable test (a specific test name) + an e2e check
- **Context** — which subsystems/flows this touches

### Step 3 — plan
Read the spec. Write `.specify/plans/<name>.md`: file-by-file change list (`path:line`), edit
order (so the build never breaks midway), migration plan (if DB), rollback (one line).

### Step 4 — tasks
Extract concrete PR-size tasks from the plan into `.specify/tasks/<name>.md` (and/or your task
tracker). Each task = one reviewable chunk.

### Step 5 — implement
ONLY now write code. Re-read spec + plan + tasks first. Run the relevant tests after each task.

## Failure modes to avoid
1. **Skipping Step 1** — writing code without resolving ambiguity makes you the bug.
2. **Spec after code** — defeats the purpose; the spec must precede.
3. **Conflating plan and implement** — plan is file-level, not code-level.
4. **Ignoring a "blocked" ambiguity result** — don't force past it without explicit approval of the tech debt.
