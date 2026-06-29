# CLAUDE.md — project rules for Claude Code

> Starter template from [claude-harness](https://github.com/MLEARNER701/claude-harness).
> Replace the `## Project` section with your stack/commands. The **working principles** below
> are domain-neutral engineering discipline — keep them. Delete what doesn't apply.

## Project

- **What this is:** <one sentence: what this codebase does, who uses it>
- **Stack:** <language / framework / runtime / DB>
- **Install:** `<install command>`
- **Test:** `<test command>`  ← also set this as `test_cmd` in `.harness.json`
- **Run:** `<run command>` · Health: `<health check>`

## Shared memory — read these first

The harness commits project memory under `.agent/` (git = ground truth, so it travels to every
clone / AI / human). Read before starting work:

- **`.agent/STATE.md`** — what works, what's in-progress, current focus.
- **`.agent/TASKS.md`** — open work-requests (surfaced into context on every prompt).
- **`.agent/SESSION_LOG.md`** — append-only log of what each session changed + why.
- **`.agent/FACTS.md`** — durable facts every session must know.

Append after a logical unit of work:
```
node scripts/claude-harness/agent-memory.mjs log  "<what changed + why>"
node scripts/claude-harness/agent-memory.mjs fact "<slug>" "<durable fact>"
node scripts/claude-harness/agent-memory.mjs show
```

---

## Working principles (domain-neutral — keep these)

### 1. pid ≠ progress — claim only what you can prove
A process started, a file exists, a command returned 0, "the server is up" — these are
*liveness* signals, **not** evidence of progress, completion, or correctness. Only claim a thing
is done when you have a closeout artifact: a passing test, a diff, a real output. No evidence →
do not claim it works. State what you actually verified and how.

### 2. Evidence-first for infra/config/code changes
Handle any infra/config/code problem in this order:
**STATUS → EVIDENCE → PLAN → APPROVAL → CHANGE → VERIFY.**
1. **STATUS** — read-only snapshot of the current state. Don't diagnose from memory.
2. **EVIDENCE** — separate user-report / claim / observed-fact / confirmed-cause.
3. **PLAN** — write the problem, success condition, options, risk, and rollback (even briefly).
4. **APPROVAL** — get sign-off before destructive or hard-to-reverse changes (delete, migrate,
   service stop, scheduled task, config mutation). Back up first.
5. **CHANGE** — smallest reversible unit. Separate a temporary workaround from the real fix.
6. **VERIFY** — re-run the same check and keep the output as evidence.

### 3. Search before you say "it's not there"
Before concluding something is missing or impossible: search the code, read the config, read the
docs, try 3–5 approaches. Then say it — with what you tried.

### 4. Reuse before you re-research (GAP-first)
Before investigating/comparing/rebuilding, check existing outputs (`.agent/`, prior docs, the
codebase) first. Classify what you find as CONFIRMED / STALE / CONFLICT / GAP, and only do new
work on STALE and GAP. Don't redo what's already settled.

### 5. Don't conflate separate system states
When several independent systems are in play (e.g. a build, a deploy, a long-running job), don't
blend them into one "it's done" claim. Report each state separately with its own evidence and
what claims it does / doesn't license.

### 6. Retry on error before surfacing it
Don't dump a raw error and stop. Try 3–5 alternative approaches. If it still fails, report the
cause + what you tried + the options — don't guess silently, and don't fabricate a result you
couldn't actually produce.

### 7. Confirm before irreversible / external actions
For deletes, config changes, scheduled tasks, or anything that sends data outside the machine:
state exactly what you'll do, confirm it's right, then act. (Read/search and pre-approved work
don't need confirmation.)

### 8. No secrets in git, no fabricated data
Secrets live in `.env` (gitignored); document keys in `.env.example`. Never hardcode a key or
commit a real `.env`. Never invent data, file contents, or API responses you didn't actually
get — a missing value stays null, an honest blocker beats a plausible fake.

---

## The verifier loop (this harness's core)

When you change live source and want to commit:
1. Spawn the **senior-code-reviewer** sub-agent on the uncommitted diff.
2. Fix its MUST-FIX findings.
3. It writes a receipt; the pre-commit gate then lets the commit through.

The receipt is model-written — it proves a review was *invoked this turn*, not that it was sound.
Its value is making a skipped review an explicit act (`--no-verify`), never a silent omission.
See `.claude/skills/verifier-review-loop/SKILL.md`.

## Hard rails

- No red commits — the test suite must be green before commit.
- No destructive git (`reset --hard`, `clean -f`, `rebase -i`, `push --force`) — the guard hook blocks these.
- DB schema changes additive-only unless explicitly approved.
- User-facing language / tone: <set your preference, e.g. "reply in Korean; code & commits in English">.
