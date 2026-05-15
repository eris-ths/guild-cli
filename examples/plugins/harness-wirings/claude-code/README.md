# Claude Code → guild-cli activity bridge

A worked example of bridging Claude Code's `PostToolUse` hook to
`gate witness`, so a SubAgent running in worktree isolation surfaces
its in-flight activity to the orchestrator's `gate wave-status` /
`gate swarm-status` views.

This is **Source 3** in the [#308](https://github.com/eris-ths/guild-cli/issues/308)
Layer A bundle: harness-specific wiring lives in `examples/`, not in
core. Each harness that wants the equivalent contributes its own
wiring file alongside this one.

## When you need this

You're running a SubAgent (under Claude Code's Agent tool) that does
real implementation work in worktree isolation. The orchestrator's
`gate wave-status <id>` shows `(in progress — no recent attributable
write)` for the SubAgent because guild-cli's substrate sees no
`gate witness` calls from inside the worktree.

This wiring fires `gate witness` automatically on every Claude Code
tool call, so the orchestrator's view shows fresh activity without
the SubAgent's prompt needing explicit `gate witness` boilerplate.

## What this does NOT do

- Does not intercept agent decisions — `PostToolUse` is after-the-
  fact, observational only.
- Does not replace explicit `gate witness` calls — the hook surfaces
  *tool activity*, not *progress narrative*. The SubAgent should
  still emit a meaningful witness note at slice boundaries (start,
  midpoint, end) so the substrate carries the story, not just the
  heartbeat.
- Does not work cross-harness — if your SubAgent runs under Codex,
  Gemini CLI, or a custom orchestrator, you need a parallel wiring
  for that harness. See `../` for siblings (currently empty; pull
  requests welcome).

## Setup

### 1. The hook script

`post-tool-use.sh` is the shell script Claude Code invokes on every
tool call. It reads three env vars (set by the orchestrator before
spawning the SubAgent), rate-limits to avoid write storms, and calls
`gate witness` on the parent substrate.

Required env vars:

```
GUILD_CONFIG=<abs path to parent guild.config.yaml>
                             # without this, gate walks up from the
                             # worktree and may find the wrong substrate
GUILD_WAVE_ID=<YYYY-MM-DD-NNNN>
                             # the wave the SubAgent is executing
GUILD_ACTOR=<sub-agent name> # the SubAgent's registered actor name
```

### 2. Wire it into Claude Code

In your project's `.claude/settings.json` (or `~/.claude/settings.json`
for global):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/guild-cli/examples/plugins/harness-wirings/claude-code/post-tool-use.sh"
          }
        ]
      }
    ]
  }
}
```

Claude Code fires this script after every tool call. The script
short-circuits to a no-op when `GUILD_WAVE_ID` is unset (so it's safe
to install globally — only fires when an orchestrator has explicitly
opted in by setting the env).

### 3. Orchestrator-side setup

Before launching the SubAgent, the orchestrator:

```bash
export GUILD_CONFIG=/abs/path/to/parent/guild.config.yaml
export GUILD_WAVE_ID=2026-05-15-0001
export GUILD_ACTOR=noir
# launch SubAgent (it inherits these env vars)
```

The orchestrator continues to call `gate witness` / `gate complete`
on its own behalf as usual; this wiring just ensures the SubAgent's
heartbeat is also visible.

## Rate limiting

The hook script throttles to one `gate witness` call per
`$GUILD_WITNESS_THROTTLE_SEC` (default 30s). Without throttling, a
busy SubAgent firing PostToolUse 50+ times in a slice would produce
a write storm. The throttle state lives in `$XDG_RUNTIME_DIR` (or
`/tmp` as fallback) keyed by wave id + actor, so concurrent
SubAgents on different waves don't interfere.

`gate witness` is already idempotent on identical note text (#246),
so the throttle is belt-and-suspenders: the substrate would dedupe
even without it, but the throttle avoids the round-trip.

## Failure modes named explicitly

- `GUILD_CONFIG` unset → hook walks up from cwd, may find wrong
  substrate (or none). Script logs to stderr and continues — the
  PostToolUse hook is not load-bearing for the SubAgent's actual
  work.
- Parent substrate moved / deleted → `gate witness` errors; script
  logs and continues.
- Network filesystem latency → throttle is permissive; lost
  heartbeats are recoverable on the next tool call.
- SubAgent crash mid-slice → last `witness_updated_at` timestamp
  pinpoints where work stopped; orchestrator decides recovery.

## See also

- [`docs/swarm.md`](../../../../docs/swarm.md) § "Worktree-ledger
  blindspot" — the gap this bridge closes.
- [`#308`](https://github.com/eris-ths/guild-cli/issues/308) Layer A
  bundle — the design conversation that led here.
- [`lore/principles/15-plugins-as-default-extension.md`](../../../../lore/principles/15-plugins-as-default-extension.md)
  — the routing rule that puts this wiring in `examples/` rather than
  guild-cli core.
