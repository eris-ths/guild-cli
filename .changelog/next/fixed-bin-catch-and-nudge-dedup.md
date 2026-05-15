- **`bin/*.mjs` entries now catch unhandled errors and render them in
  the standard `error: <msg>` envelope instead of raw Node stack
  traces.** Surfaced by `GUILD_CONFIG=/nonexistent` printing an
  `at file:///…/bin/gate.mjs:54:1 { field: 'GUILD_CONFIG' }` stack
  with a `Node.js v23.6.1` footer — unprofessional for what is user
  error. The shared helper `bin/_lib/handleMainError.mjs` detects
  DomainError-shaped throws (presence of `.field` property) and
  prints clean `error: <msg>` + exit 1; unexpected internal throws
  still surface their stack with a `<bin>: internal error (please
  file an issue …)` preamble. Fired from gate / guild / agora /
  devil / ctx — all five entry-points.

- **`GUILD_CONFIG=""` stderr nudge now fires exactly once per
  process** instead of twice. `GuildConfig.load()` is called
  multiple times in one invocation (top-level + at least one
  plugin loader); the prior implementation re-emitted on each.
  Module-private one-shot guard `emptyGuildConfigNudgeFired`
  preserves per-process emission semantics so a fresh shell still
  gets the warning, but a single CLI run no longer doubles it.
