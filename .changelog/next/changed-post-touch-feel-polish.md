- **Four post-2026-05-15-touch-feel polish fixes.** None blocked any
  current workflow; each closes a small papercut surfaced during the
  end-of-day dogfood pass.

  1. **`bin/_lib/checkDistFreshness.mjs`** — stale-dist warning now
     names *"after switching worktrees on this repo"* alongside the
     existing *"after a `git pull`"* cause. Worktree exit followed by
     `./bin/gate.mjs` in the parent is a regular trigger and the
     prior hint missed it.

  2. **`GuildConfig.load()`** — `GUILD_CONFIG=""` (set-but-empty) now
     emits a one-line stderr nudge before falling back to walk-up.
     The previous behavior silently treated empty as unset, which is
     the footgun mode where the caller thinks they're clearing the
     override but is in fact letting walk-up decide the substrate.

  3. **`gate swarm-status` text rendering** — waves with no executors
     render on a single line (`<id> [state] from=<from> (no executors)`)
     rather than emitting a separate indented `(no executors assigned)`
     sub-line. Substrates dominated by pre-#230 records (or freshly-
     filed pending waves) no longer present visually heavy two-line
     blocks per wave.

  4. **`gate swarm-status` summary hint** — when `active_waves > 0` but
     `distinct_executors == 0`, a one-line hint surfaces
     `(no executor-stamped activity — likely pre-#230 records or
     freshly-filed pending)`. The previous summary line read as
     "swarm picture" at face value, misleading the reader for the
     legacy-substrate case.
