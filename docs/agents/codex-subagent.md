# Using Codex as a coding subagent

> How ReMix is built from Phase 3 on. **Any Claude session that plans or runs feature work must follow this guide.** Linked from [CLAUDE.md](../../CLAUDE.md). In Claude Code, the `/codex-subagent` skill ([`.claude/skills/codex-subagent/SKILL.md`](../../.claude/skills/codex-subagent/SKILL.md)) walks the lead through it step by step.

## 1. Roles

| Who | Does |
| --- | --- |
| **Claude (lead)** | Plans the phase, writes contracts (`packages/types`) and ADRs, writes one prompt per track, launches Codex, reads the track report, checks CI, reviews code (money/auth/RLS line by line), merges. Refreshes graphify at phase end. |
| **Codex (subagent)** | Writes the code and tests for one track in its own git worktree, runs the gates, pushes, opens the PR, fixes CI until green, writes the report. Never merges. |
| **Claude Sonnet (fallback)** | Takes a track when Codex is out of quota (Agent tool, `model: sonnet`, same prompt file). |

Why: Codex spends the owner's ChatGPT quota, so Claude's limit is kept for planning and reviews. Two different model families (Codex writes, Claude reviews) catch more bugs than one.

## 2. Model and effort

Always pass the model explicitly (the Codex app can change the default in `~/.codex/config.toml`).

| Work | Model | Effort |
| --- | --- | --- |
| Money, auth, RLS, secrets, webhooks | `gpt-6.1-sol` | `high` |
| Features, UI, E2E | `gpt-6.1-sol` (or trial `gpt-6-astra`) | `medium` |
| Mechanical fixes | `gpt-6.1-sol` | `low` |

`gpt-6.1-astra` is not available on a ChatGPT login.

## 3. One-time setup (owner)

```bash
npm install -g @openai/codex
```

```bash
codex login
```

Check: `codex login status` → "Logged in using ChatGPT".

## 4. Running a track

