#!/usr/bin/env bash
# Claude Code PostToolUse → gate witness bridge (#308 Layer A, Source 3).
#
# Reads Claude Code's JSON hook payload on stdin (we ignore its
# specifics here — the mere fact of invocation is the activity
# signal), throttles, and calls `gate witness` on the parent
# substrate.
#
# Designed to fail open: when GUILD_WAVE_ID is unset the script
# exits 0 immediately so this hook is safe to install globally.

set -u   # NOT -e — a single failed witness must not block the agent.

# Required to fire. Without GUILD_WAVE_ID we have no wave to witness
# against; silent no-op is the right shape (the global hook installs
# safely without configuring every project).
: "${GUILD_WAVE_ID:=}"
if [ -z "$GUILD_WAVE_ID" ]; then
  exit 0
fi

# Actor identity. The SubAgent's registered guild member name.
: "${GUILD_ACTOR:=}"
if [ -z "$GUILD_ACTOR" ]; then
  echo "post-tool-use.sh: GUILD_ACTOR unset; skipping witness" >&2
  exit 0
fi

# Parent substrate location. When unset, gate walks up from cwd and
# may find the wrong substrate (or none). We do not error here so
# the hook fails open — but emit a one-line stderr nudge.
: "${GUILD_CONFIG:=}"
if [ -z "$GUILD_CONFIG" ]; then
  echo "post-tool-use.sh: GUILD_CONFIG unset; relying on cwd walk-up (may be wrong substrate)" >&2
fi

# Throttle: at most one witness call per THROTTLE_SEC per (wave, actor).
# Keyed in a runtime directory so concurrent SubAgents on different
# waves don't interfere. We use sub-second mtime granularity because
# Linux tmpfs is millisecond-resolution; macOS HFS is second-resolution
# and that's fine (the throttle has 30s defaults).
THROTTLE_SEC="${GUILD_WITNESS_THROTTLE_SEC:-30}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/guild-cli-witness"
mkdir -p "$RUNTIME_DIR" 2>/dev/null || true
# Sanitize the key to filesystem-safe chars (alphanumeric + dash).
KEY=$(printf '%s_%s' "$GUILD_WAVE_ID" "$GUILD_ACTOR" | tr -c 'A-Za-z0-9_-' '_')
THROTTLE_FILE="$RUNTIME_DIR/$KEY"

now=$(date +%s)
if [ -f "$THROTTLE_FILE" ]; then
  last=$(stat -f %m "$THROTTLE_FILE" 2>/dev/null || stat -c %Y "$THROTTLE_FILE" 2>/dev/null || echo 0)
  delta=$((now - last))
  if [ "$delta" -lt "$THROTTLE_SEC" ]; then
    exit 0
  fi
fi

# Coarse note: surfaces "this actor is alive and doing work."
# Specifics (which tool, which file) are deliberately omitted —
# `gate witness` dedupes identical notes (#246), so a coarse note
# also gives us free dedupe.
NOTE="${GUILD_WITNESS_NOTE:-tool-use heartbeat}"

# Resolve `gate` from PATH; respect GUILD_CLI_BIN override for
# environments without `gate` on PATH (the SubAgent's worktree
# might not have it installed globally).
GATE_BIN="${GUILD_CLI_BIN:-gate}"

# Fire and forget. We deliberately do NOT capture exit codes —
# the agent's actual work proceeds regardless. Errors land on stderr
# (preserved because we did not redirect).
"$GATE_BIN" witness "$GUILD_WAVE_ID" --by "$GUILD_ACTOR" --note "$NOTE" >/dev/null 2>>"$RUNTIME_DIR/witness.err" \
  && touch "$THROTTLE_FILE" \
  || true

exit 0
