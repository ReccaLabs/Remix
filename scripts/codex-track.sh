#!/usr/bin/env bash
# Run one Codex track in its own worktree. Guide: docs/agents/codex-subagent.md
#
#   bash scripts/codex-track.sh <track> <branch> <effort> <prompt-file> [model]
#
# Creates ../Remix-wt-<track> from origin/main (or reuses it), runs `codex exec` with full access
# inside that worktree only, and writes ../codex-runs/<track>/{log.txt,last.md}.
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "usage: bash scripts/codex-track.sh <track> <branch> <low|medium|high> <prompt-file> [model]" >&2
  exit 2
fi

track="$1"
branch="$2"
effort="$3"
prompt="$4"
model="${5:-gpt-6.1-sol}"

case "$effort" in low | medium | high) ;; *) echo "effort must be low, medium or high" >&2; exit 2 ;; esac
[ -f "$prompt" ] || { echo "prompt file not found: $prompt" >&2; exit 2; }

repo="$(git rev-parse --show-toplevel)"
parent="$(dirname "$repo")"
worktree="$parent/Remix-wt-$track"
runs="$parent/codex-runs/$track"
mkdir -p "$runs"

# npm installs a POSIX shim next to codex.cmd; Git Bash's PATH may not include it.
codex_bin="$(command -v codex || true)"
[ -n "$codex_bin" ] || codex_bin="${APPDATA:-$HOME/AppData/Roaming}/npm/codex"
[ -x "$codex_bin" ] || { echo "codex CLI not found; see docs/agents/codex-subagent.md §3" >&2; exit 2; }

if [ ! -d "$worktree" ]; then
  git -C "$repo" fetch -q origin
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$repo" worktree add -q "$worktree" "$branch"
  else
    git -C "$repo" worktree add -q -b "$branch" "$worktree" origin/main
  fi
fi

if pgrep -f "codex.*exec.*Remix-wt-$track" >/dev/null 2>&1; then
  echo "a Codex run for $track is already active" >&2
  exit 3
fi

echo "track=$track branch=$branch effort=$effort model=$model worktree=$worktree"
cd "$worktree"
# Full access is required on this Windows setup (the elevated sandbox cannot spawn processes);
# it is confined to the dedicated worktree. Git Bash keeps the prompt in UTF-8.
set +e
"$codex_bin" exec -C "$worktree" -m "$model" -c "model_reasoning_effort=$effort" \
  -s danger-full-access -o "$runs/last.md" - <"$prompt" >"$runs/log.txt" 2>&1
status=$?
set -e

if grep -q "usage limit" "$runs/log.txt"; then
  grep -m1 "usage limit" "$runs/log.txt" >&2
  exit 4
fi
echo "codex exit $status; report: $runs/last.md"
exit "$status"
