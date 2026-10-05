---
name: codex-subagent
description: Plan, launch, monitor, resume and review a ReMix feature track written by Codex (OpenAI Codex CLI) as a coding subagent in its own git worktree, with Claude as lead. Use when the user asks to start, run, continue or check a track (e.g. "start 3-B", "run the next track with Codex", "is Codex done?", "resume the Codex run"), to write a track prompt, or to review and merge a Codex PR.
---

# Codex subagent (ReMix)

Codex writes the code for one track; you (Claude) are the lead. The full procedure, pitfalls, prompt template and report format are in [`docs/agents/codex-subagent.md`](../../../docs/agents/codex-subagent.md). Read it first; this skill is the checklist you follow each time.

## 1. Before launching

1. Find the track in the current phase board (`docs/plan/phase-<n>.md`): feature IDs, effort, reviewer. Check its Status row and `docs/plan/reports/` so you don't redo merged work.
2. Check `git log --oneline -5 origin/main` and `git worktree list`. If `../Remix-wt-<track>` exists, check `git -C ../Remix-wt-<track> log --oneline origin/main..` (commits there = resume, not restart).
3. Contracts the track needs must already be on `main` (`packages/types/src/api/*.ts`, `routes.ts`). Grep for every endpoint/schema the prompt names. If one is missing, land it first (lead work) or tell the user.
4. Check that the interfaces the track depends on can do what the prompt asks (e.g. a provider method it needs). Put any gap explicitly in SCOPE, never leave it for Codex to discover.
5. Write the prompt to the session scratchpad (`<track>-prompt.md`) using guide §6, in that order, and include:
   - the RULES block verbatim from guide §6;
   - **WORK ORDER + CHECKPOINTS**: numbered steps, "commit + push after each step passes its affected-package tests", "if commits already exist on the branch you are resuming: read `git log`, continue from the next unfinished step";
   - the exact report path `docs/plan/reports/<track>.md` and the report format from guide §6.
6. Effort: `high` for money/auth/RLS/secrets/webhooks, `medium` for features/UI/E2E, `low` for mechanical (guide §2).

## 2. Launch

1. Make sure no Codex run is already active (Codex desktop `app-server`/`exec-server` processes are fine):

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='codex.exe'" | Select-Object -ExpandProperty CommandLine
   ```

2. Quota check (one line; the usage-limit error blocks every model):

   ```bash
   codex exec --skip-git-repo-check -s read-only -m gpt-6.1-sol "Reply with only OK."
   ```

3. Launch from Git Bash with `run_in_background: true` and `timeout: 7200000`:

   ```bash
   bash scripts/codex-track.sh <track> <branch> <effort> <prompt-file>
   ```

4. **If Claude Code's auto mode blocks the launch** (it flags `-s danger-full-access`): do not retry or rephrase the command, and do not edit permission settings yourself. Tell the user why (full access is required because the Windows sandbox fails, and it is confined to the worktree) and offer:
   - they run the same command in Git Bash themselves, or
   - they add the allow rule `Bash(bash scripts/codex-track.sh:*)` via `/permissions` in an interactive `claude` terminal, then say "go", or
   - they switch this session out of auto mode and approve the call.

   Guide §4 "Permission for the launch" has the same text for the owner.

5. Tell the user in two or three lines: track, effort, what it delivers, where the log is (`../codex-runs/<track>/log.txt`), and that you'll review when it reports.

## 3. While it runs

- Don't poll. The background task notifies you when it ends. If the user asks, read the tail of the log (`tail -40 ../codex-runs/<track>/log.txt`) and `git -C ../Remix-wt-<track> log --oneline origin/main..`.
- A Claude background wrapper ends at 2 h, but `codex.exe exec` may keep running: check processes before relaunching.
- Usage limit hit (the helper exits 4) → tell the user the reset time from the log, offer to resume then, or hand the same prompt to a Sonnet Agent in the same worktree. Never schedule the restart by `date` in a background shell: it runs in UTC, Sri Lanka is UTC+5:30.

## 4. Resume

Session id is near the top of the log. Write a short resume prompt (what is merged since, what to continue, same rules, same report). Run from inside the worktree:

```bash
codex exec resume <session-id> -m gpt-6.1-sol -c model_reasoning_effort=<effort> --dangerously-bypass-approvals-and-sandbox -o ../codex-runs/<track>/last.md - < resume-prompt.md
```

The same auto-mode rule as §2.4 applies.

## 5. Review and merge

1. Read `../codex-runs/<track>/last.md` (the report). `blocked`/`partial` → read the reason first, then fix contracts or resume.
2. `gh pr checks <n>`: all 6 checks green on the latest push.
3. `gh pr diff <n> --name-only`: no `graphify-out/`, logs, `.env*`, unrelated files.
4. Read the report's "Review these files first" list. Money, auth, RLS, secrets and webhooks: read them line by line against guide §7 and DEVELOPMENT.md §5.
5. Findings → resume Codex with a fix list (preferred) or fix small things yourself on the branch.
6. Merge only with the user's standing OK for green track PRs: `gh pr merge <n> --squash`. Then `git worktree remove --force ../Remix-wt-<track>`, delete the local branch, `git pull` on main, update the phase board Status row.
7. Report to the user: what landed, what you checked, follow-ups, and the next track.

## Never

- Run Codex in the main checkout, or with full access outside a dedicated worktree.
- Let Codex merge, run graphify, edit `AGENTS.md`, or add AI co-author trailers.
- Bypass a permission denial by changing the command, the tool or the settings.
