# claude-harness

A **verifier-in-the-loop** harness for [Claude Code](https://docs.claude.com/en/docs/claude-code).
Drop it into any project and you get lifecycle hooks (guardrails + reminders), a
`senior-code-reviewer` sub-agent, and a **pre-commit receipt gate** that turns "did anyone review
this code?" from a silent omission into an explicit act.

It is non-destructive: the installer *merges* into your existing `.claude/settings.json` and never
clobbers an existing `pre-commit` hook.

## Why this exists

Most Claude Code setups are spec-first (plan → tasks → implement). This harness adds the part that
comes *after* the code is written: a **closed verification loop with a physical commit gate**.

| Capability | What it does |
|---|---|
| **Verifier receipt gate** | If live `src/**` is staged with no fresh code-review receipt, the pre-commit hook **blocks the commit**. Skipping review now requires `--no-verify` or a faked receipt — an explicit act. |
| **senior-code-reviewer** | A sub-agent that reviews the uncommitted diff like a staff engineer (correctness/wiring, de-dup, SOLID, tests), reports WHAT/WHY/HOW by severity, and writes the receipt on `pass`. |
| **Destructive-command guard** | `PreToolUse` hook blocks `git reset --hard`, `git clean -f`, `rebase -i`, `push --force`, `rm -rf` before they run. |
| **Secret guard** | `PreToolUse` hook blocks edits to `.env` / `.env.*` (templates like `.env.example` allowed). |
| **Syntax check** | `PostToolUse` hook runs `node --check` on every edited JS file and feeds errors back in the same turn. |
| **verify-fast** | A fast inner oracle: `node --check` on changed files + the `node:test` files that import them. The tight-loop signal before the full suite. |
| **Context hooks** | `SessionStart` injects your governing-principles TL;DR; `UserPromptSubmit` re-surfaces open tasks from `.agent/TASKS.md` so earlier requests aren't dropped. |
| **Skills** | `dev-loop` (small verifiable closed loop), `spec-driven` (design before code), `verifier-review-loop` (how to drive the gate). |
| **/security-review** | Slash command for a local security pass over the uncommitted diff. |

### Honest ceiling (read this)

The verifier receipt is **model-written**. The gate enforces that *a fresh, verifier-shaped
receipt exists for this turn* — it does **not** and **cannot** prove a real, sound review
happened. A model on auto-pilot could fabricate the JSON. The value is that **skipping the
review becomes an explicit act** (write a false receipt, or pass `--no-verify`), not a silent
omission. Treat the receipt as an audit-trail breadcrumb, not proof of quality.

## Install

```bash
git clone https://github.com/MLEARNER701/claude-harness.git
cd claude-harness
./install.sh /path/to/your/project
```

Then **restart Claude Code** in your project so it reloads `.claude/settings.json`.

The installer:
- copies hooks + the verifier core into `<project>/scripts/claude-harness/`
- deep-merges the hooks block into `<project>/.claude/settings.json` (dedupes by command)
- copies `agents/`, `skills/`, `commands/` into `<project>/.claude/`
- installs the `pre-commit` gate (only if you don't already have one)
- scaffolds `.harness.json` and `.agent/TASKS.md` if absent

Requirements: **Node ≥ 18** and **git** on PATH. Hooks are plain Node ESM with zero dependencies.

## Configure

| Knob | Values | Effect |
|---|---|---|
| `HARNESS_VERIFIER_GATE` | `block` (default) · `warn` · `0`/`off` | pre-commit behavior when a fresh receipt is missing |
| `HARNESS_PRECOMMIT` | `1` (default) · `0` | set `0` to disable the whole pre-commit gate for a session |
| `git commit --no-verify` | — | bypass the gate for one commit |
| `.harness.json` `{ "test_cmd": "..." }` | — | the outer test gate command (optional) |

## How the loop runs

1. You edit live source. The `hook-verify-due` PostToolUse hook notices there's no fresh receipt
   and tells you to review.
2. You spawn the `senior-code-reviewer` sub-agent on the diff. It reports findings; you fix
   MUST-FIX items.
3. The reviewer (or you) writes a receipt:
   ```bash
   node scripts/claude-harness/dev/verifier-receipt.mjs write \
     --verifier senior-code-reviewer --files "src/a.js,src/b.js" --note "pass: <summary>"
   ```
4. `git commit` — the pre-commit gate finds the fresh receipt and lets the commit through.

See `skills/verifier-review-loop/SKILL.md` for the full walkthrough.

## Optional display hooks

`scripts/claude-harness/optional/` ships three extra hooks (last-response renderer, workflow
emitter, arch-graph). They write to a local `runtime/` dir and are **not** wired by default —
add them to your `Stop` hook block manually if you want them.

## Layout

```
hooks/                     core lifecycle hooks (wired by settings.template.json)
hooks/optional/            display/diagnostic hooks (opt-in)
scripts/dev/               verifier-receipt.mjs, verify-fast.mjs, pre-commit, install-git-hooks.sh
scripts/agent-memory.mjs   git-committed project memory helper (.agent/)
agents/                    senior-code-reviewer, qa-verifier
skills/                    dev-loop, spec-driven, verifier-review-loop
commands/                  security-review
settings.template.json     the hooks block the installer merges in
install.sh                 non-destructive merge installer
```

## Credits

Hook lifecycle patterns inspired by the Claude Code community
([disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery)) and the
security-review slash command shape from
[anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review).
The verifier-receipt commit gate is the original contribution here.

## License

MIT — see [LICENSE](./LICENSE).