1. **Contracts first.** The lead lands schemas/endpoints in `packages/types` (and any ADR) on `main` before the track starts.
2. **Write the prompt** to a file outside the repo (use the template in §6). One track = one area; keep it small enough to finish in one quota window.
3. **Check quota** (the usage-limit error blocks every model at once, whatever the app's percentage shows):

   ```bash
   codex exec --skip-git-repo-check -s read-only -m gpt-6.1-sol "Reply with only OK."
   ```

4. **Launch** with the helper (creates the worktree `../Remix-wt-<track>` from `origin/main` and logs to `../codex-runs/<track>/`):

   ```bash
   bash scripts/codex-track.sh <track> <branch> <effort> <prompt-file>
   ```

   The lead runs it with `run_in_background: true` and a 2 h timeout. Only one heavy track at a time.
5. **Watch** (optional, owner, in PowerShell):

   ```powershell
   Get-Content -LiteralPath ..\codex-runs\<track>\log.txt -Encoding UTF8 -Tail 40 -Wait
   ```

6. **When it ends**: read `../codex-runs/<track>/last.md` (the report). If it says `blocked` or `partial`, read the reason before anything else.
7. **Review** (§7), then `gh pr merge <n> --squash`, then remove the worktree (`git worktree remove --force ../Remix-wt-<track>`) and the local branch.

### Permission for the launch (Claude Code auto mode)

Claude Code's auto mode blocks a command that starts Codex with `-s danger-full-access`, so the lead cannot launch a track until the owner allows it. Pick one:

1. **Owner runs it** in Git Bash (same command as step 4), leaves the window open, and tells the lead when it ends.
2. **Allow it once for the project:** in an interactive `claude` terminal run `/permissions` and add the allow rule `Bash(bash scripts/codex-track.sh:*)`. After that the lead can launch tracks directly.
3. **Leave auto mode** for that session (permission mode menu in the app) and approve the call when asked.

The lead never changes permission settings itself or rewrites the command to get past the block.

### Resuming a stopped Codex session

The session id is in the first lines of the log. `exec resume` has no `-s` option:

```bash
codex exec resume <session-id> -m gpt-6.1-sol -c model_reasoning_effort=high --dangerously-bypass-approvals-and-sandbox -o ../codex-runs/<track>/last.md - < resume-prompt.md
```

Run it from inside the worktree. Do not resume while the old process is still alive ("already has an active writer").

## 5. Pitfalls we hit (and the fixes)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `CreateProcessWithLogonW failed: 5`; Codex can't run any shell command | `[windows] sandbox = "elevated"` in the Codex config | Run with `-s danger-full-access`, **only** inside a dedicated worktree, never the main checkout |
| Prompt symbols garbled (`âœ…`) | PowerShell 5.1 pipes text in a legacy code page | Launch from Git Bash (the helper does) |
| "Usage limit … try again at HH:MM" | ChatGPT 5-hour quota used up (applies to all models) | Wait for the time shown, or hand the track to Sonnet with the same prompt |
| "Selected model is at capacity" (exit 1, no commits) | OpenAI-side capacity for that model, not the owner's quota | Re-run the one-line check; when it answers, relaunch (fresh if nothing was committed, otherwise resume) |
| Scheduled start never happened | Background shells run in **UTC** (Sri Lanka is UTC+5:30) | Don't schedule by local time; start when quota is available |
| Background task "stopped after time limit" | Claude's background wrappers end at 2 h | Codex itself may still be running: check `Get-CimInstance Win32_Process` for `codex.exe exec` before relaunching |
| Resumed run used `gpt-5.5` / sandbox | `exec resume` reads the config defaults | Pass `-m` and `--dangerously-bypass-approvals-and-sandbox` |
| Huge logs, slow runs | Graphify ran; full staging runs repeated; big diffs printed | Prompts forbid graphify and require short output; full gate once at the end |
| `AGENTS.md` appears/disappears | Turbo writes it when an agent runs it; it is tracked on `main` | Leave it as it is |
| Build fails on Google Fonts | Fixed in #45 (fonts self-hosted) | — |
| Laptop sleep/shutdown kills runs | — | Plug in, disable sleep during runs; agents commit after each step |

## 6. Track prompt template

Every prompt contains, in this order:

1. Context: repo, stack, "you are in worktree `…` on branch `…`; work only here; run `pnpm install`".
2. READ FIRST: CLAUDE.md, the relevant ADRs, the phase board, the contract files ("do not change; if wrong, stop and report").
3. SCOPE: feature IDs and exact endpoints/tables/screens for this track, and what is **not** in scope.
4. TESTS: required tests (per-role, cross-tenant, isolation for new tables, idempotency/concurrency for money).
5. RULES (copy verbatim):
   - Do NOT run graphify; never commit `graphify-out/` changes. Leave `AGENTS.md` untouched.
   - Keep command output short (tail logs, no large diffs).
   - Affected-package tests while working; full gate once at the end.
   - Focused Conventional Commits with feature IDs; author = repo owner; **no AI co-author trailers**. Commit after each step.
   - No new dependency without a reason in the PR body. Never weaken RLS, grants, guards, CSP or tests.
   - Shared dev-stack Postgres/Valkey/S3 only; stop every process you start.
6. GATES: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → push → `gh pr create --base main` → `gh pr checks --watch` until all 6 pass → **do not merge**.
7. FINAL OUTPUT: report to `docs/plan/reports/<track>.md`, also the PR body (ending `🤖 Generated with Codex`), and as the final message.

### Report format

```text
# <track> report
- Status: done | partial | blocked
- Branch / PR: <url>
- Feature IDs: done: … | not done: …
- Gates: lint · typecheck · build · tests per package
- CI: <6 checks pass/fail>
- Migrations added: <files or "none">
- Contract changes (packages/types): <names or "none">
- New dependencies: <name — reason> or "none"
- Security-relevant changes: <one line each + file path>
- Deviations from plan/ADRs: <list or "none">
- Known issues / TODO: <list or "none">
- Review these files first (max 10): <paths>
```

## 7. Lead review checklist (before every merge)

- [ ] All 6 CI checks green on the **latest** push (re-run once for an obvious infrastructure flake, never twice without a cause).
- [ ] `gh pr diff <n> --name-only`: no `graphify-out/`, logs, `.env*`, or unrelated files.
- [ ] Report read; every "deviation" and "known issue" accepted or turned into a follow-up.
- [ ] Contract changes match `packages/types` decisions.
- [ ] Money/auth/RLS/secrets/webhooks: read the listed files line by line (grants, `withTenant`, guards, idempotency, locking, constant-time compares, no secrets in responses/logs/audit).
- [ ] New tables: RLS forced, grants minimal, isolation catalog updated.
- [ ] Squash merge; remove worktree and branch; update the phase board.
