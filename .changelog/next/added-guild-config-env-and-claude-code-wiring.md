- **`GUILD_CONFIG` env var override for cross-tree substrate access
  (#308 Layer A).** When set to an absolute path, `gate` skips the
  cwd walk-up and uses the named `guild.config.yaml` directly.
  Unblocks the "worktree at <path-A>, substrate at <path-B>" case
  where the orchestrator's substrate is not in the worktree's git
  ancestry — most notably Claude Code SubAgents running in
  `.claude/worktrees/agent-X/` against a parent substrate that
  lives outside the repo tree. Resolution priority:
  `GUILD_CONFIG` env > `findConfig(cwd)` walk-up > cwd fallback.
  A nonexistent path errors loudly rather than silently falling
  back (silent fallback here would let a SubAgent write to a
  stale substrate without realising).

- **Claude Code `PostToolUse` → `gate witness` example wiring**
  shipped under `examples/plugins/harness-wirings/claude-code/`.
  Surfaces SubAgent tool-use as throttled witness updates on the
  parent wave so `gate wave-status` / `gate swarm-status` show
  fresh activity without polling. Source 3 of the #308 Layer A
  bundle (per principle 15 routing: harness-specific wirings live
  in `examples/`, not in core).
