- **`gate swarm-status` — cross-wave director / participant view
  (#346).** Closes the principle-14 loop: composes `wave-status`
  across all active waves into one envelope so a director never has
  to chain 1 + N + N×M sub-reads to compose the swarm picture.
  Returns waves (with per-executor freshness bands per #309),
  distinct-executor count, and a flat `alerts[]` array surfacing
  `stale_executor` / `overlapping_target` / `attribution_risk`.
  Dual scope flags: `--orchestrating <actor>` (director-centric, "what
  swarm am I conducting?") and `--for <actor>` (participant-centric,
  "what swarm am I part of?"). GUILD_ACTOR env defaults to
  `orchestrating=$GUILD_ACTOR` with `scope.for_source="env"` reported
  in the payload. Sibling of `gate wave-status` (per-wave) and
  `gate decisions` (per-actor history). 8 tests under
  `tests/interface/swarmStatus346.test.ts`.
